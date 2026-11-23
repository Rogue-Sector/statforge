const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/format.js');
const L = require('../src/library.js');
const { wyvernRider } = require('../src/example.js');

const actionsSection = (m) => F.formatSections(m).find((s) => s.key === 'actions');

// ---- hashing & copied tracker ----

test('hashString is stable, 8 hex digits, and sensitive to every character', () => {
  assert.equal(L.hashString(''), '811c9dc5');
  assert.equal(L.hashString('Bite.'), L.hashString('Bite.'));
  assert.match(L.hashString('Bite.'), /^[0-9a-f]{8}$/);
  assert.notEqual(L.hashString('Bite.'), L.hashString('Bite '));
  assert.notEqual(L.hashString('a’'), L.hashString("a'"));
});

test('snapshot hashes the exact toPlain text of the section and of each block', () => {
  const s = actionsSection(wyvernRider());
  const snap = L.snapshotSection(s, F.toPlain, {}, 123);
  assert.equal(snap.at, 123);
  assert.equal(snap.hash, L.hashString(F.sectionsToClipboard([s]).text));
  assert.deepEqual(Object.keys(snap.actions), ['multiattack', 'a-bite', 'a-sting', 'a-halberd']);
  assert.equal(snap.actions['a-bite'], L.hashString(F.toPlain(s.blocks[1].tokens)));
});

test('copy status: never, copied, then changed with the action named', () => {
  const m = wyvernRider();
  assert.equal(L.copyStatus(undefined, actionsSection(m), F.toPlain).state, 'never');
  const rec = L.snapshotSection(actionsSection(m), F.toPlain);
  assert.equal(L.copyStatus(rec, actionsSection(m), F.toPlain).state, 'copied');

  // Editor-only state never counts.
  m.actions[0].collapsed = true;
  m.actions[0].showRider = true;
  assert.equal(L.copyStatus(rec, actionsSection(m), F.toPlain).state, 'copied');

  m.actions[0].toHit = 11;
  const st = L.copyStatus(rec, actionsSection(m), F.toPlain);
  assert.equal(st.state, 'changed');
  assert.deepEqual(st.changed, ['Bite']);
  assert.equal(st.removed, 0);
  assert.deepEqual(L.changeMessage(st), [
    { text: 'You changed ' }, { text: 'Bite', strong: true },
    { text: ' after copying. Copy again before pasting into D&D Beyond.' },
  ]);
});

test('copy status: removed and added actions, and several changes', () => {
  const m = wyvernRider();
  const rec = L.snapshotSection(actionsSection(m), F.toPlain);
  m.actions.splice(2, 1); // Halberd gone; the multiattack text changes too
  let st = L.copyStatus(rec, actionsSection(m), F.toPlain);
  assert.deepEqual(st.changed, ['Multiattack']);
  assert.equal(st.removed, 1);
  assert.equal(L.changeMessage(st).map((p) => p.text).join(''), 'You changed Multiattack, and an action was removed after copying. Copy again before pasting into D&D Beyond.');

  const m2 = wyvernRider();
  const rec2 = L.snapshotSection(actionsSection(m2), F.toPlain);
  m2.multiattack.enabled = false;
  st = L.copyStatus(rec2, actionsSection(m2), F.toPlain);
  assert.equal(L.changeMessage(st).map((p) => p.text).join(''), 'An action was removed after copying. Copy again before pasting into D&D Beyond.');

  m2.actions.forEach((a) => { a.toHit += 1; });
  m2.actions.push({ ...m2.actions[0], id: 'a-claw', name: 'Claw' });
  st = L.copyStatus(rec2, actionsSection(m2), F.toPlain);
  assert.deepEqual(st.added, ['Claw']);
  assert.equal(L.changeMessage(st).map((p) => p.text).join(''), 'You changed 3 actions, added Claw, and an action was removed after copying. Copy again before pasting into D&D Beyond.');
});

test('copy status follows the output options (Markdown bold changes the pasted text)', () => {
  const m = wyvernRider();
  const rec = L.snapshotSection(actionsSection(m), F.toPlain, { markdownBold: false });
  assert.equal(L.copyStatus(rec, actionsSection(m), F.toPlain, { markdownBold: true }).state, 'changed');
});

test('a section emptied after copying counts as changed', () => {
  const m = wyvernRider();
  const rec = L.snapshotSection(actionsSection(m), F.toPlain);
  const st = L.copyStatus(rec, { blocks: [] }, F.toPlain);
  assert.equal(st.state, 'changed');
  assert.equal(st.removed, 4);
});

// ---- roll readout ----

