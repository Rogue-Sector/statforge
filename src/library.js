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

  return {
    UNSORTED,
    hashString, snapshotSection, blockName, copyStatus, changeMessage,
    groupByFolder, matchText, searchMonsters, highlightPieces, relativeTime, subtitleOf,
    parseSigned, formatSigned, signedInputState,
  };
});
