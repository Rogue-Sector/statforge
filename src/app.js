(function () {
  'use strict';

  const F = window.StatblockFormat;
  const L = window.StatblockLibrary;
  const D = window.StatblockDDB;
  const { wyvernRider } = window.StatblockExample;
  const $ = (sel) => document.querySelector(sel);

  // ---------- platform: Electron bridge, or browser fallbacks ----------

  const STORAGE_KEY = 'stat-forge-library';
  const LEGACY_STORAGE_KEY = 'statblock-builder-library';
  const storage = window.api
    ? { load: () => window.api.loadLibrary(), save: (d) => window.api.saveLibrary(d) }
    : {
      load: async () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)); } catch { return null; } },
      // Lets quota and private-mode errors through, so the save status can warn instead of losing work.
      save: async (d) => { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); },
    };

  async function writeClipboard(text, html) {
    if (window.api) return window.api.copy(text, html);
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
  }

  async function exportJson(name, data) {
    if (window.api) return window.api.exportFile(name, data);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  }

  function importJson() {
    if (window.api) return window.api.importFile();
    return new Promise((resolve, reject) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        file.text().then((t) => resolve(JSON.parse(t))).catch(reject);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  // ---------- data ----------

  const uid = (prefix) => `${prefix}-${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 10)}`;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const ATTACK_KINDS = ['melee', 'ranged', 'both'];
  const KIND_LABELS = [['melee', 'Melee attack'], ['ranged', 'Ranged attack'], ['both', 'Melee or ranged'], ['save', 'Saving throw'], ['spells', 'Spellcasting'], ['text', 'Text']];
  const TAB_LABELS = { traits: 'Traits', actions: 'Actions', bonus: 'Bonus Actions', reactions: 'Reactions', legendary: 'Legendary', lair: 'Lair' };

  const newDamage = (type = 'Slashing') => ({ count: 1, die: 8, mod: 3, type });

  function newAction(kind = 'melee', name = '', section = 'actions') {
    const isSave = kind === 'save';
    return {
      id: uid('a'),
      name,
      kind,
      attackSource: 'weapon',
      section,
      usage: { type: isSave && section !== 'traits' && section !== 'lair' ? 'recharge' : 'none', recharge: 5, perDay: 1, cost: 2, text: '' },
      toHit: 5,
      reach: 5,
      rangeNormal: 80,
      rangeLong: 320,
      damage: isSave ? { count: 6, die: 6, mod: 0, type: 'Fire' } : kind === 'text' ? null : newDamage(kind === 'ranged' ? 'Piercing' : 'Slashing'),
      extraDamage: [],
      save: { enabled: false, ability: isSave ? 'Dexterity' : 'Constitution', dc: 13, damage: null, half: true },
      condition: { enabled: false, name: 'Poisoned', duration: '' },
      rider: '',
      showRider: false,
      miss: '',
      hitOrMiss: false,
      showMiss: false,
      area: isSave ? 'each creature in a 15-foot Cone' : '',
      success: 'half',
      successText: '',
      trigger: '',
      spells: {
        ability: 'Intelligence',
        dc: 13,
        attack: 5,
        hasAttack: true,
        edition: 'auto',
        components: 'requiring no Material components',
        groups: [
          { label: 'At Will', spells: 'Detect Magic, Mage Hand' },
          { label: '1/Day Each', spells: 'Fireball' },
        ],
      },
      healing: { enabled: false, count: 2, die: 8, mod: 0, who: 'self', text: '' },
      versatile: { enabled: false, count: 1, die: 10, mod: 3, type: 'Slashing', text: F.VERSATILE_WORDING },
      description: '',
      collapsed: false,
    };
  }

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  function normalizeAction(raw) {
    const a = isObj(raw) ? raw : {};
    const def = newAction(typeof a.kind === 'string' ? a.kind : 'melee');
    const rawSpells = isObj(a.spells) ? a.spells : {};
    const spells = {
      ...def.spells,
      ...rawSpells,
      edition: F.SPELL_EDITIONS.includes(rawSpells.edition) ? rawSpells.edition : 'auto',
      groups: Array.isArray(rawSpells.groups)
        ? rawSpells.groups.filter(isObj).map((g) => ({
          label: typeof g.label === 'string' ? g.label : '',
          spells: typeof g.spells === 'string' ? g.spells : '',
        }))
        : def.spells.groups,
    };
    return {
      ...def,
      ...a,
      attackSource: a.attackSource === 'spell' ? 'spell' : 'weapon',
      id: typeof a.id === 'string' && a.id ? a.id : def.id,
      usage: { ...def.usage, ...(isObj(a.usage) ? a.usage : {}) },
      damage: a.damage === undefined ? def.damage : (isObj(a.damage) ? a.damage : null),
      extraDamage: Array.isArray(a.extraDamage) ? a.extraDamage.filter(isObj) : [],
      save: { ...def.save, ...(isObj(a.save) ? a.save : {}) },
      condition: { ...def.condition, ...(isObj(a.condition) ? a.condition : {}) },
      spells,
      healing: { ...def.healing, ...(isObj(a.healing) ? a.healing : {}) },
      versatile: { ...def.versatile, ...(isObj(a.versatile) ? a.versatile : {}) },
    };
  }

  function normalizeMonster(raw) {
    const m = isObj(raw) ? raw : {};
    const rawMa = isObj(m.multiattack) ? m.multiattack : {};
    const multiattack = { enabled: false, subject: '', tail: '', ...rawMa, counts: isObj(rawMa.counts) ? { ...rawMa.counts } : {} };
    // "Creature is called" used to live on the multiattack; it now belongs to the whole monster.
    const subject = typeof m.subject === 'string' ? m.subject : (typeof multiattack.subject === 'string' ? multiattack.subject : '');
    multiattack.subject = '';
    // The 2024/2014 switch used to be legendary.style and only changed the legendary intro. It is
    // now the monster's wording for every section; an old monster keeps the style it had.
    const legendary = { uses: 3, lairUses: 0, ...(isObj(m.legendary) ? m.legendary : {}) };
    const wording = F.wordingOf(m);
    delete legendary.style;
    return {
      id: typeof m.id === 'string' && m.id ? m.id : uid('m'),
      name: typeof m.name === 'string' && m.name ? m.name : 'New Monster',
      subject,
      wording,
      multiattack,
      legendary,
      lair: { initiative: 20, noRepeat: true, text: '', ...(isObj(m.lair) ? m.lair : {}) },
      actions: Array.isArray(m.actions) ? m.actions.filter(isObj).map(normalizeAction) : [],
      // Which sections were copied, as hashes of their exact output: { [sectionKey]: { hash, at, actions } }.
      copied: isObj(m.copied) ? m.copied : {},
      // Library-only details. Display only: never part of the copied text.
      folder: typeof m.folder === 'string' ? m.folder : '',
      meta: { size: '', type: '', cr: '', ...pickStrings(m.meta, ['size', 'type', 'cr']) },
    };
  }

  function pickStrings(obj, keys) {
    const out = {};
    for (const k of keys) if (obj && typeof obj[k] === 'string') out[k] = obj[k];
    return out;
  }

  /** Copy of a monster with fresh ids everywhere (multiattack counts follow). */
  function withNewIds(m) {
    const copy = clone(m);
    copy.id = uid('m');
    const counts = {};
    for (const a of copy.actions) {
      const id = uid('a');
      if (copy.multiattack.counts[a.id] != null) counts[id] = copy.multiattack.counts[a.id];
      a.id = id;
    }
    copy.multiattack.counts = counts;
    copy.copied = {}; // the copy hasn't been pasted anywhere yet
    return copy;
  }

  // folders: empty folders the user made with "+ New folder". Folders with monsters come from monster.folder.
  // snippets: user-saved reusable actions/traits, exported and imported with the library.
  let lib = { version: 1, settings: { markdownBold: false }, currentId: null, folders: [], monsters: [], snippets: [] };
  let view = 'preview';
  let query = '';
  let live = []; // refreshers registered by the editor, re-run on every edit
  // Editor-only state; never saved and never part of the output.
  const ui = { tab: {}, open: {}, details: false, addOpen: false };

  const current = () => lib.monsters.find((m) => m.id === lib.currentId) || null;
  const outputOpts = () => ({ markdownBold: !!lib.settings.markdownBold });
  const sectionMeta = (key) => F.SECTIONS.find((s) => s.key === key) || F.SECTIONS[1];
  const inSection = (m, key) => m.actions.filter((a) => F.sectionOf(a) === key);

  // ---------- undo / redo ----------

  const MAX_UNDO = 40;
  const undoStack = [];
  const redoStack = [];
  let baselineSnap = null;
  let typingBurstAt = 0;
  let baselineTimer = null;

  const snapState = (label = '') => ({ lib: clone(lib), tab: { ...ui.tab }, open: { ...ui.open }, label });

  function resetBaseline() {
    clearTimeout(baselineTimer);
    baselineTimer = null;
    baselineSnap = snapState('edit');
  }

  function renderUndoButtons() {
    const u = $('#undo-btn'), r = $('#redo-btn');
    if (!u || !r) return;
    const topU = undoStack[undoStack.length - 1];
    const topR = redoStack[redoStack.length - 1];
    u.disabled = !topU;
    r.disabled = !topR;
    u.title = topU && topU.label ? `Undo ${topU.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    r.title = topR && topR.label ? `Redo ${topR.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
  }

  /** Call BEFORE mutating `lib` for a discrete change (add, delete, move, import, etc.). */
  function captureUndo(label = 'change') {
    undoStack.push(snapState(label));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    typingBurstAt = 0;
    renderUndoButtons();
  }

  /** Groups rapid typing/stepper updates into one undo step using the pre-burst baseline. */
  function captureTypingUndo() {
    const now = Date.now();
    if (baselineSnap && now - typingBurstAt > 1200) {
      undoStack.push({ ...baselineSnap, label: 'edit' });
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack.length = 0;
      renderUndoButtons();
    }
    typingBurstAt = now;
    clearTimeout(baselineTimer);
    baselineTimer = setTimeout(() => { baselineSnap = snapState('edit'); }, 900);
  }

  function applySnapshot(snap) {
    lib = clone(snap.lib);
    if (!Array.isArray(lib.snippets)) lib.snippets = [];
    ui.tab = { ...(snap.tab || {}) };
    ui.open = { ...(snap.open || {}) };
    ui.addOpen = false;
    resetBaseline();
    renderAll();
    scheduleSave();
    renderUndoButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    const snap = undoStack.pop();
    redoStack.push(snapState(snap.label));
    applySnapshot(snap);
    toast(snap.label && snap.label !== 'edit' ? `Undid ${snap.label}.` : 'Undid last change.');
  }

  function redo() {
    if (!redoStack.length) return;
    const snap = redoStack.pop();
    undoStack.push(snapState(snap.label));
    applySnapshot(snap);
    toast(snap.label && snap.label !== 'edit' ? `Redid ${snap.label}.` : 'Redid change.');
  }

  // ---------- lightweight milestone checkpoints ----------

  const CHECKPOINTS_KEY = 'stat-forge-checkpoints';
  let checkpoints = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(CHECKPOINTS_KEY));
      return isObj(parsed) ? parsed : {};
    } catch { return {}; }
  })();
  // Original monster snapshots loaded at session start, for "Before today's edits".
  const sessionOriginals = new Map();
  const sessionCaptured = new Set();

  function persistCheckpoints() {
    try {
      localStorage.setItem(CHECKPOINTS_KEY, JSON.stringify(checkpoints));
    } catch {
      // Storage is tight: trim aggressively so checkpoints never threaten main library saving.
      try {
        checkpoints = L.trimCheckpoints(checkpoints, 24);
        localStorage.setItem(CHECKPOINTS_KEY, JSON.stringify(checkpoints));
      } catch {
        try { localStorage.removeItem(CHECKPOINTS_KEY); } catch { /* ignore */ }
      }
    }
  }

  function recordMonsterCheckpoint(m, kind, label) {
    if (!m || !m.id) return;
    checkpoints = L.recordCheckpoint(checkpoints, m, { kind, label });
    persistCheckpoints();
  }

  function maybeCaptureSessionCheckpoint(m) {
    if (!m || !m.id || sessionCaptured.has(m.id)) return;
    const orig = sessionOriginals.get(m.id);
    if (!orig) return;
    if (L.monsterContentHash(m) !== L.monsterContentHash(orig)) {
      sessionCaptured.add(m.id);
      recordMonsterCheckpoint(orig, 'session', 'Before today’s edits');
    }
  }

  function tabOf(m) {
    if (ui.tab[m.id]) return ui.tab[m.id];
    const has = (k) => inSection(m, k).length || (k === 'actions' && m.multiattack.enabled);
    return has('actions') ? 'actions' : (F.SECTIONS.find((s) => has(s.key)) || F.SECTIONS[1]).key;
  }

  // ---------- autosave ----------

  const saveState = { ok: true, at: null };
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  async function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await storage.save(lib);
      saveState.ok = true;
      saveState.at = Date.now();
    } catch {
      saveState.ok = false;
    }
    renderStatus();
  }

  let statusKey = '';
  function renderStatus() {
    const el = $('#save-status');
    const when = saveState.at ? L.relativeTime(saveState.at) : '';
    const key = `${saveState.ok}|${when}`;
    if (key === statusKey) return;
    statusKey = key;
    el.classList.toggle('is-error', !saveState.ok);
    $('.topbar').classList.toggle('has-save-error', !saveState.ok);
    if (saveState.ok) {
      el.replaceChildren(icon('check'), h('span', { class: 'label-long' }, 'Saved automatically'),
        when && h('span', { class: 'when' }, h('span', { class: 'label-long' }, '· '), when));
      return;
    }
    el.replaceChildren(icon('alert'),
      h('span', { class: 'msg-long' }, 'Couldn’t save in this browser. Export a file now to keep your work.'),
      h('span', { class: 'msg-short' }, 'Couldn’t save here. Export a file now.'),
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: exportAll }, 'Export'));
  }

  /** Call after any value change that doesn't alter the editor's structure. */
  function update() {
    captureTypingUndo();
    maybeCaptureSessionCheckpoint(current());
    live.forEach((fn) => fn());
    renderTabs();
    renderOutput();
    renderLibrary();
    scheduleSave();
  }

  /** Redraws everything from the data (no save). */
  function renderAll() {
    live = [];
    renderHead();
    renderEditor();
    live.forEach((fn) => fn());
    renderTabs();
    renderOutput();
    renderLibrary();
  }

  /** Call after structural changes (added/removed parts, kind switches). */
  function rerender() {
    maybeCaptureSessionCheckpoint(current());
    renderAll();
    resetBaseline();
    scheduleSave();
  }

  // ---------- DOM helpers ----------

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === '') continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }

  const ICONS = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M14 11v6M11 14h6M4 16V6a2 2 0 0 1 2-2h10"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    folder: '<path d="M3.5 6.5a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
    library: '<path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5l4 1-3 13-4-1z"/>',
    paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-8 8l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 8-8z"/>',
  };
  function icon(name, cls = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `i ${cls}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  }
  const iconBtn = (name, title, onclick, extra = {}) =>
    h('button', { type: 'button', class: `icon-btn ${extra.class || ''}`, title, 'aria-label': title, onclick, disabled: extra.disabled, dataset: extra.dataset }, icon(name));

  const field = (label, control, cls = '') => h('label', { class: `field ${cls}` }, h('span', { class: 'field-label' }, label), control);

  /** Re-focuses the element with the same data-fk after a container is rebuilt. */
  function keepFocus(container, build) {
    const active = document.activeElement;
    const fk = active && container.contains(active) && active.dataset ? active.dataset.fk : null;
    build();
    if (fk) {
      const el = container.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  /**
   * A number field with −/+ nudges. `signed` makes it a text field for modifiers that shows and
   * accepts a sign ("+10", "10", "-1" all work; it shows "+10"). The stored value is always a number.
   */
  function stepper(get, set, { min = -99, max = 999, suffix = '', title = '', signed = false } = {}) {
    const clamp = (n) => Math.min(max, Math.max(min, n));
    const show = (n) => (signed ? L.formatSigned(n) : String(n));
    const read = (text) => (signed ? L.parseSigned(text) : (/^\s*-?\d+\s*$/.test(text) ? parseInt(text, 10) : null));
    const input = h('input', signed
      ? { type: 'text', inputmode: 'text', autocomplete: 'off', spellcheck: 'false', value: show(get()), 'aria-label': title, class: 'signed' }
      : { type: 'number', inputmode: 'numeric', min, max, value: show(get()), 'aria-label': title });
    const commit = (n) => { if (!Number.isFinite(n)) return; n = clamp(n); set(n); input.classList.remove('is-invalid'); input.removeAttribute('aria-invalid'); input.value = show(n); update(); };
    // While typing, store what can be read but leave the text alone; tidy it ("+10") on blur.
    // Text that can't be read is flagged and never stored; the last good value stays.
    const flag = (bad) => { input.classList.toggle('is-invalid', bad); if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); };
    input.addEventListener('input', () => {
      const n = read(input.value);
      flag(signed && L.signedInputState(input.value) === 'invalid');
      if (n != null && Number.isFinite(n)) { set(clamp(n)); update(); }
    });
    input.addEventListener('blur', () => { flag(false); input.value = show(get()); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); commit(get() + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1)); }
    });
    input.addEventListener('wheel', (e) => {
      if (document.activeElement !== input) return;
      e.preventDefault();
      commit(get() + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    return h('div', { class: 'stepper', title },
      h('span', { class: 'num' },
        h('button', { type: 'button', tabindex: '-1', 'aria-label': `Decrease ${title}`, onclick: () => commit(get() - 1) }, icon('minus')),
        input,
        h('button', { type: 'button', tabindex: '-1', 'aria-label': `Increase ${title}`, onclick: () => commit(get() + 1) }, icon('plus'))),
      suffix && h('span', { class: 'affix' }, suffix));
  }

  function select(options, get, set, { structural = false, title = '' } = {}) {
    return h('span', { class: 'select-wrap' }, h('select', {
      'aria-label': title, value: get(),
      onchange: (e) => { set(e.target.value); structural ? rerender() : update(); },
    }, options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o)))));
  }

  function textInput(get, set, attrs = {}) {
    return h('input', {
      class: 'input', type: 'text', spellcheck: 'true', ...attrs, value: get(),
      oninput: (e) => { set(e.target.value); update(); },
    });
  }

  function seg(options, get, set, { label = '', onChange = null } = {}) {
    const buttons = options.map(([value, text]) =>
      h('button', {
        type: 'button', role: 'radio', class: `seg-btn ${get() === value ? 'is-on' : ''}`, 'aria-checked': String(get() === value),
        onclick: () => {
          if (get() === value) return;
          set(value);
          if (onChange) {
            buttons.forEach((b, idx) => {
              const on = options[idx][0] === value;
              b.classList.toggle('is-on', on);
              b.setAttribute('aria-checked', String(on));
            });
            onChange(value);
          } else {
            rerender();
          }
        },
      }, text));
    return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || null }, buttons);
  }

  function warnList(getList) {
    const box = h('div', { class: 'warn-list' });
    live.push(() => {
      const list = getList();
      box.replaceChildren(...list.map((w) => h('p', { class: 'warn' }, icon('alert'), h('span', null, w))));
      box.hidden = !list.length;
    });
    return box;
  }

  // ---------- editor pieces ----------

  /** Dice, die, modifier, type and the average, as one row of fields. `lead` fields go first. */
  function damageEditor(d, onRemove, { noType = false, lead = [] } = {}) {
    const avg = h('span', { class: 'avg', title: 'Average' });
    live.push(() => {
      const dice = d.count > 0 ? F.diceText(d) : 'flat';
      avg.replaceChildren(h('b', null, String(F.avgDamage(d))), 'avg', h('span', null, dice));
    });
    const dieButtons = [4, 6, 8, 10, 12, 20].map((n) => h('button', {
      type: 'button', class: d.die === n ? 'is-on' : '', dataset: { die: n }, 'aria-pressed': String(d.die === n), title: `d${n}`,
      onclick: () => {
        d.die = n;
        dieButtons.forEach((b) => {
          const on = Number(b.dataset.die) === n;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        update();
      },
    }, `d${n}`));
    return h('div', { class: 'fields' },
      lead,
      field('Dice', stepper(() => d.count, (v) => { d.count = v; }, { min: 0, max: 99, title: 'number of dice' })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Die'), h('div', { class: 'dice', role: 'group', 'aria-label': 'Die size' }, dieButtons)),
      field('Mod', stepper(() => d.mod, (v) => { d.mod = v; }, { min: -20, max: 99, title: 'modifier', signed: true })),
      !noType && field('Type', select(F.DAMAGE_TYPES, () => d.type, (v) => { d.type = v; }, { title: 'damage type' })),
      avg,
      onRemove && iconBtn('x', 'Remove', onRemove));
  }

  /** The "Dice in text" hint shown under every box that understands inline dice. */
  function diceHint() {
    const ex = (c) => h('code', null, c);
    return h('p', { class: 'hint dice-hint' }, 'Dice in text: ',
      ex('{1d4}'), ' · ', ex('{dmg 3d6 Fire}'), ' · ', ex('{heal 2d8+4}'), ' · ', ex('{+5}'), '. Tags: ',
      ex('{condition Prone}'), ' · ', ex('{skill Perception}'), ' · ', ex('{spell Fireball}'), ' · ', ex('{action Hide}'), ' · ', ex('{sense Darkvision}'),
      '. Type ', ex('\\{'), ' for a plain brace.');
  }

  /** A titled part of a card (extra damage, condition, …) with an optional remove button. */
  function group(title, onRemove, ...children) {
    return h('div', { class: 'group' },
      h('div', { class: 'group-head' }, title, h('span', { class: 'spacer' }), onRemove && iconBtn('x', `Remove ${title.toLowerCase()}`, onRemove)),
      children);
  }

  function conditionSection(a) {
    return group('Condition', () => { a.condition.enabled = false; rerender(); },
      h('div', { class: 'fields' },
        field('Condition', select(F.CONDITIONS, () => a.condition.name, (v) => { a.condition.name = v; }, { title: 'condition' })),
        field('Duration (optional)', textInput(() => a.condition.duration, (v) => { a.condition.duration = v; }, {
          list: 'durations', placeholder: 'until the end of its next turn',
        }), 'field-grow')));
  }

  function riderSection(a) {
    return group('Rider text', () => { a.rider = ''; a.showRider = false; rerender(); },
      textInput(() => a.rider, (v) => { a.rider = v; }, { placeholder: 'if they failed by 5 or more', 'aria-label': 'rider text' }),
      h('p', { class: 'hint' }, 'Start it lowercase to continue the sentence, or with a capital letter to start a new one.'),
      diceHint());
  }

  function missSection(a) {
    return group('Miss', () => { a.miss = ''; a.hitOrMiss = false; a.showMiss = false; rerender(); },
      textInput(() => a.miss, (v) => { a.miss = v; }, { placeholder: 'Half damage.', 'aria-label': 'miss text' }),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!a.hitOrMiss, onchange: (e) => { a.hitOrMiss = e.target.checked; update(); } }),
        h('span', null, 'Label the effect “Hit or Miss:” instead of “Hit:”')),
      h('p', { class: 'hint' }, 'The Miss text goes after the Hit text as “Miss: Half damage.” Leave it empty if you only want “Hit or Miss:”.'),
      diceHint());
  }

  const NEXT_DIE = { 4: 6, 6: 8, 8: 10, 10: 12, 12: 12, 20: 20 };

  function versatileSection(a) {
    const v = a.versatile;
    return group('Versatile (two hands)', () => { v.enabled = false; rerender(); },
      damageEditor(v),
      field('Wording', textInput(() => v.text, (x) => { v.text = x; }, { placeholder: F.VERSATILE_WORDING, 'aria-label': 'versatile wording' }), 'field-grow'),
      h('p', { class: 'hint' }, '“…Slashing damage, or 8 (1d10 + 3) Slashing damage if used with two hands.” Extra damage and riders follow after it.'));
  }

  function healingSection(a) {
    const hl = a.healing;
    return group('Healing', () => { hl.enabled = false; rerender(); },
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Who heals'), seg([['self', 'Self'], ['target', 'Target']], () => hl.who, (v) => { hl.who = v; }, { label: 'Who heals' }))),
      damageEditor(hl, null, { noType: true }),
      field('Custom wording (optional)', textInput(() => hl.text, (v) => { hl.text = v; }, {
        placeholder: 'regains Hit Points equal to the damage dealt', 'aria-label': 'custom healing wording',
      }), 'field-grow'),
      diceHint(),
      h('p', { class: 'hint' }, 'Custom wording replaces “regains 13 (2d8 + 4) Hit Points”, and the dice above are then ignored. Life drain (“regains Hit Points equal to the damage dealt”) can’t be its own roll in D&D Beyond, because one roll can’t both deal damage and heal. Write it in the custom wording.'));
  }

  function usageControls(a) {
    const section = field('Section', select(F.SECTIONS.map((s) => [s.key, s.title]), () => F.sectionOf(a), (v) => {
      a.section = v;
      ui.tab[current().id] = v;
    }, { structural: true, title: 'statblock section' }));
    // Lair actions have no usage tag, and an unnamed one has no header to put it in.
    if (F.sectionOf(a) === 'lair') return h('div', { class: 'card-foot' }, section);
    const wrap = h('div', { class: 'card-foot' },
      section,
      field('Usage', select([['none', 'Always'], ['recharge', 'Recharge'], ['perDay', 'Per day'], ['cost', 'Costs actions'], ['custom', 'Custom']],
        () => a.usage.type, (v) => { a.usage.type = v; }, { structural: true, title: 'usage limit' })));
    if (a.usage.type === 'cost') {
      wrap.append(field('Costs', stepper(() => a.usage.cost || 2, (v) => { a.usage.cost = v; }, { min: 2, max: 5, suffix: 'Actions', title: 'legendary action cost' })));
    } else if (a.usage.type === 'recharge') {
      wrap.append(field('Recharge on', stepper(() => a.usage.recharge, (v) => { a.usage.recharge = v; }, { min: 2, max: 6, suffix: '–6', title: 'recharge' })));
    } else if (a.usage.type === 'perDay') {
      wrap.append(field('Uses', stepper(() => a.usage.perDay, (v) => { a.usage.perDay = v; }, { min: 1, max: 9, suffix: '/Day', title: 'uses per day' })));
    } else if (a.usage.type === 'custom') {
      wrap.append(field('Tag', textInput(() => a.usage.text, (v) => { a.usage.text = v; }, { placeholder: '3/Day, or 4/Day in Lair' }), 'field-grow'));
    }
    return wrap;
  }

  const addBtn = (label, onclick) => h('button', { type: 'button', class: 'btn btn-add', onclick }, label);

  function attackBody(a) {
    const body = [];
    const lead = [field('To hit', stepper(() => a.toHit, (v) => { a.toHit = v; }, { min: -5, max: 30, title: 'to hit bonus', signed: true }))];
    if (current()?.wording === '2014') {
      lead.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Attack'),
        seg([['weapon', 'Weapon'], ['spell', 'Spell']], () => a.attackSource || 'weapon', (v) => { a.attackSource = v; }, { label: 'Attack type' })));
    }
    if (a.kind !== 'ranged') lead.push(field('Reach', stepper(() => a.reach, (v) => { a.reach = v; }, { min: 5, max: 60, suffix: 'ft.', title: 'reach' })));
    if (a.kind !== 'melee') {
      lead.push(
        field('Range', stepper(() => a.rangeNormal, (v) => { a.rangeNormal = v; }, { min: 5, max: 1000, suffix: 'ft.', title: 'normal range' })),
        field('Long range', stepper(() => a.rangeLong, (v) => { a.rangeLong = v; }, { min: 0, max: 2000, suffix: 'ft.', title: 'long range' })));
    }
    if (!a.damage) a.damage = newDamage();
    body.push(damageEditor(a.damage, null, { lead }));

    const canVersatile = a.kind === 'melee' || a.kind === 'both';
    if (canVersatile) {
      body.push(h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', checked: a.versatile.enabled,
          onchange: (e) => {
            if (e.target.checked) {
              const d = a.damage;
              Object.assign(a.versatile, { enabled: true, count: d.count, die: NEXT_DIE[d.die] || d.die, mod: d.mod, type: d.type });
            } else a.versatile.enabled = false;
            rerender();
          },
        }),
        h('span', null, 'Versatile (more damage with two hands)')));
      if (a.versatile.enabled) body.push(versatileSection(a));
    }
    a.extraDamage.forEach((d, i) => body.push(group('Extra damage', null, damageEditor(d, () => { a.extraDamage.splice(i, 1); rerender(); }))));

    if (a.save.enabled) {
      const s = a.save;
      const rows = [h('div', { class: 'fields' },
        field('Ability', select(F.ABILITIES, () => s.ability, (v) => { s.ability = v; }, { title: 'saving throw ability' })),
        field('DC', stepper(() => s.dc, (v) => { s.dc = v; }, { min: 1, max: 30, title: 'save DC' })),
        h('label', { class: 'check', style: 'height:38px' },
          h('input', { type: 'checkbox', checked: !!s.damage, onchange: (e) => { s.damage = e.target.checked ? { count: 4, die: 6, mod: 0, type: 'Poison' } : null; rerender(); } }),
          h('span', null, 'Failed save deals damage')))];
      if (s.damage) {
        rows.push(damageEditor(s.damage));
        rows.push(h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: s.half !== false, onchange: (e) => { s.half = e.target.checked; update(); } }),
          h('span', null, 'Half as much on a success')));
      }
      body.push(group('Save on hit', () => { s.enabled = false; rerender(); }, rows));
    }
    if (a.condition.enabled) body.push(conditionSection(a));
    if (a.healing.enabled) body.push(healingSection(a));
    if (a.showRider || a.rider) body.push(riderSection(a));
    const hasMiss = a.showMiss || a.miss || a.hitOrMiss;
    if (hasMiss) body.push(missSection(a));

    body.push(h('div', { class: 'add-row' },
      addBtn('+ Extra damage', () => { a.extraDamage.push({ count: 2, die: 6, mod: 0, type: 'Fire' }); rerender(); }),
      !a.save.enabled && addBtn('+ Save on hit', () => { a.save.enabled = true; rerender(); }),
      !a.condition.enabled && addBtn('+ Condition', () => { a.condition.enabled = true; rerender(); }),
      !a.healing.enabled && addBtn('+ Healing', () => { a.healing.enabled = true; rerender(); }),
      !(a.showRider || a.rider) && addBtn('+ Rider text', () => { a.showRider = true; rerender(); }),
      !hasMiss && addBtn('+ Miss', () => { a.showMiss = true; rerender(); })));
    return body;
  }

  function saveBody(a) {
    const s = a.save;
    const body = [h('div', { class: 'fields' },
      field('Ability', select(F.ABILITIES, () => s.ability, (v) => { s.ability = v; }, { title: 'saving throw ability' })),
      field('DC', stepper(() => s.dc, (v) => { s.dc = v; }, { min: 1, max: 30, title: 'save DC' })),
      field('Targets', textInput(() => a.area, (v) => { a.area = v; }, { list: 'areas', placeholder: 'each creature in a 30-foot Cone' }), 'field-grow'))];

    if (a.damage) {
      body.push(group('Failure damage', () => { a.damage = null; a.extraDamage = []; rerender(); }, damageEditor(a.damage)));
      a.extraDamage.forEach((d, i) => body.push(group('Extra damage', null, damageEditor(d, () => { a.extraDamage.splice(i, 1); rerender(); }))));
    }
    if (a.condition.enabled) body.push(conditionSection(a));
    if (a.healing.enabled) body.push(healingSection(a));
    if (a.showRider || a.rider) body.push(riderSection(a));

    const success = h('div', { class: 'fields' },
      seg([['half', 'Half damage'], ['none', 'Nothing'], ['custom', 'Custom']], () => a.success, (v) => { a.success = v; }, { label: 'On a success' }));
    if (a.success === 'custom') {
      success.append(h('div', { class: 'field-grow' }, textInput(() => a.successText, (v) => { a.successText = v; }, { placeholder: 'Half damage only.', 'aria-label': 'success text' })));
    }
    const after2014 = a.success === 'custom' && current()?.wording === '2014'
      && h('p', { class: 'hint' }, 'In 2014 wording this follows “On a successful save,”, e.g. “the target takes half damage and isn’t Blinded”.');
    body.push(group('On a success', null, success, a.success === 'custom' && diceHint(), after2014));

    body.push(h('div', { class: 'add-row' },
      !a.damage && addBtn('+ Damage', () => { a.damage = { count: 6, die: 6, mod: 0, type: 'Fire' }; rerender(); }),
      a.damage && addBtn('+ Extra damage', () => { a.extraDamage.push({ count: 2, die: 6, mod: 0, type: 'Cold' }); rerender(); }),
      !a.condition.enabled && addBtn('+ Condition', () => { a.condition.enabled = true; rerender(); }),
      !a.healing.enabled && addBtn('+ Healing', () => { a.healing.enabled = true; rerender(); }),
      !(a.showRider || a.rider) && addBtn('+ Rider text', () => { a.showRider = true; rerender(); })));
    return body;
  }

  function spellsBody(a) {
    const s = a.spells;
    const wording = current()?.wording || '2024';
    const autoLabel = wording === '2014' ? 'Match wording (2014 [spell])' : 'Match wording (2024 [spells])';
    const body = [h('div', { class: 'fields' },
      field('Ability', select(['Intelligence', 'Wisdom', 'Charisma'], () => s.ability, (v) => { s.ability = v; }, { title: 'spellcasting ability' })),
      field('Spell save DC', stepper(() => s.dc, (v) => { s.dc = v; }, { min: 1, max: 30, title: 'spell save DC' })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Spell attack'),
        h('div', { class: 'fields', style: 'gap:10px;align-items:center' },
          h('input', { type: 'checkbox', checked: s.hasAttack !== false, 'aria-label': 'Has spell attacks', class: 'check-inline', onchange: (e) => { s.hasAttack = e.target.checked; rerender(); } }),
          s.hasAttack !== false && stepper(() => s.attack, (v) => { s.attack = v; }, { min: -5, max: 30, title: 'spell attack bonus', signed: true }))),
      field('Spell tooltips', select([['auto', autoLabel], ['2024', '2024 [spells]'], ['2014', '2014 [spell]'], ['plain', 'Plain text (no tags)']], () => s.edition || 'auto', (v) => { s.edition = v; }, { title: 'spell tooltip edition' })),
      field('Components (optional)', textInput(() => s.components, (v) => { s.components = v; }, {
        list: 'components', placeholder: 'requiring no Material components',
      }), 'field-grow'))];

    const groups = s.groups.map((g, i) => h('div', { class: 'spell-group' },
      textInput(() => g.label, (v) => { g.label = v; }, { class: 'input spell-label', list: 'spell-labels', placeholder: 'At Will', 'aria-label': 'How often' }),
      textInput(() => g.spells, (v) => { g.spells = v; }, { class: 'input spell-list', placeholder: 'Detect Magic, Mage Hand, Fireball (level 4 version)', 'aria-label': 'Spells, separated by commas' }),
      iconBtn('x', 'Remove line', () => { s.groups.splice(i, 1); rerender(); })));

    body.push(group('Spells', null,
      groups,
      h('p', { class: 'hint' }, 'Separate spells with commas. Anything in brackets, like “(level 4 version)”, stays outside the tag. Wrap a custom homebrew spell in "quotes" to leave it as plain text.'),
      h('div', { class: 'add-row' },
        addBtn('+ Spell line', () => { s.groups.push({ label: s.groups.length ? `${s.groups.length}/Day Each` : 'At Will', spells: '' }); rerender(); }))));
    return body;
  }

  function textBody(m, a) {
    const isReaction = F.sectionOf(a) === 'reactions';
    const body = [];
    if (isReaction) {
      body.push(field('Trigger (optional)', textInput(() => a.trigger, (v) => { a.trigger = v; }, {
        placeholder: `${m.subject || `The ${m.name || 'creature'}`} is hit by a melee attack roll`,
      })));
    }
    body.push(field(isReaction ? 'Response' : 'Description', h('textarea', {
      class: 'input', rows: '4', placeholder: 'What it does…',
      value: a.description,
      oninput: (e) => { a.description = e.target.value; update(); },
    })), diceHint());
    return body;
  }

  function summarize(a) {
    const dmg = (d) => (d ? `${F.avgDamage(d)} ${d.type}` : '');
    const save = (s) => (s && s.enabled !== false && s.ability ? `DC ${s.dc} ${s.ability.slice(0, 3)}` : '');
    if (a.kind === 'save') return [`DC ${a.save.dc} ${a.save.ability.slice(0, 3)} save`, dmg(a.damage)].filter(Boolean).join(' · ');
    if (a.kind === 'text') {
      const t = String(a.description || '').replace(/\s+/g, ' ').trim();
      return t ? (t.length > 60 ? `${t.slice(0, 60)}…` : t) : 'Text';
    }
    if (a.kind === 'spells') {
      const count = a.spells.groups.reduce((n, g) => n + String(g.spells || '').split(',').filter((x) => x.trim()).length, 0);
      return `DC ${a.spells.dc} ${a.spells.ability.slice(0, 3)} · ${count} spell${count === 1 ? '' : 's'}`;
    }
    return [`${a.toHit >= 0 ? '+' : ''}${a.toHit}`, dmg(a.damage), a.save.enabled && save(a.save)].filter(Boolean).join(' · ');
  }

  // ---------- cards (one open at a time per monster) ----------

  const isOpen = (m, id) => ui.open[m.id] === id;
  function setOpen(m, id) {
    ui.open[m.id] = id;
    ui.addOpen = false;
    rerender();
    const card = document.querySelector(`.card[data-id="${CSS.escape(id || '')}"]`);
    if (card) card.querySelector('.card-name, .collapse')?.focus({ preventScroll: true });
  }

  function cardShell(id, open) {
    const card = h('div', { class: `card ${open ? 'is-open' : ''}`, dataset: { id } });
    card.addEventListener('mouseenter', () => setHot(id));
    card.addEventListener('mouseleave', () => setHot(null));
    return card;
  }

  function collapsedHead(m, id, label, summary, off = false) {
    return h('button', {
      type: 'button', class: `card-toggle ${off ? 'is-off' : ''}`, 'aria-expanded': 'false',
      onclick: () => setOpen(m, id),
    }, h('span', { class: 'card-label' }, label), h('span', { class: 'card-summary' }, summary));
  }

  const collapseBtn = (m) => h('button', {
    type: 'button', class: 'icon-btn collapse', title: 'Close', 'aria-label': 'Close', 'aria-expanded': 'true',
    onclick: () => { ui.open[m.id] = null; rerender(); },
  }, icon('chevron'));

  function actionCard(m, a, index) {
    const open = isOpen(m, a.id);
    const card = cardShell(a.id, open);
    const isLair = F.sectionOf(a) === 'lair';
    if (!open) {
      card.append(collapsedHead(m, a.id, a.name || (isLair ? 'Lair action' : 'Unnamed action'), summarize(a)));
      return card;
    }

    // Up/down move within the action's own section.
    const siblings = inSection(m, F.sectionOf(a));
    const pos = siblings.indexOf(a);
    const move = (dir) => {
      captureUndo(`move “${a.name || 'action'}”`);
      const j = m.actions.indexOf(siblings[pos + dir]);
      [m.actions[index], m.actions[j]] = [m.actions[j], m.actions[index]];
      rerender();
    };
    const kinds = KIND_LABELS.filter(([k]) => k === a.kind || F.kindAllowed(k, F.sectionOf(a)));

    card.append(h('div', { class: 'card-head' },
      collapseBtn(m),
      textInput(() => a.name, (v) => { a.name = v; }, { class: 'card-name', placeholder: isLair ? 'Name (optional)' : 'Action name', 'aria-label': 'Action name' }),
      h('div', { class: 'card-tools' },
        iconBtn('copy', 'Copy this action', () => copyBlocks([a.id])),
        iconBtn('bookmark', 'Save to ability library', () => saveActionSnippet(a)),
        iconBtn('up', 'Move up', () => move(-1), { disabled: pos === 0 }),
        iconBtn('down', 'Move down', () => move(1), { disabled: pos === siblings.length - 1 }),
        iconBtn('dup', 'Duplicate', () => {
          captureUndo(`duplicate “${a.name || 'action'}”`);
          const copy = { ...clone(a), id: uid('a'), name: a.name ? `${a.name} (copy)` : '' };
          m.actions.splice(index + 1, 0, copy);
          ui.open[m.id] = copy.id;
          rerender();
        }),
        iconBtn('trash', 'Delete action', () => {
          const label = a.name || (isLair ? 'lair action' : 'action');
          captureUndo(`delete “${label}”`);
          m.actions.splice(index, 1);
          delete m.multiattack.counts[a.id];
          rerender();
          toast(`Deleted “${label}”.`, false, { label: 'Undo', onclick: undo });
        }, { class: 'danger' })),
      select(kinds, () => a.kind, (v) => {
        captureUndo(`change “${a.name || 'action'}” kind`);
        a.kind = v;
        if (ATTACK_KINDS.includes(v) && !a.damage) a.damage = newDamage();
      }, { structural: true, title: 'kind of action' })));

    const body = h('div', { class: 'card-body' }, warnList(() => F.actionWarnings(a)));
    if (isLair) {
      body.append(h('p', { class: 'hint' }, 'Lair actions are usually unnamed: leave the name empty and the text is pasted as its own paragraph.'));
    }
    if (F.sectionOf(a) === 'traits' && !F.isAttack(a)) {
      body.append(h('p', { class: 'hint' }, 'Traits are passive features: Regeneration, Pack Tactics, Legendary Resistance, auras. Use Usage → Custom for tags like “3/Day, or 4/Day in Lair”.'));
    }
    if (ATTACK_KINDS.includes(a.kind)) body.append(...attackBody(a));
    else if (a.kind === 'save') body.append(...saveBody(a));
    else if (a.kind === 'spells') body.append(...spellsBody(a));
    else body.append(...textBody(m, a));
    body.append(usageControls(a));
    card.append(body);
    return card;
  }

  function multiattackCard(m) {
    const ma = m.multiattack;
    const open = isOpen(m, 'multiattack');
    const attacks = inSection(m, 'actions').filter((a) => F.isAttack(a));
    const card = cardShell('multiattack', open);
    if (!open) {
      const used = attacks.filter((a) => Number(ma.counts[a.id]) > 0).map((a) => a.name || 'Unnamed');
      card.append(collapsedHead(m, 'multiattack', 'Multiattack', ma.enabled ? (used.join(', ') || 'No attacks picked') : 'Off', !ma.enabled));
      return card;
    }
    card.append(h('div', { class: 'card-head' },
      collapseBtn(m),
      h('span', { class: 'card-title' }, 'Multiattack'),
      ma.enabled && iconBtn('copy', 'Copy multiattack', () => copyBlocks(['multiattack']))));
    const body = h('div', { class: 'card-body' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ma.enabled, onchange: (e) => { ma.enabled = e.target.checked; rerender(); } }),
        h('span', null, 'This monster has a Multiattack')));
    if (ma.enabled) {
      body.append(
        attacks.length
          ? h('div', { class: 'multi-list' }, attacks.map((a) => h('div', { class: 'multi-item' },
            stepper(() => Number(ma.counts[a.id] || 0), (v) => { ma.counts[a.id] = v; }, { min: 0, max: 9, title: `${a.name} attacks` }),
            h('span', null, a.name || 'Unnamed'))))
          : h('p', { class: 'hint' }, 'Add an attack below, then set how many times it is used. Only attacks in Actions can be picked.'),
        field('Extra text (optional)', textInput(() => ma.tail, (v) => { ma.tail = v; }, { placeholder: 'It can replace one attack with a use of Spellcasting.' })),
        diceHint(),
        warnList(() => F.multiattackWarnings(m)));
    }
    card.append(body);
    return card;
  }

  function legendaryCard(m) {
    const l = m.legendary;
    const open = isOpen(m, 'legendary-intro');
    const card = cardShell('legendary-intro', open);
    if (!open) {
      const lair = Number(l.lairUses) > Number(l.uses) ? ` (${l.lairUses} in lair)` : '';
      card.append(collapsedHead(m, 'legendary-intro', 'Legendary Action Uses', `${l.uses}${lair} · ${m.wording} wording`));
      return card;
    }
    card.append(
      h('div', { class: 'card-head' },
        collapseBtn(m),
        h('span', { class: 'card-title' }, 'Legendary Action Uses'),
        iconBtn('copy', 'Copy legendary intro', () => copyBlocks(['legendary-intro']))),
      h('div', { class: 'card-body' },
        h('div', { class: 'fields' },
          field('Uses', stepper(() => l.uses, (v) => { l.uses = v; }, { min: 1, max: 9, title: 'legendary action uses' })),
          field('In lair', stepper(() => l.lairUses, (v) => { l.lairUses = v; }, { min: 0, max: 9, title: 'uses in lair' }))),
        h('p', { class: 'hint' }, `Set “In lair” to 0 if it has no lair. Use Usage → Costs actions on an action for “(Costs 2 Actions)”. The intro uses the monster’s ${m.wording} wording; change it under the monster’s name.`)));
    return card;
  }

  function lairCard(m) {
    const l = m.lair;
    const open = isOpen(m, 'lair-intro');
    const card = cardShell('lair-intro', open);
    if (!open) {
      const summary = l.text.trim() ? 'Custom intro' : `Initiative count ${l.initiative}${l.noRepeat ? ' · no repeats' : ''}`;
      card.append(collapsedHead(m, 'lair-intro', 'Lair Actions intro', summary));
      return card;
    }
    card.append(
      h('div', { class: 'card-head' },
        collapseBtn(m),
        h('span', { class: 'card-title' }, 'Lair Actions intro'),
        iconBtn('copy', 'Copy lair actions intro', () => copyBlocks(['lair-intro']))),
      h('div', { class: 'card-body' },
        h('div', { class: 'fields' },
          field('Initiative count', stepper(() => l.initiative, (v) => { l.initiative = v; }, { min: 1, max: 30, title: 'lair action initiative count' })),
          h('label', { class: 'check', style: 'height:38px;align-self:flex-end' },
            h('input', { type: 'checkbox', checked: l.noRepeat, onchange: (e) => { l.noRepeat = e.target.checked; update(); } }),
            h('span', null, 'Can’t use the same effect two rounds in a row'))),
        field('Custom intro (optional)', h('textarea', {
          class: 'input', rows: '3', placeholder: 'Replaces the whole intro paragraph',
          value: l.text, oninput: (e) => { l.text = e.target.value; update(); },
        })),
        diceHint(),
        warnList(() => F.lairWarnings(m)),
        h('p', { class: 'hint' }, `The intro uses 2014 wording and names the monster as “${m.subject || `The ${m.name || 'creature'}`}”. The entries below follow the monster’s ${m.wording} wording.`)));
    return card;
  }

  const DEFAULT_NAMES = { melee: 'Claw', ranged: 'Longbow', both: 'Javelin', spells: 'Spellcasting' };

  function addActionArea(m, key) {
    const toggle = h('button', {
      type: 'button', class: 'add-action', 'aria-expanded': String(ui.addOpen), dataset: { fk: 'add-action' },
      onclick: () => { ui.addOpen = !ui.addOpen; renderEditor(); live.forEach((fn) => fn()); $('.add-action')?.focus(); },
    }, icon('plus'), 'Add action');
    const bar = h('div', { class: 'add-action-bar' },
      toggle,
      h('button', { type: 'button', class: 'btn btn-outline add-secondary', title: 'Insert a saved ability, starter template, or ability from another monster', onclick: () => openAbilityLibraryModal(m, key) }, icon('library'), 'From library'),
      h('button', { type: 'button', class: 'btn btn-outline add-secondary', title: 'Paste an existing action or trait to turn it into an editable card', onclick: () => openPasteActionModal(m, key) }, icon('paste'), 'Paste action'));
    const kinds = ui.addOpen && h('div', { class: 'add-kinds', role: 'group', 'aria-label': 'Kind of action to add' },
      KIND_LABELS.filter(([k]) => F.kindAllowed(k, key)).map(([kind, label]) => addBtn(label, () => {
        const name = key === 'lair' ? '' : DEFAULT_NAMES[kind]
          || (kind === 'save' ? (key === 'traits' ? 'Aura' : 'Breath Weapon') : ({ reactions: 'Parry', traits: 'Pack Tactics' }[key] || 'Ability'));
        captureUndo(`add “${name || 'lair action'}”`);
        const a = newAction(kind, name, key);
        m.actions.push(a);
        ui.open[m.id] = a.id;
        ui.addOpen = false;
        rerender();
        const input = document.querySelector(`.card[data-id="${a.id}"] .card-name`);
        if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); input.select(); }
      })));
    return h('div', { class: 'add-action-wrap' }, bar, kinds);
  }

  // ---------- main area ----------

  function renderHead() {
    const head = $('#monster-head');
    const m = current();
    if (!m) { head.replaceChildren(); return; }
    const title = textInput(() => m.name, (v) => { m.name = v; }, { class: 'monster-title', id: 'monster-title', placeholder: 'Monster name', 'aria-label': 'Monster name', spellcheck: 'false' });
    const subject = textInput(() => m.subject, (v) => { m.subject = v; }, { 'aria-label': 'Creature is called' });
    live.push(() => { subject.placeholder = `The ${m.name || 'creature'}`; });

    const subtitle = h('button', {
      type: 'button', class: 'subtitle', 'aria-expanded': String(ui.details), 'aria-controls': 'details',
      onclick: () => { ui.details = !ui.details; renderAll(); $('.subtitle')?.focus(); },
    });
    live.push(() => {
      const text = L.subtitleOf(m);
      subtitle.replaceChildren(text ? h('span', null, text) : h('span', { class: 'placeholder' }, 'Add size, type, CR and folder'), icon('pencil'));
      subtitle.setAttribute('aria-label', `${text || 'No details yet'}. Edit monster details`);
    });
    const metaInput = (key, attrs) => textInput(() => m.meta[key], (v) => { m.meta[key] = v; }, attrs);
    // Folder changes regroup the sidebar, so they apply when the field is left, not on every key.
    const folder = h('input', {
      class: 'input', type: 'text', list: 'folder-names', value: m.folder, placeholder: 'Unsorted', 'aria-label': 'Folder',
      onchange: (e) => { m.folder = e.target.value.trim(); update(); },
    });

    const cpCount = L.listCheckpoints(checkpoints, m.id).length;
    head.replaceChildren(
      h('div', { class: 'monster-head' },
        title,
        h('div', { class: 'head-tools' },
          iconBtn('history', cpCount ? `Recovery checkpoints (${cpCount})` : 'Recovery checkpoints', () => openCheckpointsModal(m)),
          iconBtn('download', 'Export this monster', () => exportJson(`${slug(m.name)}.json`, { version: 1, monsters: [m] })),
          iconBtn('dup', 'Duplicate monster', () => duplicateMonster(m)),
          iconBtn('trash', 'Delete monster', () => deleteMonster(m), { class: 'danger' }))),
      h('div', { class: 'subtitle-row' }, subtitle),
      ui.details ? h('div', { class: 'details', id: 'details' },
        field('Size', select([['', '—'], 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'], () => m.meta.size, (v) => { m.meta.size = v; }, { title: 'Size' })),
        field('Type', metaInput('type', { list: 'creature-types', placeholder: 'Monstrosity', style: 'width:150px' })),
        field('CR', metaInput('cr', { list: 'crs', placeholder: '7', style: 'width:72px', spellcheck: 'false' })),
        field('Folder', folder),
        field('Creature is called', subject, 'field-grow'),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Wording'),
          seg([['2024', '2024 rules'], ['2014', '2014 rules']], () => m.wording, (v) => { m.wording = v; }, { label: 'Wording' })),
        h('p', { class: 'hint' }, 'Size, type, CR and folder are for your library only and never appear in the copied text. “Creature is called” is how the text names it in Multiattack, Legendary and healing, e.g. “The dragon”. Wording picks 2024 text (“Melee Attack Roll:”, “Failure:”) or 2014 text (“Melee Weapon Attack:”, “taking … on a failed save”) for every section.')) : '');
  }

  function tabCount(m, key) {
    return inSection(m, key).length + (key === 'actions' && F.formatMultiattack(m) ? 1 : 0);
  }

  function renderTabs() {
    const bar = $('#tabs');
    const m = current();
    if (!m) { bar.replaceChildren(); return; }
    const active = tabOf(m);
    const sections = F.formatSections(m);
    keepFocus(bar, () => bar.replaceChildren(...F.SECTIONS.map((s) => {
      const n = tabCount(m, s.key);
      return h('button', {
        type: 'button', role: 'tab', id: `tab-${s.key}`, class: `tab ${n ? '' : 'is-empty'}`,
        'aria-selected': String(s.key === active), 'aria-controls': 'editor', tabindex: s.key === active ? '0' : '-1',
        dataset: { fk: `tab-${s.key}`, key: s.key },
        onclick: () => selectTab(m, s.key),
        onkeydown: (e) => {
          const i = F.SECTIONS.findIndex((x) => x.key === s.key);
          const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: F.SECTIONS.length - 1 }[e.key];
          if (to == null) return;
          e.preventDefault();
          const next = F.SECTIONS[(to + F.SECTIONS.length) % F.SECTIONS.length];
          selectTab(m, next.key);
          $(`#tab-${next.key}`)?.focus();
        },
      },
      h('span', { class: 'tab-name' }, TAB_LABELS[s.key], h('span', { class: 'n' }, String(n))),
      tabState(m, s.key, sections.find((x) => x.key === s.key)));
    })));
    $('#editor').setAttribute('aria-labelledby', `tab-${active}`);
  }

  const statusOf = (m, key, section) =>
    L.copyStatus(m.copied[key], section || { blocks: [] }, F.toPlain, outputOpts());

  function tabState(m, key, section) {
    const st = statusOf(m, key, section);
    if (st.state === 'copied') return h('span', { class: 'tab-state is-copied' }, icon('check'), 'copied');
    if (st.state === 'changed') return h('span', { class: 'tab-state is-changed' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'changed since copy');
    return h('span', { class: 'tab-state' });
  }

  function selectTab(m, key) {
    ui.tab[m.id] = key;
    ui.addOpen = false;
    renderAll();
  }

  function renderEditor() {
    const editor = $('#editor');
    const m = current();
    if (!m) {
      editor.replaceChildren(h('div', { class: 'empty' },
        h('h2', null, 'No monster selected'),
        h('p', null, 'Create a monster to start building its actions.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => newMonster() }, '+ New monster')));
      return;
    }
    const key = tabOf(m);
    const actions = inSection(m, key);
    const box = sectionMeta(key).box;
    keepFocus(editor, () => editor.replaceChildren(...[
      key === 'actions' && multiattackCard(m),
      key === 'legendary' && actions.length && legendaryCard(m),
      key === 'lair' && actions.length && lairCard(m),
      actions.map((a) => actionCard(m, a, m.actions.indexOf(a))),
      !actions.length && key !== 'actions' && h('p', { class: 'empty-editor' }, `Nothing in ${box} yet.`),
      addActionArea(m, key),
    ].flat(Infinity).filter(Boolean)));
  }

  // ---------- output: one D&D Beyond box ----------

  function previewTokens(tokens) {
    return tokens.map((tk) => {
      switch (tk.t) {
        case 'name': return h('span', { class: 'nm' }, tk.v);
        case 'label': return h('span', { class: 'lb' }, tk.v);
        case 'cond': return h('span', { class: 'cond' }, tk.v);
        case 'spell': return h('span', { class: 'spell' }, tk.v);
        case 'action': case 'skill': case 'sense': return h('span', { class: `tag tag-${tk.t}` }, tk.v);
        case 'br': return h('br');
        case 'roll': return rollChip(tk);
        default: return tk.v;
      }
    });
  }

  // ---------- roll readout: what D&D Beyond will get from each rollable ----------

  const rollTokens = new WeakMap();
  let tipFor = null;

  function rollChip(tk) {
    const el = h('span', {
      class: 'roll', tabindex: '0',
      onmouseenter: () => showRollTip(el),
      onmouseleave: () => { if (document.activeElement !== el) hideRollTip(); },
      onfocus: () => showRollTip(el),
      onblur: () => hideRollTip(),
      onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); hideRollTip(); } },
    }, tk.display);
    rollTokens.set(el, tk);
    return el;
  }

  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  function showRollTip(el) {
    const info = F.rollReadout(rollTokens.get(el));
    const tip = $('#roll-tip');
    if (!info) return hideRollTip();
    if (tipFor && tipFor !== el) tipFor.classList.remove('is-open');
    tipFor = el;
    el.classList.add('is-open');
    el.setAttribute('aria-describedby', 'roll-tip');
    const kind = info.missingDamageType ? 'damage, no damage type' : info.label;
    tip.replaceChildren(
      h('div', { class: 'rt-lead' }, 'D&D Beyond will roll'),
      h('div', { class: 'rt-main' },
        h('span', { class: 'rt-dice' }, info.notation),
        h('span', { class: `rt-kind ${info.missingDamageType ? 'is-missing' : ''}` }, kind)),
      h('div', { class: 'rt-foot' },
        info.average != null && h('span', null, 'Average', h('b', null, fmtNum(info.average))),
        info.min != null && h('span', null, 'Range', h('b', null, `${info.min}–${info.max}`)),
        h('span', null, 'Roll action', h('b', null, info.action || '(none)'))));
    tip.hidden = false;
    // Below the value, or above it when there's no room; kept inside the window.
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, ht = tip.offsetHeight;
    const center = r.left + r.width / 2;
    const left = Math.min(Math.max(8, center - w / 2), window.innerWidth - w - 8);
    const above = r.bottom + 10 + ht > window.innerHeight - 8 && r.top - 10 - ht > 8;
    tip.classList.toggle('is-above', above);
    tip.style.left = `${left}px`;
    tip.style.top = `${above ? r.top - 10 - ht : r.bottom + 10}px`;
    tip.style.setProperty('--arrow-x', `${Math.min(Math.max(14, center - left), w - 14)}px`);
  }

  function hideRollTip() {
    if (tipFor) { tipFor.classList.remove('is-open'); tipFor.removeAttribute('aria-describedby'); }
    tipFor = null;
    $('#roll-tip').hidden = true;
  }

  function currentSection(m) {
    const key = tabOf(m);
    return F.formatSections(m).find((s) => s.key === key) || { ...sectionMeta(key), blocks: [] };
  }

  /** "You changed Bite after copying…" next to the Copy button, only when the box changed. */
  function copyNote(m, s) {
    const msg = L.changeMessage(statusOf(m, s.key, s));
    if (!msg.length) return h('span', { class: 'copy-note' });
    return h('p', { class: 'copy-note' }, h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('span', null, msg.map((part) => (part.strong ? h('strong', null, part.text) : part.text))));
  }

  function renderOutput() {
    hideRollTip();
    const out = $('#output');
    const m = current();
    if (!m) { out.replaceChildren(); return; }
    const s = currentSection(m);
    const sheet = view === 'preview'
      ? h('article', { class: 'sheet', 'aria-label': `${s.box} preview` },
        h('h2', { class: 'sheet-title' }, s.box),
        s.blocks.length
          ? s.blocks.map((b) => {
            const name = L.blockName(b);
            return h('div', {
              class: 'sb-block', dataset: { id: b.id }, title: 'Click to copy',
              onclick: (e) => { if (!e.target.closest('button')) copyBlocks([b.id]); },
              onmouseenter: () => setHot(b.id),
              onmouseleave: () => setHot(null),
            },
            h('p', null, previewTokens(b.tokens)),
            h('button', { type: 'button', class: 'icon-btn block-copy', 'aria-label': `Copy ${name}`, title: `Copy ${name}`, dataset: { fk: `copy-${b.id}` }, onclick: () => copyBlocks([b.id]) }, icon('copy')));
          })
          : h('p', { class: 'sb-empty' }, `Nothing in ${s.box} yet. Add something on the left.`))
      : h('textarea', { class: 'raw', readonly: true, spellcheck: 'false', 'aria-label': `Paste text for ${s.box}`, value: F.sectionsToClipboard([s], outputOpts()).text });

    keepFocus(out, () => out.replaceChildren(
      h('div', { class: 'output-head' },
        copyNote(m, s),
        h('button', { type: 'button', class: 'btn btn-primary', dataset: { fk: 'copy-section' }, onclick: () => copySection(s.key) }, icon('copy'), `Copy ${s.box}`)),
      sheet,
      h('div', { class: 'output-foot' },
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Show' },
          [['preview', 'Preview'], ['raw', 'Paste text']].map(([v, label]) => h('button', {
            type: 'button', role: 'radio', class: `seg-btn ${view === v ? 'is-on' : ''}`, 'aria-checked': String(view === v), dataset: { fk: `view-${v}` },
            onclick: () => { view = v; renderOutput(); },
          }, label))),
        h('label', { class: 'check', title: 'Wraps action names in **double asterisks** in the plain text' },
          h('input', { type: 'checkbox', checked: !!lib.settings.markdownBold, dataset: { fk: 'md' }, onchange: (e) => { lib.settings.markdownBold = e.target.checked; update(); } }),
          h('span', null, '**Bold** names')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Copy every section (Ctrl+Shift+C)', dataset: { fk: 'copy-all' }, onclick: copyAll }, 'Copy all sections'))));
  }

  function setHot(id) {
    document.querySelectorAll('.is-hot').forEach((el) => el.classList.remove('is-hot'));
    if (!id) return;
    document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('is-hot'));
  }

  /** Writes to the clipboard, flashes the copied blocks and their cards, and shows a toast. */
  async function copyOut(blocks, payload, message) {
    if (!blocks.length) { toast('Nothing to copy yet', true); return false; }
    try {
      await writeClipboard(payload.text, payload.html);
    } catch {
      toast('Copy failed. Use the Paste text view instead.', true);
      return false;
    }
    for (const b of blocks) {
      document.querySelectorAll(`[data-id="${CSS.escape(b.id)}"]`).forEach((el) => {
        el.classList.remove('flash', 'copied');
        void el.offsetWidth;
        el.classList.add(el.classList.contains('sb-block') ? 'copied' : 'flash');
        setTimeout(() => el.classList.remove('copied'), 1200);
      });
    }
    toast(message);
    return true;
  }

  function copyBlocks(ids) {
    const m = current();
    if (!m) return;
    const blocks = F.formatMonster(m).filter((b) => ids.includes(b.id));
    const label = blocks.length ? L.blockName(blocks[0]) : '';
    const where = blocks.length ? sectionMeta(blocks[0].section).box : '';
    copyOut(blocks, F.blocksToClipboard(blocks.map((b) => b.tokens), outputOpts()),
      `Copied “${label}”. Paste it into the ${where} box.`);
  }

  async function copySection(key) {
    const m = current();
    const s = m && F.formatSections(m).find((x) => x.key === key);
    if (!s) return toast('Nothing to copy yet', true);
    const ok = await copyOut(s.blocks, F.sectionsToClipboard([s], outputOpts()), `Copied all ${s.box}. Paste them into the ${s.box} box.`);
    if (!ok) return;
    m.copied[key] = L.snapshotSection(s, F.toPlain, outputOpts());
    recordMonsterCheckpoint(m, 'copy', `Last copied · ${s.box}`);
    renderHead();
    renderTabs();
    renderOutput();
    scheduleSave();
  }

  async function copyAll() {
    const m = current();
    if (!m) return;
    const sections = F.formatSections(m);
    const blocks = sections.flatMap((s) => s.blocks);
    const message = sections.length > 1
      ? `Copied everything, with ${sections.map((s) => s.title).join(', ')} headings.`
      : `Copied ${blocks.length} action${blocks.length === 1 ? '' : 's'}.`;
    const ok = await copyOut(blocks, F.sectionsToClipboard(sections, outputOpts()), message);
    if (ok) {
      recordMonsterCheckpoint(m, 'copy', 'Last copied · All sections');
      renderHead();
    }
  }

  let toastTimer = null;
  function toast(message, isError = false, action = null) {
    const el = $('#toast');
    const actBtn = action && h('button', {
      type: 'button', class: 'btn btn-sm toast-btn',
      onclick: () => { el.classList.remove('show'); clearTimeout(toastTimer); action.onclick(); },
    }, action.label);
    el.replaceChildren(icon(isError ? 'alert' : 'check'), h('span', null, message), actBtn);
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
  }

  // ---------- library ----------

  const slug = (s) => (s || 'monster').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'monster';

  const FOLDERS_KEY = 'stat-forge-collapsed-folders';
  const LEGACY_FOLDERS_KEY = 'statblock-builder-collapsed-folders';
  const collapsed = new Set((() => { try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) || localStorage.getItem(LEGACY_FOLDERS_KEY)) || []; } catch { return []; } })());
  const saveCollapsed = () => { try { localStorage.setItem(FOLDERS_KEY, JSON.stringify([...collapsed])); } catch { /* per-browser nicety only */ } };
  const folderKey = (name) => String(name || '').trim().toLowerCase();
  let newFolderOpen = false;

  function monsterRow(m) {
    const on = m.id === lib.currentId;
    const kind = [m.meta.size, m.meta.type].map((x) => x.trim()).filter(Boolean).join(' ');
    return h('li', null, h('button', {
      type: 'button', class: `monster-item ${on ? 'is-on' : ''}`, 'aria-current': on ? 'true' : null,
      draggable: 'true', dataset: { fk: `m-${m.id}` },
      onclick: () => selectMonster(m.id),
      ondragstart: (e) => { e.dataTransfer.setData('text/x-monster-id', m.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('is-dragging'); },
      ondragend: (e) => e.currentTarget.classList.remove('is-dragging'),
    },
    h('span', { class: 'monster-name' }, m.name || 'Unnamed Monster'),
    kind && h('span', { class: 'monster-type' }, kind),
    m.meta.cr.trim() && h('span', { class: 'cr' }, `CR ${m.meta.cr.trim()}`)));
  }

  function folderGroup(g, searching) {
    const key = folderKey(g.key);
    const cur = current();
    const isCurrent = !!cur && folderKey(cur.folder) === key && g.monsters.includes(cur);
    const open = searching || isCurrent || !collapsed.has(key);
    const wrap = h('div', { class: 'folder', dataset: { folder: g.key } });
    const accepts = (e) => [...e.dataTransfer.types].includes('text/x-monster-id');
    wrap.addEventListener('dragover', (e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; wrap.classList.add('is-drop'); } });
    wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('is-drop'); });
    wrap.addEventListener('drop', (e) => {
      wrap.classList.remove('is-drop');
      const m = lib.monsters.find((x) => x.id === e.dataTransfer.getData('text/x-monster-id'));
      if (!m) return;
      e.preventDefault();
      captureUndo(`move “${m.name || 'monster'}” to ${g.name}`);
      m.folder = g.key;
      collapsed.delete(key);
      saveCollapsed();
      rerender();
      toast(`Moved ${m.name || 'the monster'} to ${g.name}.`);
    });
    wrap.append(
      h('div', { class: 'folder-row' },
        h('button', {
          type: 'button', class: `folder-head ${isCurrent ? 'is-current' : ''}`, 'aria-expanded': String(open), dataset: { fk: `f-${key}` },
          title: isCurrent ? 'The current monster’s folder stays open' : null,
          onclick: () => {
            if (isCurrent || searching) return;
            if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
            saveCollapsed();
            renderLibrary();
          },
        },
        h('span', { class: 'chev' }, icon('chevron')), icon('folder'),
        h('span', { class: 'folder-name' }, g.name),
        h('span', { class: 'count' }, String(g.monsters.length))),
        g.key && h('div', { class: 'folder-tools' }, iconBtn('trash', `Delete folder ${g.name}`, () => deleteFolder(g), { class: 'danger' }))),
      !open ? '' : g.monsters.length
        ? h('ul', { class: 'folder-list' }, g.monsters.map(monsterRow))
        : h('p', { class: 'monster-empty' }, 'Empty. Drag a monster here, or set its folder under its name.'));
    return wrap;
  }

  function deleteFolder(g) {
    captureUndo(`delete folder “${g.name}”`);
    const key = folderKey(g.key);
    lib.monsters.forEach((m) => { if (folderKey(m.folder) === key) m.folder = ''; });
    lib.folders = lib.folders.filter((f) => folderKey(f) !== key);
    collapsed.delete(key);
    saveCollapsed();
    rerender();
    toast(`Deleted folder “${g.name}”.`, false, { label: 'Undo', onclick: undo });
  }

  function renderNewFolder() {
    const slot = $('#new-folder');
    if (!newFolderOpen) {
      slot.replaceChildren(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { newFolderOpen = true; renderNewFolder(); slot.querySelector('input').focus(); } }, '+ New folder'));
      return;
    }
    const input = h('input', { class: 'input', type: 'text', placeholder: 'Folder name', 'aria-label': 'New folder name', maxlength: '60' });
    const close = () => { newFolderOpen = false; renderNewFolder(); slot.querySelector('button')?.focus(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    slot.replaceChildren(h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return close();
        const exists = lib.folders.concat(lib.monsters.map((m) => m.folder)).some((f) => folderKey(f) === folderKey(name));
        if (!exists) lib.folders.push(name);
        newFolderOpen = false;
        renderNewFolder();
        update();
        toast(exists ? `“${name}” already exists.` : `Made the folder “${name}”. Drag monsters onto it, or pick it under a monster’s name.`, exists);
      },
    }, input, h('button', { type: 'submit', class: 'btn' }, 'Add'), iconBtn('x', 'Cancel', close)));
  }

  function renderLibrary() {
    const list = $('#monster-list');
    const q = query.trim();
    const shown = q ? L.searchMonsters(lib.monsters, q).map((r) => r.monster) : lib.monsters;
    // Keep the datalist of folder names fresh for the folder field.
    const names = L.groupByFolder(lib.monsters, lib.folders).filter((g) => g.key).map((g) => g.name);
    $('#folder-names').replaceChildren(...names.map((n) => h('option', { value: n })));
    if (!shown.length) {
      list.replaceChildren(h('p', { class: 'monster-empty' }, lib.monsters.length ? `No monsters match “${q}”.` : 'No monsters yet.'));
      return;
    }
    // Search results keep their folder grouping but in library order, so rows don't jump while typing.
    const keep = new Set(shown);
    const groups = L.groupByFolder(lib.monsters.filter((m) => keep.has(m)), q ? [] : lib.folders);
    keepFocus(list, () => list.replaceChildren(...groups.map((g) => folderGroup(g, !!q))));
  }

  function selectMonster(id) {
    lib.currentId = id;
    ui.details = false;
    ui.addOpen = false;
    $('#main').scrollTop = 0;
    setDrawer(false);
    rerender();
  }

  function newMonster(name) {
    captureUndo('new monster');
    const m = normalizeMonster({ name: typeof name === 'string' && name.trim() ? name.trim() : 'New Monster', actions: [newAction('melee', 'Claw')] });
    lib.monsters.unshift(m);
    query = '';
    $('#search').value = '';
    ui.open[m.id] = m.actions[0].id;
    selectMonster(m.id);
    const title = $('#monster-title');
    if (title) { title.focus(); title.select(); }
    return m;
  }

  function duplicateMonster(m) {
    captureUndo(`duplicate “${m.name || 'monster'}”`);
    const copy = withNewIds(m);
    copy.name = `${m.name} (copy)`;
    lib.monsters.splice(lib.monsters.indexOf(m) + 1, 0, copy);
    selectMonster(copy.id);
  }

  function deleteMonster(m) {
    const label = m.name || 'this monster';
    captureUndo(`delete “${label}”`);
    const i = lib.monsters.indexOf(m);
    lib.monsters.splice(i, 1);
    const next = lib.monsters[Math.min(i, lib.monsters.length - 1)];
    selectMonster(next ? next.id : null);
    toast(`Deleted “${label}”.`, false, { label: 'Undo', onclick: undo });
  }

  function normalizeSnippet(raw) {
    if (!isObj(raw)) return null;
    const action = normalizeAction(isObj(raw.action) ? raw.action : raw);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('sn'),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : (action.name || 'Unnamed ability'),
      savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now(),
      action,
    };
  }

  function saveActionSnippet(a) {
    const cleanCopy = normalizeAction(clone(a));
    cleanCopy.id = uid('a');
    const name = cleanCopy.name.trim() || 'Unnamed ability';
    captureUndo(`save “${name}” to library`);
    lib.snippets.unshift({ id: uid('sn'), name, savedAt: Date.now(), action: cleanCopy });
    resetBaseline();
    scheduleSave();
    toast(`Saved “${name}” to your ability library.`);
  }

  async function importMonsters() {
    let data;
    try {
      data = await importJson();
    } catch {
      return toast('That file isn’t valid JSON.', true);
    }
    if (!data) return;
    const candidates = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.monsters) ? data.monsters : isObj(data) && Array.isArray(data.actions) ? [data] : [];
    const raw = candidates.filter((r) => isObj(r) && (typeof r.name === 'string' || Array.isArray(r.actions)));
    const rawSnippets = isObj(data) && Array.isArray(data.snippets) ? data.snippets.map(normalizeSnippet).filter(Boolean) : [];
    if (!raw.length && !rawSnippets.length) return toast('No monsters or abilities found in that file.', true);
    captureUndo('import');
    if (current()) recordMonsterCheckpoint(current(), 'import', 'Before import');
    const ids = new Set(lib.monsters.map((m) => m.id));
    const added = raw.map((r) => {
      const m = normalizeMonster(r);
      return ids.has(m.id) ? withNewIds(m) : m;
    });
    if (added.length) lib.monsters.unshift(...added);
    if (rawSnippets.length) {
      const sIds = new Set(lib.snippets.map((s) => s.id));
      for (const s of rawSnippets) lib.snippets.push(sIds.has(s.id) ? { ...s, id: uid('sn') } : s);
    }
    if (added.length) selectMonster(added[0].id);
    else rerender();
    const parts = [];
    if (added.length) parts.push(`${added.length} monster${added.length === 1 ? '' : 's'}`);
    if (rawSnippets.length) parts.push(`${rawSnippets.length} saved abilit${rawSnippets.length === 1 ? 'y' : 'ies'}`);
    toast(`Imported ${parts.join(' and ')}.`, false, { label: 'Undo', onclick: undo });
  }

  function exportAll() {
    if (!lib.monsters.length && !lib.snippets.length) return toast('Nothing to export yet.', true);
    const payload = { version: 1, monsters: lib.monsters };
    if (lib.snippets.length) payload.snippets = lib.snippets;
    exportJson('stat-forge-monsters.json', payload);
  }

  // ---------- reusable modal dialog ----------

  const modal = { open: false, returnTo: null };

  function openModal({ title, subtitle = '', wide = false, body, focus }) {
    closeFinder();
    setDrawer(false);
    modal.open = true;
    modal.returnTo = document.activeElement;
    const host = $('#modal');
    const box = h('div', { class: `modal-box ${wide ? 'is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' },
        h('div', { class: 'modal-title-wrap' },
          h('h2', { class: 'modal-title' }, title),
          subtitle && h('p', { class: 'modal-sub' }, subtitle)),
        iconBtn('x', 'Close', closeModal)),
      h('div', { class: 'modal-body' }, body));
    host.replaceChildren(h('div', { class: 'finder-scrim', onclick: closeModal }), box);
    host.hidden = false;
    const target = typeof focus === 'function' ? focus(box) : box.querySelector('input, textarea, button');
    if (target) target.focus();
  }

  function closeModal() {
    if (!modal.open) return;
    modal.open = false;
    const host = $('#modal');
    host.hidden = true;
    host.replaceChildren();
    const back = modal.returnTo;
    if (back && document.contains(back)) back.focus();
  }

  // ---------- lightweight milestone checkpoints modal ----------

  function openCheckpointsModal(m) {
    const renderBody = () => {
      const list = L.listCheckpoints(checkpoints, m.id);
      if (!list.length) {
        return h('div', { class: 'cp-empty' },
          h('p', null, 'No recovery checkpoints for this monster yet.'),
          h('p', { class: 'hint' }, 'Stat Forge automatically keeps milestone snapshots in this browser: before your first edit of a session, whenever you copy a section for D&D Beyond, and before imports. Checkpoints stay local and never bloat exported JSON files.'));
      }
      return h('div', { class: 'cp-wrap' },
        h('p', { class: 'hint' }, 'Milestone snapshots are kept locally in this browser (never exported). Restoring one can always be undone with Ctrl+Z.'),
        h('ul', { class: 'cp-list' }, list.map((cp) => {
          const same = L.monsterContentHash(m) === cp.hash;
          return h('li', { class: 'cp-item' },
            h('div', { class: 'cp-info' },
              h('div', { class: 'cp-head' },
                h('span', { class: `cp-badge is-${cp.kind}` }, cp.label),
                h('span', { class: 'cp-when' }, L.relativeTime(cp.at)),
                same && h('span', { class: 'cp-same' }, 'matches current')),
              h('div', { class: 'cp-summary' }, L.checkpointSummary(cp.monster))),
            h('button', {
              type: 'button', class: 'btn btn-sm', disabled: same,
              onclick: () => {
                captureUndo(`restore “${cp.label}”`);
                const idx = lib.monsters.findIndex((x) => x.id === m.id);
                if (idx === -1) return;
                const restored = normalizeMonster(clone(cp.monster));
                restored.id = m.id;
                lib.monsters[idx] = restored;
                ui.open[m.id] = null;
                closeModal();
                rerender();
                toast(`Restored “${cp.label}”.`, false, { label: 'Undo', onclick: undo });
              },
            }, 'Restore'));
        })));
    };
    openModal({
      title: `Checkpoints · ${m.name || 'Unnamed Monster'}`,
      subtitle: 'Restore a previous copy or pre-edit milestone',
      body: renderBody(),
    });
  }

  // ---------- D&D Beyond markup checker & repairer modal ----------

  function openDdbCheckerModal() {
    const state = {
      input: '',
      spellEdition: 'any',
      alignDice: true,
    };
    const body = h('div', { class: 'tool-modal' });
    const textarea = h('textarea', {
      class: 'input tool-input', rows: '6', spellcheck: 'false',
      placeholder: 'Paste raw text from a D&D Beyond homebrew box (e.g. Claw. Melee Weapon Attack: [rollable]+6;{“diceNotaion”:“1d20+6”, ...}[/rollable])…',
      oninput: (e) => { state.input = e.target.value; refresh(); },
    });
    const results = h('div', { class: 'tool-results' });

    function refresh() {
      const text = state.input;
      if (!text.trim()) {
        results.replaceChildren(h('p', { class: 'hint' },
          'Checks for curly quotes, missing quotes or closing tags, misspelled keys like diceNotaion, display-vs-dice mismatches, missing rollDamageType, and 2014/2024 spell tags. Nothing leaves your browser.'));
        return;
      }
      const res = D.analyzeDdbMarkup(text, { spellEdition: state.spellEdition, alignDice: state.alignDice });
      const summary = res.issues.length === 0
        ? h('div', { class: 'check-banner is-ok' }, icon('check'),
          h('span', null, res.rollCount ? `All ${res.rollCount} rollable block${res.rollCount === 1 ? '' : 's'} passed checks. Test in D&D Beyond to confirm.` : 'No markup issues found (no [rollable] tags detected).'))
        : h('div', { class: `check-banner ${res.remainingCount ? 'is-warn' : 'is-ok'}` },
          icon(res.remainingCount ? 'alert' : 'check'),
          h('span', null, `${res.fixedCount} fixed automatically` + (res.remainingCount ? ` · ${res.remainingCount} need${res.remainingCount === 1 ? 's' : ''} review` : ' · ready to copy')));

      const issueList = res.issues.length ? h('ul', { class: 'issue-list' }, res.issues.map((it) => h('li', { class: `issue ${it.fixed ? 'is-fixed' : `is-${it.severity}`}` },
        h('span', { class: 'issue-tag' }, it.fixed ? 'Fixed' : it.severity === 'error' ? 'Error' : 'Check'),
        h('div', { class: 'issue-body' },
          h('div', { class: 'issue-msg' }, it.message),
          it.snippet && h('code', { class: 'issue-snip' }, it.snippet))))) : '';

      const repairedBox = h('div', { class: 'tool-out' },
        h('div', { class: 'tool-out-head' },
          h('span', { class: 'field-label' }, res.fixedCount ? 'Repaired text' : 'Checked text'),
          h('button', {
            type: 'button', class: 'btn btn-primary btn-sm',
            onclick: async () => {
              try {
                await writeClipboard(res.repaired, `<p>${F.escapeHtml(res.repaired).replace(/\n/g, '<br>')}</p>`);
                toast('Copied repaired D&D Beyond text.');
              } catch {
                toast('Copy failed — select the text below instead.', true);
              }
            },
          }, icon('copy'), 'Copy fixed text')),
        h('textarea', { class: 'raw tool-raw', readonly: true, spellcheck: 'false', value: res.repaired, 'aria-label': 'Repaired D&D Beyond text' }));

      results.replaceChildren(summary, issueList, repairedBox);
    }

    const controls = h('div', { class: 'tool-controls' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Spell tags'),
        seg([['any', 'Keep as-is'], ['2024', '2024 [spells]'], ['2014', '2014 [spell]']], () => state.spellEdition, (v) => { state.spellEdition = v; }, { label: 'Spell tag edition', onChange: refresh })),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: state.alignDice, onchange: (e) => { state.alignDice = e.target.checked; refresh(); } }),
        h('span', null, 'Auto-align roll JSON when it differs from displayed dice')));

    body.append(textarea, controls, results);
    refresh();
    openModal({
      title: 'Check & Repair D&D Beyond Markup',
      subtitle: 'Paste broken [rollable] or tooltip text to diagnose and fix common syntax issues',
      wide: true,
      body,
      focus: () => textarea,
    });
  }

  // ---------- reusable ability library modal ----------

  function insertAbilityIntoMonster(m, rawAction, targetSection, undoLabel) {
    captureUndo(undoLabel);
    const copy = normalizeAction(clone(rawAction));
    copy.id = uid('a');
    if (F.kindAllowed(copy.kind, targetSection)) copy.section = targetSection;
    else if (!F.kindAllowed(copy.kind, F.sectionOf(copy))) copy.section = 'actions';
    m.actions.push(copy);
    ui.tab[m.id] = F.sectionOf(copy);
    ui.open[m.id] = copy.id;
    ui.addOpen = false;
    closeModal();
    rerender();
    const card = document.querySelector(`.card[data-id="${copy.id}"] .card-name`);
    if (card) card.scrollIntoView({ block: 'center' });
    toast(`Inserted “${copy.name || 'ability'}” into ${sectionMeta(copy.section).title}.`, false, { label: 'Undo', onclick: undo });
  }

  function openAbilityLibraryModal(m, sectionKey) {
    const state = { query: '', source: 'all' };
    const body = h('div', { class: 'tool-modal' });
    const searchInput = h('input', {
      class: 'input lib-search', type: 'search', placeholder: 'Search by name, damage type, condition, or monster…',
      autocomplete: 'off', 'aria-label': 'Search abilities',
      oninput: (e) => { state.query = e.target.value; refresh(); },
    });
    const listWrap = h('div', { class: 'lib-results' });

    function collectItems() {
      const saved = (lib.snippets || []).map((sn) => ({
        id: sn.id, name: sn.name || sn.action.name || 'Unnamed ability', source: 'saved',
        origin: 'Saved', snippetId: sn.id, action: sn.action,
      }));
      const fromMonsters = [];
      for (const mon of lib.monsters) {
        if (mon.id === m.id) continue;
        for (const a of mon.actions || []) {
          fromMonsters.push({
            id: `${mon.id}:${a.id}`, name: a.name || 'Unnamed action', source: 'monsters',
            origin: mon.name || 'Unnamed Monster', action: a,
          });
        }
      }
      const starters = L.starterTemplates().map((t) => ({ ...t, origin: 'Starter template' }));
      if (state.source === 'saved') return saved;
      if (state.source === 'monsters') return fromMonsters;
      if (state.source === 'starter') return starters;
      return [...saved, ...starters, ...fromMonsters];
    }

    function refresh() {
      const pool = collectItems();
      const hits = L.searchAbilities(pool, state.query);
      if (!hits.length) {
        const msg = state.source === 'saved' && !lib.snippets.length
          ? 'No saved abilities yet. Open any action card and click its bookmark icon to save it here.'
          : state.source === 'monsters' && lib.monsters.length <= 1
            ? 'No other monsters in your library yet.'
            : `No abilities match “${state.query.trim()}”.`;
        listWrap.replaceChildren(h('p', { class: 'monster-empty' }, msg));
        return;
      }
      listWrap.replaceChildren(h('ul', { class: 'lib-list' }, hits.slice(0, 60).map(({ item, ranges }) => {
        const a = item.action;
        const secTitle = sectionMeta(F.sectionOf(a)).title;
        return h('li', { class: 'lib-item' },
          h('div', { class: 'lib-item-main' },
            h('div', { class: 'lib-item-head' },
              h('span', { class: 'lib-item-name' }, L.highlightPieces(item.name, ranges).map((p) => (p.hit ? h('mark', null, p.text) : p.text))),
              h('span', { class: `lib-badge is-${item.source}` }, item.origin),
              h('span', { class: 'lib-sec' }, secTitle)),
            h('div', { class: 'lib-item-sum' }, summarize(normalizeAction(a)))),
          h('div', { class: 'lib-item-actions' },
            item.source === 'saved' && iconBtn('trash', `Remove “${item.name}” from library`, () => {
              captureUndo(`remove “${item.name}” from library`);
              lib.snippets = lib.snippets.filter((s) => s.id !== item.snippetId);
              resetBaseline();
              scheduleSave();
              refresh();
              toast(`Removed “${item.name}” from your library.`, false, { label: 'Undo', onclick: undo });
            }, { class: 'danger' }),
            h('button', {
              type: 'button', class: 'btn btn-sm',
              onclick: () => insertAbilityIntoMonster(m, a, sectionKey, `insert “${item.name}”`),
            }, 'Insert')));
      })));
    }

    const filterRow = h('div', { class: 'lib-top' },
      searchInput,
      seg([
        ['all', 'All'],
        ['saved', `Saved (${lib.snippets.length})`],
        ['starter', 'Starters'],
        ['monsters', 'Your monsters'],
      ], () => state.source, (v) => { state.source = v; }, { label: 'Filter ability source', onChange: refresh }));

    body.append(
      filterRow,
      h('p', { class: 'hint' }, 'Inserting always creates an independent copy — editing it on this monster won’t change any other monster or template.'),
      listWrap);
    refresh();
    openModal({
      title: 'Insert from Ability Library',
      subtitle: 'Reuse saved traits & actions, starter templates, or abilities from your other monsters',
      wide: true,
      body,
      focus: () => searchInput,
    });
  }

  // ---------- paste existing action modal ----------

  function openPasteActionModal(m, sectionKey) {
    const state = { raw: '', mode: 'structured', userPickedMode: false };
    const body = h('div', { class: 'tool-modal' });
    const textarea = h('textarea', {
      class: 'input tool-input', rows: '5',
      placeholder: 'Paste an action, trait, or spellcasting block (plain text, Markdown, or D&D Beyond text)…\nExample: Claw. Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage.',
      oninput: (e) => { state.raw = e.target.value; refresh(); },
    });
    const results = h('div', { class: 'tool-results' });

    function refresh() {
      if (!state.raw.trim()) {
        results.replaceChildren(h('p', { class: 'hint' },
          'Recognizes 2014 & 2024 attacks, saving throws, spellcasting, and reaction triggers. You can always choose “Keep exact wording” to preserve unusual mechanics while still converting dice and conditions into clickable rolls.'));
        return;
      }
      const parsed = D.parseActionText(state.raw, { section: sectionKey });
      if (!parsed.exactText) return;
      const hasStruct = !!parsed.structured;
      if (!state.userPickedMode) state.mode = hasStruct ? 'structured' : 'exact';
      const activeMode = hasStruct && state.mode === 'structured' ? 'structured' : 'exact';
      const chosenRaw = activeMode === 'structured' ? parsed.structured.action : parsed.exactText.action;
      const chosen = normalizeAction(chosenRaw);
      const targetSec = F.kindAllowed(chosen.kind, sectionKey) ? sectionKey : F.sectionOf(chosen);
      chosen.section = targetSec;

      const ctx = { subject: m.subject || `The ${m.name || 'creature'}`, wording: m.wording || '2024' };
      const previewToks = F.formatAction(chosen, ctx);
      const warnings = F.actionWarnings(chosen);
      const notes = activeMode === 'structured' ? parsed.structured.notes : [];

      const modeRow = h('div', { class: 'tool-controls' },
        hasStruct
          ? seg([
            ['structured', `Editable fields (${parsed.structured.recognized})`],
            ['exact', 'Keep exact wording'],
          ], () => activeMode, (v) => { state.mode = v; state.userPickedMode = true; }, { label: 'Import mode', onChange: refresh })
          : h('div', { class: 'check-banner is-ok' }, icon('check'),
            h('span', null, `Keeping exact wording as a Text card (${parsed.exactText.convertedCount} inline roll${parsed.exactText.convertedCount === 1 ? '' : 's'}/tag${parsed.exactText.convertedCount === 1 ? '' : 's'} detected).`)));

      const noteBox = (notes.length || warnings.length) ? h('div', { class: 'warn-list' },
        ...notes.map((n) => h('p', { class: 'warn' }, icon('alert'), h('span', null, n))),
        ...warnings.map((w) => h('p', { class: 'warn' }, icon('alert'), h('span', null, w)))) : '';

      const previewSheet = h('article', { class: 'sheet paste-preview' },
        h('div', { class: 'sb-block' }, h('p', null, previewTokens(previewToks))));

      const foot = h('div', { class: 'modal-foot' },
        h('span', { class: 'hint' }, `Adds to ${sectionMeta(targetSec).title} · hover underlined rolls to inspect`),
        h('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: () => {
            recordMonsterCheckpoint(m, 'import', 'Before paste');
            insertAbilityIntoMonster(m, chosen, targetSec, `paste “${chosen.name || 'action'}”`);
          },
        }, icon('plus'), `Add to ${sectionMeta(targetSec).title}`));

      results.replaceChildren(modeRow, noteBox, previewSheet, foot);
    }

    body.append(textarea, results);
    refresh();
    openModal({
      title: 'Paste Existing Action or Trait',
      subtitle: 'Turn plain text, Markdown, or D&D Beyond prose into an editable Stat Forge card',
      wide: true,
      body,
      focus: () => textarea,
    });
  }

  // ---------- Ctrl+K finder ----------

  const finder = { open: false, query: '', active: 0, items: [], returnTo: null };

  function finderItems(q) {
    const results = L.searchMonsters(lib.monsters, q).slice(0, 40);
    const items = results.map((r) => ({ kind: 'monster', monster: r.monster, ranges: r.ranges }));
    items.push({ kind: 'new', name: q.trim() });
    return items;
  }

  function openFinder() {
    if (finder.open) return;
    finder.open = true;
    finder.returnTo = document.activeElement;
    finder.query = '';
    finder.active = 0;
    setDrawer(false);
    const box = $('#finder');
    const input = h('input', {
      type: 'text', placeholder: 'Find a monster', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'finder-list', 'aria-autocomplete': 'list', 'aria-label': 'Find a monster',
      oninput: (e) => { finder.query = e.target.value; finder.active = 0; renderFinderList(); },
      onkeydown: finderKeys,
    });
    box.replaceChildren(
      h('div', { class: 'finder-scrim', onclick: closeFinder }),
      h('div', { class: 'finder-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Find a monster' },
        h('div', { class: 'finder-top' }, icon('search'), input, h('kbd', { class: 'kbd' }, 'Esc')),
        h('ul', { class: 'finder-list', id: 'finder-list', role: 'listbox', 'aria-label': 'Results' }),
        h('div', { class: 'finder-foot', 'aria-hidden': 'true' },
          h('span', null, h('kbd', { class: 'kbd' }, icon('up')), h('kbd', { class: 'kbd' }, icon('down')), 'move'),
          h('span', null, h('kbd', { class: 'kbd' }, 'Enter'), 'open'),
          h('span', null, h('kbd', { class: 'kbd' }, 'Esc'), 'close'))));
    box.hidden = false;
    renderFinderList();
    input.focus();
  }

  function closeFinder() {
    if (!finder.open) return;
    finder.open = false;
    const box = $('#finder');
    box.hidden = true;
    box.replaceChildren();
    const back = finder.returnTo;
    if (back && document.contains(back)) back.focus();
  }

  function renderFinderList() {
    const list = $('#finder-list');
    const input = $('.finder-top input');
    const q = finder.query;
    finder.items = finderItems(q);
    finder.active = Math.min(Math.max(finder.active, 0), finder.items.length - 1);
    const option = (it, i) => {
      const props = {
        id: `fi-${i}`, role: 'option', class: `finder-item ${i === finder.active ? 'is-active' : ''}`, 'aria-selected': String(i === finder.active),
        onmousemove: () => { if (finder.active !== i) { finder.active = i; renderFinderList(); } },
        onclick: () => { finder.active = i; activateFinder(); },
      };
      if (it.kind === 'new') {
        return h('li', props, h('span', { class: 'fi-name' }, it.name ? `New monster called “${it.name}”` : 'New monster'), h('kbd', { class: 'kbd' }, 'Enter'));
      }
      const m = it.monster;
      return h('li', props,
        h('span', { class: 'fi-name' }, L.highlightPieces(m.name || 'Unnamed Monster', it.ranges).map((p) => (p.hit ? h('mark', null, p.text) : p.text))),
        h('span', { class: 'fi-folder' }, m.folder.trim() || L.UNSORTED),
        m.meta.cr.trim() && h('span', { class: `cr ${i === finder.active ? 'is-on' : ''}` }, `CR ${m.meta.cr.trim()}`));
    };
    const monsters = finder.items.filter((it) => it.kind === 'monster');
    list.replaceChildren(...[
      h('li', { class: 'finder-group', role: 'presentation' }, 'Monsters'),
      monsters.length ? monsters.map(option) : h('li', { class: 'finder-none', role: 'presentation' }, `No monsters match “${q.trim()}”.`),
      h('li', { class: 'finder-group', role: 'presentation' }, 'Actions'),
      option(finder.items[finder.items.length - 1], finder.items.length - 1),
    ].flat());
    input.setAttribute('aria-activedescendant', `fi-${finder.active}`);
    $(`#fi-${finder.active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function finderKeys(e) {
    const n = finder.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); finder.active = (finder.active + 1) % n; renderFinderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); finder.active = (finder.active - 1 + n) % n; renderFinderList(); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); finder.active = 0; renderFinderList(); }
    else if (e.key === 'Enter') { e.preventDefault(); activateFinder(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFinder(); }
    else if (e.key === 'Tab') e.preventDefault(); // focus stays in the finder
  }

  function activateFinder() {
    const it = finder.items[finder.active];
    if (!it) return;
    finder.returnTo = null;
    closeFinder();
    if (it.kind === 'monster') {
      selectMonster(it.monster.id);
      $('#monster-title')?.focus({ preventScroll: true });
    } else newMonster(it.name);
  }

  // ---------- drawer (small screens) ----------

  function setDrawer(open) {
    const app = $('#app');
    if (app.classList.contains('drawer-open') === open) return;
    app.classList.toggle('drawer-open', open);
    $('#menu-btn').setAttribute('aria-expanded', String(open));
    $('#scrim').hidden = !open;
    if (open) $('#new-monster').focus();
    else if (document.activeElement && $('#library').contains(document.activeElement)) $('#menu-btn').focus();
  }

  // ---------- wiring ----------

  async function init() {
    const saved = await storage.load().catch(() => null);
    if (saved && Array.isArray(saved.monsters)) {
      lib = {
        version: 1,
        settings: { markdownBold: false, ...(saved.settings || {}) },
        currentId: saved.currentId,
        folders: Array.isArray(saved.folders) ? saved.folders.filter((f) => typeof f === 'string' && f.trim()) : [],
        monsters: saved.monsters.filter(isObj).map(normalizeMonster),
        snippets: Array.isArray(saved.snippets) ? saved.snippets.map(normalizeSnippet).filter(Boolean) : [],
      };
      for (const m of lib.monsters) sessionOriginals.set(m.id, clone(m));
    } else {
      const example = normalizeMonster(wyvernRider());
      lib.monsters = [example];
      lib.currentId = example.id;
      sessionOriginals.set(example.id, clone(example));
    }
    if (!current() && lib.monsters.length) lib.currentId = lib.monsters[0].id;

    if (window.api) $('#library-note').textContent = 'Every change saves to your library file as you type. Export a file to back up or share.';
    $('#menu-btn').append(icon('menu'));
    $('#find-icon').append(icon('search'));
    $('#undo-btn').append(icon('undo'));
    $('#redo-btn').append(icon('redo'));
    $('#undo-btn').addEventListener('click', undo);
    $('#redo-btn').addEventListener('click', redo);
    $('#check-ddb').addEventListener('click', openDdbCheckerModal);
    $('#check-ddb-2').addEventListener('click', openDdbCheckerModal);
    $('#new-monster').addEventListener('click', () => newMonster());
    $('#import').addEventListener('click', importMonsters);
    $('#import-2').addEventListener('click', importMonsters);
    $('#export-all').addEventListener('click', exportAll);
    $('#export-all-2').addEventListener('click', exportAll);
    $('#search').addEventListener('input', (e) => { query = e.target.value; renderLibrary(); });
    $('#menu-btn').addEventListener('click', () => setDrawer(!$('#app').classList.contains('drawer-open')));
    $('#scrim').addEventListener('click', () => setDrawer(false));
    // A focused value keeps its readout and follows it; a hover readout just goes away.
    $('#main').addEventListener('scroll', () => {
      if (tipFor && document.activeElement === tipFor) showRollTip(tipFor); else hideRollTip();
    }, { passive: true });
    window.addEventListener('resize', hideRollTip);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (modal.open) { e.preventDefault(); closeModal(); return; }
        if ($('#app').classList.contains('drawer-open')) { setDrawer(false); return; }
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); if (modal.open) closeModal(); if (finder.open) closeFinder(); else openFinder(); return; }
      if (finder.open || modal.open) return;
      const inEditable = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (key === 'z' && !e.altKey && !inEditable) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (key === 'y' && !e.shiftKey && !e.altKey && !inEditable) {
        e.preventDefault();
        redo();
      } else if (key === 'n' && !e.shiftKey) { e.preventDefault(); newMonster(); }
      else if (key === 'c' && e.shiftKey) { e.preventDefault(); copyAll(); }
    });
    // Flush a pending save if the tab closes inside the debounce window.
    window.addEventListener('beforeunload', () => { if (saveTimer) { try { storage.save(lib); } catch { /* reported already */ } } });
    setInterval(renderStatus, 20000);

    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) document.querySelector('.find .kbd').textContent = 'Cmd K';
    resetBaseline();
    renderUndoButtons();
    renderNewFolder();
    renderAll();
    renderStatus();
  }

  init();
})();