test('roll readout reads the token JSON: damage, to hit, heal, roll, recharge', () => {
  const bite = F.formatAction(wyvernRider().actions[0]);
  const rolls = bite.filter((t) => t.t === 'roll').map(F.rollReadout);
  assert.deepEqual(rolls[0], { notation: '1d20+10', rollType: 'to hit', label: 'to hit', damageType: null, missingDamageType: false, average: 20.5, min: 11, max: 30, action: 'Bite' });
  assert.deepEqual(rolls[1], { notation: '2d8+4', rollType: 'damage', label: 'Piercing damage', damageType: 'Piercing', missingDamageType: false, average: 13, min: 6, max: 20, action: 'Bite' });

  const inline = (s) => F.parseInline(s, 'Web').tokens.filter((t) => t.t === 'roll').map(F.rollReadout)[0];
  assert.equal(inline('{heal 2d8+4}').label, 'healing');
  assert.equal(inline('{heal 2d8+4}').average, 13);
  assert.equal(inline('{1d4}').label, 'roll');
  assert.equal(inline('{1d4}').average, 2.5);
  assert.equal(inline('{dmg 3d6}').missingDamageType, true);
  assert.equal(inline('{dmg 3d6}').label, 'damage');
  assert.equal(inline('{dmg 1d4-1 Cold}').min, 0);

  const recharge = F.formatAction({ name: 'Breath', kind: 'text', usage: { type: 'recharge', recharge: 5 } }).find((t) => t.t === 'roll');
  assert.deepEqual(F.rollReadout(recharge), { notation: '1d6', rollType: 'recharge', label: 'recharge', damageType: null, missingDamageType: false, average: 3.5, min: 1, max: 6, action: 'Breath' });
});

test('roll readout ignores non-rolls and bad JSON without throwing', () => {
  assert.equal(F.rollReadout({ t: 'text', v: 'x' }), null);
  assert.equal(F.rollReadout({ t: 'roll', display: 'x', json: '{nope' }), null);
  assert.equal(F.rollReadout(null), null);
});

// ---- folders ----

test('groupByFolder sorts A–Z, keeps order inside, and puts Unsorted last', () => {
  const ms = [
    { id: 1, name: 'Hydra', folder: 'Sewer one-shot' },
    { id: 2, name: 'Dragon Turtle', folder: '' },
    { id: 3, name: 'Wyvern Rider', folder: 'desert campaign' },
    { id: 4, name: 'Dune Revenant', folder: 'Desert Campaign ' },
    { id: 5, name: 'Owlbear' },
  ];
  const g = L.groupByFolder(ms, ['Arena', 'sewer one-shot']);
  assert.deepEqual(g.map((x) => x.name), ['Arena', 'Desert campaign'.replace('Desert c', 'desert c'), 'sewer one-shot', 'Unsorted']);
  assert.deepEqual(g[1].monsters.map((m) => m.id), [3, 4]);
  assert.deepEqual(g[3].monsters.map((m) => m.id), [2, 5]);
  assert.equal(g[3].key, '');
  assert.deepEqual(L.groupByFolder([], []).map((x) => x.name), ['Unsorted']);
  assert.deepEqual(L.groupByFolder([{ name: 'A', folder: 'X' }]).map((x) => x.name), ['X']);
});

// ---- search ----

const MONSTERS = [
  { name: 'Wyvern Rider', folder: 'Desert campaign', meta: { type: 'Monstrosity' } },
  { name: 'Hydra', folder: 'Sewer one-shot', meta: { type: 'Monstrosity' } },
  { name: 'Dragon Turtle', folder: '', meta: { type: 'Dragon' } },
  { name: 'Young Green Dragon', folder: 'Desert campaign', meta: { type: 'Dragon' } },
  { name: 'Dune Revenant', folder: 'Drafts', meta: { type: 'Undead' } },
];

test('search ranks name prefix, then word start, then inside, then folder/type', () => {
  const r = L.searchMonsters(MONSTERS, 'dra');
  assert.deepEqual(r.map((x) => x.monster.name), ['Dragon Turtle', 'Young Green Dragon', 'Hydra', 'Dune Revenant']);
  assert.deepEqual(r[0].ranges, [[0, 3]]);
  assert.deepEqual(r[1].ranges, [[12, 15]]);
  assert.deepEqual(r[2].ranges, [[2, 5]]);
  assert.deepEqual(r[3].ranges, []); // matched on its folder "Drafts"
});

test('search: subsequence, type match, empty query and no match', () => {
  assert.deepEqual(L.searchMonsters(MONSTERS, 'ygd')[0].ranges, [[0, 1], [6, 7], [12, 13]]);
  assert.deepEqual(L.searchMonsters(MONSTERS, 'undead').map((x) => x.monster.name), ['Dune Revenant']);
  assert.equal(L.searchMonsters(MONSTERS, '  ').length, 5);
  assert.deepEqual(L.searchMonsters(MONSTERS, 'zzz'), []);
  assert.deepEqual(L.searchMonsters(MONSTERS, 'rider (').length, 0);
});

