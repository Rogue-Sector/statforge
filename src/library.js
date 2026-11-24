// Pure helpers for the library UI: output hashing and the "copied" tracker, folder grouping,
// monster search ranking and relative times. No DOM: loaded as a classic <script> in the app
// (window.StatblockLibrary) and with require() in the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatblockLibrary = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clean = (s) => String(s ?? '').trim();

  // ---- hashing ----------------------------------------------------------

  /** FNV-1a over UTF-16 code units, as 8 hex digits. Fast and stable; not cryptographic. */
  function hashString(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /**
   * A copy record for one formatted section ({ blocks: [{ id, tokens }] }).
   * `toPlain` is format.js's renderer; `opts` are the same output options used for copying.
   */
  function snapshotSection(section, toPlain, opts = {}, at = Date.now()) {
    const actions = {};
    const texts = [];
    for (const b of (section && section.blocks) || []) {
      const t = toPlain(b.tokens, opts);
      actions[b.id] = hashString(t);
      texts.push(t);
    }
    return { hash: hashString(texts.join('\n\n')), at, actions };
  }

  /**
   * The name a block is shown under in messages: "Bite", "Multiattack", … A lair action with no
   * name is shown by its first few words: "Magma erupts from a…".
   */
  function blockName(block) {
    if (block.id === 'legendary-intro') return 'Legendary Action Uses';
    if (block.id === 'lair-intro') return 'Lair Actions intro';
    const first = block.tokens && block.tokens[0];
    if (!first) return 'an action';
    if (first.t !== 'name') {
      const words = block.tokens.map((t) => (t.t === 'roll' ? t.display : t.v || '')).join('').trim().split(/\s+/);
      return words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : words.join(' ').replace(/\.$/, '') || 'a lair action';
    }
    return String(first.v).replace(/\.$/, '').replace(/\s*\(.*\)$/, '');
  }

  /**
   * Compares a stored copy record with the section as it is now.
   * Returns { state: 'never' | 'copied' | 'changed', changed: [names], added: [names], removed: n }.
   */
  function copyStatus(record, section, toPlain, opts = {}) {
    if (!record || !record.hash) return { state: 'never', changed: [], added: [], removed: 0 };
    const now = snapshotSection(section, toPlain, opts, 0);
    if (now.hash === record.hash) return { state: 'copied', changed: [], added: [], removed: 0 };
    const before = record.actions || {};
    const changed = [], added = [];
    for (const b of (section && section.blocks) || []) {
      if (!(b.id in before)) added.push(blockName(b));
      else if (before[b.id] !== now.actions[b.id]) changed.push(blockName(b));
    }
    const removed = Object.keys(before).filter((id) => !(id in now.actions)).length;
    return { state: 'changed', changed, added, removed };
  }

  const nameList = (names) => {
    if (names.length > 2) return [{ text: `${names.length} actions` }];
    if (names.length === 2) return [{ text: names[0], strong: true }, { text: ' and ' }, { text: names[1], strong: true }];
    return [{ text: names[0], strong: true }];
  };

  /**
   * The note shown next to the Copy button for a changed section, as segments
   * [{ text, strong? }] so the UI can bold the action names without building HTML.
   */
  function changeMessage(status) {
    if (!status || status.state !== 'changed') return [];
    const parts = [];
    if (status.changed.length) parts.push([{ text: 'You changed ' }, ...nameList(status.changed)]);
    if (status.added.length) parts.push([{ text: parts.length ? 'added ' : 'You added ' }, ...nameList(status.added)]);
    if (status.removed) parts.push([{ text: status.removed === 1 ? 'an action was removed' : `${status.removed} actions were removed` }]);
    if (!parts.length) parts.push([{ text: 'This section changed' }]);
    const out = [];
    parts.forEach((p, i) => {
      if (i > 0) out.push({ text: i === parts.length - 1 ? ', and ' : ', ' });
      out.push(...p);
    });
    // "an action was removed" on its own needs a capital letter.
    if (out[0].text === 'an action was removed') out[0] = { text: 'An action was removed' };
    out.push({ text: ' after copying. Copy again before pasting into D&D Beyond.' });
    return out;
  }

  // ---- folders ----------------------------------------------------------

  const UNSORTED = 'Unsorted';

  /**
   * Groups monsters by folder: named folders A–Z (case-insensitive), "Unsorted" last.
   * `extraFolders` are empty folders the user created. Monsters keep their order inside a folder.
   * Returns [{ name, key, monsters }] where key is '' for Unsorted.
   */
  function groupByFolder(monsters, extraFolders = []) {
    const map = new Map();
    const add = (name) => {
      const k = name.toLowerCase();
      if (!map.has(k)) map.set(k, { name, key: name, monsters: [] });
      return map.get(k);
    };
    for (const f of extraFolders) if (clean(f)) add(clean(f));
    const unsorted = { name: UNSORTED, key: '', monsters: [] };
    for (const m of monsters) {
      const f = clean(m.folder);
      (f ? add(f) : unsorted).monsters.push(m);
    }
    const groups = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (unsorted.monsters.length || !groups.length) groups.push(unsorted);
    return groups;
  }

  // ---- search -----------------------------------------------------------

  /**
   * Where `query` matches `text`: contiguous first, then as a subsequence.
   * Returns { score, ranges: [[start, end)] } or null. Higher scores are better.
   */
  function matchText(text, query) {
    const t = String(text || ''), q = clean(query).toLowerCase();
    if (!q) return { score: 0, ranges: [] };
    const lower = t.toLowerCase();
    const at = lower.indexOf(q);
    if (at === 0) return { score: 100, ranges: [[0, q.length]] };
    // Prefer a match at the start of a word.
    const re = new RegExp(`(^|[\\s\\-'’(])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const word = re.exec(lower);
    if (word) { const s = word.index + word[1].length; return { score: 80, ranges: [[s, s + q.length]] }; }
    if (at > 0) return { score: 60, ranges: [[at, at + q.length]] };
    // Word initials ("ygd" -> Young Green Dragon). Scattered letters inside words are too noisy.
    const letters = q.replace(/\s+/g, '');
    const initials = [];
    for (let i = 0; i < lower.length; i++) {
      if (/[a-z0-9]/.test(lower[i]) && (i === 0 || !/[a-z0-9]/.test(lower[i - 1]))) initials.push(i);
    }
    if (letters.length < 2 || letters.length > initials.length) return null;
    for (let k = 0; k + letters.length <= initials.length; k++) {
      const pick = initials.slice(k, k + letters.length);
      if (pick.every((pos, n) => lower[pos] === letters[n])) {
        return { score: 40, ranges: pick.map((pos) => [pos, pos + 1]) };
      }
    }
    return null;
  }

  /**
   * Ranks monsters for the finder: name matches first, then folder and type matches.
   * Returns [{ monster, score, ranges }] where ranges highlight the name (empty for folder/type hits).
   */
  function searchMonsters(monsters, query) {
    const q = clean(query);
    if (!q) return monsters.map((m) => ({ monster: m, score: 0, ranges: [] }));
    const out = [];
    monsters.forEach((m, index) => {
      const byName = matchText(m.name, q);
      if (byName) return out.push({ monster: m, score: 1000 + byName.score, ranges: byName.ranges, index });
      const meta = m.meta || {};
      const other = [m.folder, meta.type, meta.size].map((x) => matchText(x, q)).filter((x) => x && x.score >= 60);
      if (other.length) out.push({ monster: m, score: Math.max(...other.map((x) => x.score)), ranges: [], index });
    });
    out.sort((a, b) => b.score - a.score || a.index - b.index);
    return out.map(({ monster, score, ranges }) => ({ monster, score, ranges }));
  }

  /** Splits text into [{ text, hit }] pieces for highlighting the given ranges. */
  function highlightPieces(text, ranges) {
    const s = String(text || '');
    const out = [];
    let pos = 0;
    for (const [a, b] of ranges || []) {
      if (a > pos) out.push({ text: s.slice(pos, a), hit: false });
      out.push({ text: s.slice(a, b), hit: true });
      pos = b;
    }
    if (pos < s.length) out.push({ text: s.slice(pos), hit: false });
    return out;
  }

  // ---- signed numbers (to-hit, modifiers) ---------------------------------

  /**
   * Reads a typed modifier: "+10", "10", "-1", "−1" (true minus), " + 3 " all work.
   * Returns the integer, or null while the text isn't a whole number yet ("", "+", "-", "1.5", "abc").
   */
  function parseSigned(text) {
    const m = /^\s*([+\-\u2212]?)\s*(\d{1,4})\s*$/.exec(String(text ?? ''));
    if (!m) return null;
    const n = parseInt(m[2], 10);
    return m[1] && m[1] !== '+' && n !== 0 ? -n : n; // no negative zero
  }

  /**
   * How a signed field's text reads: 'ok' (a whole number), 'typing' (empty or a lone sign, which
   * is half way to one) or 'invalid' (anything else). Only 'invalid' is flagged to the user.
   */
  function signedInputState(text) {
    if (parseSigned(text) != null) return 'ok';
    return /^\s*[+\-−]?\s*$/.test(String(text ?? '')) ? 'typing' : 'invalid';
  }

  /** "+10", "+0", "-1": how a modifier is shown. */
  const formatSigned = (n) => (n < 0 ? `-${Math.abs(n)}` : `+${n}`);

  // ---- time ---------------------------------------------------------------

  function relativeTime(then, now = Date.now()) {
    const sec = Math.max(0, Math.round((now - then) / 1000));
    if (sec < 45) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const d = Math.round(hr / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  /** "Large Monstrosity · CR 7 · Desert campaign", skipping empty parts. */
  function subtitleOf(m) {
    const meta = m.meta || {};
    const kind = [clean(meta.size), clean(meta.type)].filter(Boolean).join(' ');
    return [kind, clean(meta.cr) && `CR ${clean(meta.cr)}`, clean(m.folder)].filter(Boolean).join(' · ');
  }

  // ---- milestone checkpoints (lightweight cross-session recovery) --------

  /** Stable content hash of a monster, ignoring copy-tracker metadata. */
  function monsterContentHash(m) {
    if (!m || typeof m !== 'object') return '';
    const { copied: _copied, ...rest } = m;
    return hashString(JSON.stringify(rest));
  }

  /** Summary shown on a checkpoint row: "3 actions · Bite, Sting, Halberd". */
  function checkpointSummary(m) {
    const actions = Array.isArray(m && m.actions) ? m.actions : [];
    if (!actions.length) return 'No actions';
    const names = actions.map((a) => clean(a.name) || 'Unnamed').slice(0, 3);
    const more = actions.length > 3 ? ` +${actions.length - 3}` : '';
    return `${actions.length} action${actions.length === 1 ? '' : 's'} · ${names.join(', ')}${more}`;
  }

  /**
   * Records a milestone checkpoint (session start, last copied, before import) for one monster.
   * Returns a new store object without mutating the input; skips exact consecutive duplicates.
   */
  function recordCheckpoint(store, monster, { kind = 'session', label = '', at = Date.now(), maxPerMonster = 8, maxTotal = 80 } = {}) {
    const next = {};
    for (const [id, list] of Object.entries(store || {})) {
      if (Array.isArray(list) && list.length) next[id] = list.slice();
    }
    if (!monster || !monster.id) return next;
    const hash = monsterContentHash(monster);
    const list = next[monster.id] ? next[monster.id].slice() : [];
    // Skip if an identical checkpoint of the same kind already sits at the top.
    if (list.length && list[0].hash === hash && list[0].kind === kind) {
      list[0] = { ...list[0], at, label: label || list[0].label };
      next[monster.id] = list;
      return next;
    }
    // Keep only the latest "copy" checkpoint per label so repeated copies don't push out session saves.
    const filtered = kind === 'copy'
      ? list.filter((c) => !(c.kind === 'copy' && c.label === label))
      : list;
    const entry = {
      id: `cp-${at.toString(36)}-${hash.slice(0, 4)}`,
      kind,
      label: label || (kind === 'copy' ? 'Last copied' : kind === 'import' ? 'Before import' : 'Before today’s edits'),
      at,
      hash,
      monster: JSON.parse(JSON.stringify(monster)),
    };
    next[monster.id] = [entry, ...filtered].slice(0, maxPerMonster);
    return trimCheckpoints(next, maxTotal);
  }

  /** Enforces a global checkpoint cap by dropping the oldest entries across all monsters. */
  function trimCheckpoints(store, maxTotal = 80) {
    const all = [];
    for (const [id, list] of Object.entries(store || {})) {
      for (const cp of list || []) all.push({ id, cp });
    }
    if (all.length <= maxTotal) return store;
    all.sort((a, b) => (b.cp.at || 0) - (a.cp.at || 0));
    const keep = new Set(all.slice(0, maxTotal).map((x) => `${x.id}|${x.cp.id}`));
    const out = {};
    for (const [id, list] of Object.entries(store || {})) {
      const kept = (list || []).filter((cp) => keep.has(`${id}|${cp.id}`));
      if (kept.length) out[id] = kept;
    }
    return out;
  }

  function listCheckpoints(store, monsterId) {
    const list = store && Array.isArray(store[monsterId]) ? store[monsterId] : [];
    return list.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  // ---- reusable ability library & search ---------------------------------

  function starterTemplates() {
    return [
      {
        id: 'tpl-breath',
        name: 'Breath Weapon',
        source: 'starter',
        action: {
          name: 'Fire Breath', kind: 'save', section: 'actions',
          usage: { type: 'recharge', recharge: 5, perDay: 1, cost: 2, text: '' },
          save: { enabled: true, ability: 'Dexterity', dc: 15, damage: null, half: true },
          area: 'each creature in a 30-foot Cone',
          damage: { count: 8, die: 6, mod: 0, type: 'Fire' },
          extraDamage: [], success: 'half', successText: '',
        },
      },
      {
        id: 'tpl-poison-bite',
        name: 'Poisonous Bite',
        source: 'starter',
        action: {
          name: 'Venomous Bite', kind: 'melee', section: 'actions',
          usage: { type: 'none', recharge: 5, perDay: 1, cost: 2, text: '' },
          toHit: 6, reach: 5,
          damage: { count: 1, die: 8, mod: 3, type: 'Piercing' },
          extraDamage: [],
          save: { enabled: true, ability: 'Constitution', dc: 14, damage: { count: 4, die: 6, mod: 0, type: 'Poison' }, half: true },
          condition: { enabled: true, name: 'Poisoned', duration: 'until the end of its next turn' },
        },
      },
      {
        id: 'tpl-grapple-slam',
        name: 'Grappling Slam',
        source: 'starter',
        action: {
          name: 'Crushing Slam', kind: 'melee', section: 'actions',
          usage: { type: 'none', recharge: 5, perDay: 1, cost: 2, text: '' },
          toHit: 7, reach: 10,
          damage: { count: 2, die: 8, mod: 4, type: 'Bludgeoning' },
          extraDamage: [],
          condition: { enabled: true, name: 'Grappled', duration: '(escape DC 14)' },
        },
      },
      {
        id: 'tpl-regeneration',
        name: 'Regeneration',
        source: 'starter',
        action: {
          name: 'Regeneration', kind: 'text', section: 'traits',
          usage: { type: 'none', recharge: 5, perDay: 1, cost: 2, text: '' },
          description: 'The creature regains {heal 2d8} Hit Points at the start of each of its turns. If it takes Fire or Acid damage, this trait doesn’t function on its next turn.',
        },
      },
      {
        id: 'tpl-legendary-res',
        name: 'Legendary Resistance',
        source: 'starter',
        action: {
          name: 'Legendary Resistance', kind: 'text', section: 'traits',
          usage: { type: 'custom', recharge: 5, perDay: 3, cost: 2, text: '3/Day, or 4/Day in Lair' },
          description: 'If the creature fails a saving throw, it can choose to succeed instead.',
        },
      },
      {
        id: 'tpl-teleport',
        name: 'Teleport',
        source: 'starter',
        action: {
          name: 'Misty Step', kind: 'text', section: 'bonus',
          usage: { type: 'recharge', recharge: 5, perDay: 1, cost: 2, text: '' },
          description: 'The creature teleports up to 30 feet to an unoccupied space it can see.',
        },
      },
      {
        id: 'tpl-spellcasting',
        name: 'Innate Spellcasting',
        source: 'starter',
        action: {
          name: 'Spellcasting', kind: 'spells', section: 'actions',
          usage: { type: 'none', recharge: 5, perDay: 1, cost: 2, text: '' },
          spells: {
            ability: 'Charisma', dc: 14, attack: 6, hasAttack: true, edition: 'auto',
            components: 'requiring no Material components',
            groups: [
              { label: 'At Will', spells: 'Detect Magic, Mage Hand' },
              { label: '1/Day Each', spells: 'Fireball, Misty Step' },
            ],
          },
        },
      },
    ];
  }

  /**
   * Ranks reusable ability entries ({ name, origin?, action }) against a query.
   * Matches action name first, then origin/monster name, kind, or damage type.
   */
  function searchAbilities(items, query) {
    const q = clean(query);
    if (!q) return items.map((item) => ({ item, score: 0, ranges: [] }));
    const out = [];
    items.forEach((item, index) => {
      const a = item.action || {};
      const byName = matchText(item.name || a.name, q);
      if (byName) return out.push({ item, score: 1000 + byName.score, ranges: byName.ranges, index });
      const extra = [
        item.origin,
        a.section,
        a.kind,
        a.damage && a.damage.type,
        a.condition && a.condition.enabled && a.condition.name,
        a.description,
      ].map((x) => matchText(x, q)).filter((x) => x && x.score >= 60);
      if (extra.length) out.push({ item, score: Math.max(...extra.map((x) => x.score)), ranges: [], index });
    });
    out.sort((a, b) => b.score - a.score || a.index - b.index);
    return out.map(({ item, score, ranges }) => ({ item, score, ranges }));
  }

  return {
    UNSORTED,
    hashString, snapshotSection, blockName, copyStatus, changeMessage,
    groupByFolder, matchText, searchMonsters, highlightPieces, relativeTime, subtitleOf,
    parseSigned, formatSigned, signedInputState,
    monsterContentHash, checkpointSummary, recordCheckpoint, trimCheckpoints, listCheckpoints,
    starterTemplates, searchAbilities,
  };
});