test('highlight pieces and subtitles', () => {
  assert.deepEqual(L.highlightPieces('Hydra', [[2, 5]]), [{ text: 'Hy', hit: false }, { text: 'dra', hit: true }]);
  assert.deepEqual(L.highlightPieces('Hydra', []), [{ text: 'Hydra', hit: false }]);
  assert.equal(L.subtitleOf({ folder: 'Desert campaign', meta: { size: 'Large', type: 'Monstrosity', cr: '7' } }), 'Large Monstrosity · CR 7 · Desert campaign');
  assert.equal(L.subtitleOf({ meta: { cr: '1/2' } }), 'CR 1/2');
  assert.equal(L.subtitleOf({}), '');
});

test('relative time', () => {
  assert.equal(L.relativeTime(0, 10_000), 'just now');
  assert.equal(L.relativeTime(0, 3 * 60_000), '3 min ago');
  assert.equal(L.relativeTime(0, 2 * 3600_000), '2 hr ago');
  assert.equal(L.relativeTime(0, 26 * 3600_000), '1 day ago');
});

// ---- signed modifier fields ----

test('parseSigned reads "+10", "10", "-1" and friends as numbers', () => {
  assert.equal(L.parseSigned('+10'), 10);
  assert.equal(L.parseSigned('10'), 10);
  assert.equal(L.parseSigned('-1'), -1);
  assert.equal(L.parseSigned('−3'), -3); // true minus sign, as pasted from a statblock
  assert.equal(L.parseSigned(' + 4 '), 4);
  assert.equal(L.parseSigned('+0'), 0);
  assert.ok(Object.is(L.parseSigned('-0'), 0));
  assert.equal(typeof L.parseSigned('+7'), 'number');
});

test('parseSigned returns null for text that is not a whole number yet', () => {
  for (const t of ['', ' ', '+', '-', '1.5', 'abc', '+-1', '--1', '1+', '12345', null, undefined]) {
    assert.equal(L.parseSigned(t), null, JSON.stringify(t));
  }
});

test('formatSigned always shows the sign, and round-trips through parseSigned', () => {
  assert.equal(L.formatSigned(10), '+10');
  assert.equal(L.formatSigned(0), '+0');
  assert.equal(L.formatSigned(-1), '-1');
  for (const n of [-20, -1, 0, 1, 10, 99]) assert.equal(L.parseSigned(L.formatSigned(n)), n);
});

test('signedInputState flags text that is not a number, but not a half-typed sign', () => {
  for (const t of ['+10', '10', '-1', '−2', '+0', ' 7 ']) assert.equal(L.signedInputState(t), 'ok', t);
  for (const t of ['', ' ', '+', '-', '−']) assert.equal(L.signedInputState(t), 'typing', JSON.stringify(t));
  for (const t of ['abc', '1.5', '+-1', '1+', '12345', 'NaN', '+x']) assert.equal(L.signedInputState(t), 'invalid', t);
});

test('a signed field never stores NaN: unreadable text parses to null', () => {
  for (const t of ['NaN', 'Infinity', '1e3', '0x10', '']) assert.equal(L.parseSigned(t), null, t);
});

// ---- lair actions in the copied tracker ----

test('copy status tracks the Lair Actions section, and names unnamed entries by their first words', () => {
  const m = wyvernRider();
  m.subject = 'The wyvern';
  m.actions.push({ ...m.actions[0], id: 'lr-1', name: '', kind: 'text', section: 'lair', description: 'Sand swirls around the wyvern in a 20-foot radius.' });
  const lair = () => F.formatSections(m).find((s) => s.key === 'lair');
  const rec = L.snapshotSection(lair(), F.toPlain);
  assert.deepEqual(Object.keys(rec.actions), ['lair-intro', 'lr-1']);
  assert.equal(L.copyStatus(rec, lair(), F.toPlain).state, 'copied');

  m.actions[3].description = 'Sand swirls around the wyvern in a 30-foot radius.';
  let st = L.copyStatus(rec, lair(), F.toPlain);
  assert.equal(st.state, 'changed');
  assert.deepEqual(st.changed, ['Sand swirls around the…']);

  m.actions[3].description = 'Sand swirls around the wyvern in a 20-foot radius.';
  m.lair = { initiative: 10 };
  st = L.copyStatus(rec, lair(), F.toPlain);
  assert.deepEqual(st.changed, ['Lair Actions intro']);
  assert.equal(L.blockName({ id: 'x', tokens: [{ t: 'text', v: 'Quake.' }] }), 'Quake');
  assert.equal(L.blockName({ id: 'x', tokens: [{ t: 'text', v: '' }] }), 'a lair action');
});
