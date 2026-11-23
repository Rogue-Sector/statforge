const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/format.js');
const { wyvernRider } = require('../src/example.js');

const plain = (tokens, opts) => F.toPlain(tokens, opts);
const action = (overrides) => ({
  ...wyvernRider().actions[0],
  extraDamage: [],
  ...overrides,
});

// Expected text is the DM's pasted Wyvern Rider, with two typos fixed:
// "take 24  [rollable]" (double space) and "Halberd Attack" (capital A).
const BITE = 'Bite. Melee Attack Roll: [rollable]+10;{"diceNotation":"1d20+10", "rollType":"to hit", "rollAction":"Bite"}[/rollable], reach 5 ft. Hit: 13 [rollable](2d8 + 4);{"diceNotation":"2d8+4", "rollType":"damage", "rollAction":"Bite", "rollDamageType":"Piercing"}[/rollable] Piercing damage.';
const STING = 'Sting. Melee Attack Roll: [rollable]+8;{"diceNotation":"1d20+8", "rollType":"to hit", "rollAction":"Sting"}[/rollable], reach 10 ft. Hit: 11 [rollable](2d6 + 4);{"diceNotation":"2d6+4", "rollType":"damage", "rollAction":"Sting", "rollDamageType":"Piercing"}[/rollable] Piercing damage and the target must make a DC 16 Constitution saving throw or take 24 [rollable](7d6);{"diceNotation":"7d6", "rollType":"damage", "rollAction":"Sting", "rollDamageType":"Poison"}[/rollable] Poison damage, half as much on a success, and the target has the [condition]Poisoned[/condition] condition until the start of the wyvern’s next turn if they failed by 5 or more.';
const HALBERD = 'Halberd. Melee Attack Roll: [rollable]+9;{"diceNotation":"1d20+9", "rollType":"to hit", "rollAction":"Halberd"}[/rollable], reach 10 ft. Hit: 19 [rollable](2d10 + 8);{"diceNotation":"2d10+8", "rollType":"damage", "rollAction":"Halberd", "rollDamageType":"Slashing"}[/rollable] Slashing damage.';
const MULTI = 'Multiattack. The Wyvern Rider makes one Bite attack, one Sting attack, and one Halberd attack.';

test('Wyvern Rider matches the pasted statblock exactly', () => {
  const blocks = F.formatMonster(wyvernRider()).map((b) => plain(b.tokens));
  assert.deepEqual(blocks, [MULTI, BITE, STING, HALBERD]);
});

test('markdown bold wraps only the action name', () => {
  const sting = wyvernRider().actions[1];
  assert.equal(plain(F.formatAction(sting), { markdownBold: true }), `**Sting.**${STING.slice('Sting.'.length)}`);
});

test('the friend\'s simple Sting example (no condition) matches', () => {
  const sting = { ...wyvernRider().actions[1], condition: { enabled: false }, rider: '' };
  assert.equal(
    plain(F.formatAction(sting), { markdownBold: true }),
    '**Sting.** Melee Attack Roll: [rollable]+8;{"diceNotation":"1d20+8", "rollType":"to hit", "rollAction":"Sting"}[/rollable], reach 10 ft. Hit: 11 [rollable](2d6 + 4);{"diceNotation":"2d6+4", "rollType":"damage", "rollAction":"Sting", "rollDamageType":"Piercing"}[/rollable] Piercing damage and the target must make a DC 16 Constitution saving throw or take 24 [rollable](7d6);{"diceNotation":"7d6", "rollType":"damage", "rollAction":"Sting", "rollDamageType":"Poison"}[/rollable] Poison damage, half as much on a success.',
  );
});

test('averages, dice text and notation', () => {
  assert.equal(F.avgDamage({ count: 2, die: 6, mod: 4 }), 11);
  assert.equal(F.avgDamage({ count: 7, die: 6, mod: 0 }), 24);
  assert.equal(F.avgDamage({ count: 1, die: 4, mod: -3 }), 1);
  assert.equal(F.diceText({ count: 1, die: 4, mod: -1 }), '(1d4 - 1)');
  assert.equal(F.diceNotation({ count: 1, die: 4, mod: -1 }), '1d4-1');
  assert.equal(F.diceText({ count: 7, die: 6, mod: 0 }), '(7d6)');
});

test('negative to-hit, ranged and extra damage', () => {
  const a = action({
    name: 'Longbow', kind: 'ranged', toHit: -1, rangeNormal: 150, rangeLong: 600,
    damage: { count: 1, die: 8, mod: -1, type: 'Piercing' },
    extraDamage: [{ count: 2, die: 6, mod: 0, type: 'Fire' }],
  });
  assert.equal(
    plain(F.formatAction(a)),
    'Longbow. Ranged Attack Roll: [rollable]-1;{"diceNotation":"1d20-1", "rollType":"to hit", "rollAction":"Longbow"}[/rollable], range 150/600 ft. Hit: 3 [rollable](1d8 - 1);{"diceNotation":"1d8-1", "rollType":"damage", "rollAction":"Longbow", "rollDamageType":"Piercing"}[/rollable] Piercing damage plus 7 [rollable](2d6);{"diceNotation":"2d6", "rollType":"damage", "rollAction":"Longbow", "rollDamageType":"Fire"}[/rollable] Fire damage.',
  );
});

test('melee or ranged with a grapple condition', () => {
  const a = action({
    name: 'Javelin', kind: 'both', toHit: 5, reach: 5, rangeNormal: 30, rangeLong: 120,
    damage: { count: 1, die: 6, mod: 3, type: 'Piercing' },
    condition: { enabled: true, name: 'Grappled', duration: '(escape DC 13)' },
  });
  assert.match(plain(F.formatAction(a)), /, reach 5 ft\. or range 30\/120 ft\. Hit: 6 .* Piercing damage, and the target has the \[condition\]Grappled\[\/condition\] condition \(escape DC 13\)\.$/);
});

test('save-only action with recharge', () => {
  const a = action({
    name: 'Fire Breath', kind: 'save', usage: { type: 'recharge', recharge: 5 },
    save: { enabled: true, ability: 'Dexterity', dc: 17 }, area: 'each creature in a 60-foot Cone',
    damage: { count: 15, die: 6, mod: 0, type: 'Fire' },
  });
  assert.equal(
    plain(F.formatAction(a)),
    'Fire Breath [rollable](Recharge 5-6);{"diceNotation":"1d6", "rollType":"recharge", "rollAction":"Fire Breath"}[/rollable]. Dexterity Saving Throw: DC 17, each creature in a 60-foot Cone. Failure: 52 [rollable](15d6);{"diceNotation":"15d6", "rollType":"damage", "rollAction":"Fire Breath", "rollDamageType":"Fire"}[/rollable] Fire damage. Success: Half damage.',
  );
});

test('save-only condition with no damage and a per-day limit', () => {
  const a = action({
    name: 'Frightful Presence', kind: 'save', usage: { type: 'perDay', perDay: 3 },
    save: { ability: 'Wisdom', dc: 15 }, area: 'each creature in a 30-foot Emanation',
    damage: { count: 0, die: 6, mod: 0, type: 'Psychic' },
    condition: { enabled: true, name: 'Frightened', duration: 'until the end of its next turn' },
    success: 'none',
  });
  assert.equal(
    plain(F.formatAction(a)),
    'Frightful Presence (3/Day). Wisdom Saving Throw: DC 15, each creature in a 30-foot Emanation. Failure: The target has the [condition]Frightened[/condition] condition until the end of its next turn.',
  );
});

test('on-hit save with only a condition, and a new-sentence rider', () => {
  const a = action({
    name: 'Slam', damage: { count: 1, die: 10, mod: 3, type: 'Bludgeoning' }, toHit: 5,
    save: { enabled: true, ability: 'Strength', dc: 13, damage: null },
    condition: { enabled: true, name: 'Prone', duration: '' },
    rider: 'The slime then moves 5 feet',
  });
  assert.match(plain(F.formatAction(a)), /Bludgeoning damage and the target must make a DC 13 Strength saving throw or have the \[condition\]Prone\[\/condition\] condition\. The slime then moves 5 feet\.$/);
});

test('multiattack counts, plurals and list joining', () => {
  const m = wyvernRider();
  m.multiattack.counts = { 'a-bite': 2, 'a-sting': 0, 'a-halberd': 1 };
  m.multiattack.subject = 'The wyvern';
  m.multiattack.tail = 'It can replace one Bite with a Sting';
  assert.equal(
    plain(F.formatMultiattack(m)),
    'Multiattack. The wyvern makes two Bite attacks and one Halberd attack. It can replace one Bite with a Sting.',
  );
  m.multiattack.enabled = false;
  assert.equal(F.formatMultiattack(m), null);
});

test('clipboard HTML bolds the name and escapes markup', () => {
  const html = F.toHtml(F.formatAction(wyvernRider().actions[0]));
  assert.ok(html.startsWith('<p><strong><em>Bite.</em></strong> <em>Melee Attack Roll:</em> [rollable]+10;{&quot;diceNotation&quot;'));
});

// ---- sections ----

function dragon() {
  const m = wyvernRider();
  m.name = 'Red Dragon';
  m.subject = 'The dragon';
  m.legendary = { uses: 3, lairUses: 4, style: '2024' };
  m.actions.push(
    action({ id: 'b-1', name: 'Tail Swipe', section: 'bonus', toHit: 7, damage: { count: 1, die: 8, mod: 4, type: 'Bludgeoning' } }),
    action({ id: 'r-1', name: 'Parry', kind: 'text', section: 'reactions', trigger: 'The dragon is hit by a melee attack roll', description: 'The dragon adds 3 to its AC against that attack, possibly causing it to miss' }),
    action({ id: 'l-1', name: 'Wing Attack', kind: 'text', section: 'legendary', usage: { type: 'cost', cost: 2 }, description: 'The dragon beats its wings.' }),
  );
  m.multiattack.counts['b-1'] = 2; // bonus attacks never join the multiattack
  return m;
}

test('sections come out in statblock order with the right blocks', () => {
  const sections = F.formatSections(dragon());
  assert.deepEqual(sections.map((s) => s.title), ['Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions']);
  assert.deepEqual(sections[3].blocks.map((b) => b.id), ['legendary-intro', 'l-1']);
  assert.equal(plain(sections[0].blocks[0].tokens), 'Multiattack. The dragon makes one Bite attack, one Sting attack, and one Halberd attack.');
});

test('legendary intro, 2024 and 2014 wording', () => {
  const m = dragon();
  assert.equal(
    plain(F.formatLegendaryIntro(m)),
    'Legendary Action Uses: 3 (4 in Lair). Immediately after another creature\u2019s turn, the dragon can expend a use to take one of the following actions. The dragon regains all expended uses at the start of each of its turns.',
  );
  m.legendary.style = '2014';
  assert.equal(
    plain(F.formatLegendaryIntro(m)),
    'The dragon can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature\u2019s turn. The dragon regains spent legendary actions at the start of its turn.',
  );
});

test('reaction trigger/response and legendary cost', () => {
  const blocks = F.formatMonster(dragon());
  const byId = (id) => plain(blocks.find((b) => b.id === id).tokens);
  assert.equal(byId('r-1'), 'Parry. Trigger: The dragon is hit by a melee attack roll. Response: The dragon adds 3 to its AC against that attack, possibly causing it to miss.');
  assert.equal(byId('l-1'), 'Wing Attack (Costs 2 Actions). The dragon beats its wings.');
});

test('copying several sections adds headings, one section does not', () => {
  const sections = F.formatSections(dragon());
  const all = F.sectionsToClipboard(sections);
  assert.ok(all.text.startsWith('Actions\n\nMultiattack.'));
  assert.ok(all.text.includes('\n\nBonus Actions\n\nTail Swipe.'));
  assert.ok(all.html.includes('<h3>Reactions</h3>'));
  const one = F.sectionsToClipboard([sections[1]]);
  assert.ok(one.text.startsWith('Tail Swipe.'));
});

// ---- recharge & spellcasting ----

test('recharge is a rollable, matching the DM\'s format', () => {
  const a = action({ name: 'Plague of Sand', kind: 'text', usage: { type: 'recharge', recharge: 5 }, description: 'Sand swirls.' });
  assert.equal(
    plain(F.formatAction(a)),
    'Plague of Sand [rollable](Recharge 5-6);{"diceNotation":"1d6", "rollType":"recharge", "rollAction":"Plague of Sand"}[/rollable]. Sand swirls.',
  );
  a.usage.recharge = 6;
  assert.ok(plain(F.formatAction(a)).startsWith('Plague of Sand [rollable](Recharge 6);'));
  assert.ok(plain(F.formatAction(a), { markdownBold: true }).startsWith('**Plague of Sand** [rollable]'));
});

test('spellcasting wraps each spell in [spell] tags', () => {
  const a = action({
    name: 'Spellcasting', kind: 'spells',
    spells: {
      ability: 'Charisma', dc: 15, attack: 7, hasAttack: true, components: 'requiring no Material components',
      groups: [
        { label: 'At Will', spells: 'Detect Magic, Mage Hand' },
        { label: '1/Day Each', spells: 'Fireball (level 4 version), Fly' },
        { label: '2/Day Each', spells: '  ' },
      ],
    },
  });
  assert.equal(
    plain(F.formatAction(a, { subject: 'The wyvern rider' })),
    'Spellcasting. The wyvern rider casts one of the following spells, requiring no Material components and using Charisma as the spellcasting ability (spell save DC 15, +7 to hit with spell attacks):\n'
    + 'At Will: [spell]Detect Magic[/spell], [spell]Mage Hand[/spell]\n'
    + '1/Day Each: [spell]Fireball[/spell] (level 4 version), [spell]Fly[/spell]',
  );
  a.spells.hasAttack = false;
  a.spells.components = '';
  assert.match(plain(F.formatAction(a)), /^Spellcasting\. The creature casts one of the following spells, using Charisma as the spellcasting ability \(spell save DC 15\):\n/);
  assert.ok(F.toHtml(F.formatAction(a)).includes('<br><em>At Will:</em> [spell]Detect Magic[/spell]'));
});

// ---- traits ----

test('traits come first, use a custom usage tag, and never join the multiattack', () => {
  const m = dragon();
  m.actions.unshift(
    action({ id: 't-1', name: 'Legendary Resistance', kind: 'text', section: 'traits', usage: { type: 'custom', text: '3/Day, or 4/Day in Lair' }, description: 'If the dragon fails a saving throw, it can choose to succeed instead.' }),
    action({ id: 't-2', name: 'Stray Claw', section: 'traits', toHit: 5 }),
  );
  m.multiattack.counts['t-2'] = 1;
  const sections = F.formatSections(m);
  assert.deepEqual(sections.map((s) => s.key), ['traits', 'actions', 'bonus', 'reactions', 'legendary']);
  assert.equal(sections[0].title, 'Traits');
  assert.equal(sections[0].box, 'Special Traits');
  assert.equal(plain(sections[0].blocks[0].tokens), 'Legendary Resistance (3/Day, or 4/Day in Lair). If the dragon fails a saving throw, it can choose to succeed instead.');
  assert.equal(plain(sections[1].blocks[0].tokens), 'Multiattack. The dragon makes one Bite attack, one Sting attack, and one Halberd attack.');
  assert.ok(F.sectionsToClipboard(sections).text.startsWith('Traits\n\nLegendary Resistance'));
});

test('attacks in Traits get a warning, other kinds do not', () => {
  assert.equal(F.kindAllowed('melee', 'traits'), false);
  assert.equal(F.kindAllowed('save', 'traits'), true);
  assert.equal(F.kindAllowed('melee', 'actions'), true);
  assert.equal(F.actionWarnings(action({ section: 'traits' })).length, 1);
  assert.deepEqual(F.actionWarnings(action({ section: 'traits', kind: 'text' })), []);
  assert.deepEqual(F.actionWarnings(action({})), []);
});

// ---- dice inside free text ----

const inlinePlain = (s, name = 'Web') => plain(F.parseInline(s, name).tokens);

test('inline dice: bare roll, damage, heal and to-hit', () => {
  assert.equal(inlinePlain('for {1d4} rounds'), 'for [rollable]1d4;{"diceNotation":"1d4", "rollType":"roll", "rollAction":"Web"}[/rollable] rounds');
  assert.equal(inlinePlain('takes {dmg 3d6 Fire} Fire damage'), 'takes 10 [rollable](3d6);{"diceNotation":"3d6", "rollType":"damage", "rollAction":"Web", "rollDamageType":"Fire"}[/rollable] Fire damage');
  assert.equal(inlinePlain('{heal 2d8+4}'), '13 [rollable](2d8 + 4);{"diceNotation":"2d8+4", "rollType":"heal", "rollAction":"Web"}[/rollable]');
  assert.equal(inlinePlain('{+5} to hit'), '[rollable]+5;{"diceNotation":"1d20+5", "rollType":"to hit", "rollAction":"Web"}[/rollable] to hit');
  assert.equal(inlinePlain('{-1}'), '[rollable]-1;{"diceNotation":"1d20-1", "rollType":"to hit", "rollAction":"Web"}[/rollable]');
});

test('inline dice: spacing is always normalized', () => {
  assert.equal(inlinePlain('{ 1d6 -1 }'), '[rollable]1d6 - 1;{"diceNotation":"1d6-1", "rollType":"roll", "rollAction":"Web"}[/rollable]');
  assert.equal(inlinePlain('{DMG 2 d 6 + 3 cold}'), '10 [rollable](2d6 + 3);{"diceNotation":"2d6+3", "rollType":"damage", "rollAction":"Web", "rollDamageType":"Cold"}[/rollable]');
  assert.equal(inlinePlain('{dmg 3d6}'), '10 [rollable](3d6);{"diceNotation":"3d6", "rollType":"damage", "rollAction":"Web"}[/rollable]');
});

test('inline dice: escapes, bad braces and plain text never throw', () => {
  assert.equal(inlinePlain('a \\{literal} brace'), 'a {literal} brace');
  assert.deepEqual(F.parseInline('no dice here', 'X').errors, []);
  const bad = F.parseInline('roll {dmg 3d6 Banana} and {lots} and {0d6} and {open', 'X');
  assert.equal(plain(bad.tokens), 'roll {dmg 3d6 Banana} and {lots} and {0d6} and {open');
  assert.equal(bad.errors.length, 4);
  assert.match(bad.errors[0], /Banana/);
  assert.match(bad.errors[3], /no closing/);
  assert.equal(inlinePlain(''), '');
});

test('inline dice in text, trigger/response, rider, success and multiattack tail', () => {
  const t = action({ name: 'Web', kind: 'text', description: 'The target is stuck for {1d4} rounds' });
  assert.equal(plain(F.formatAction(t)), 'Web. The target is stuck for [rollable]1d4;{"diceNotation":"1d4", "rollType":"roll", "rollAction":"Web"}[/rollable] rounds');

  const r = action({ name: 'Spite', kind: 'text', section: 'reactions', trigger: 'A creature deals {dmg 1d6} damage to it', description: 'It deals {dmg 2d6 Necrotic} Necrotic damage back' });
  assert.equal(plain(F.formatAction(r)), 'Spite. Trigger: A creature deals 3 [rollable](1d6);{"diceNotation":"1d6", "rollType":"damage", "rollAction":"Spite"}[/rollable] damage to it. Response: It deals 7 [rollable](2d6);{"diceNotation":"2d6", "rollType":"damage", "rollAction":"Spite", "rollDamageType":"Necrotic"}[/rollable] Necrotic damage back.');

  const a = action({ name: 'Claw', toHit: 5, damage: { count: 1, die: 6, mod: 3, type: 'Slashing' }, rider: 'and the target bleeds for {dmg 1d4 Slashing} Slashing damage' });
  assert.match(plain(F.formatAction(a)), / Slashing damage and the target bleeds for 2 \[rollable\]\(1d4\);\{"diceNotation":"1d4", "rollType":"damage", "rollAction":"Claw", "rollDamageType":"Slashing"\}\[\/rollable\] Slashing damage\.$/);

  const sv = action({ name: 'Gas', kind: 'save', save: { ability: 'Constitution', dc: 12 }, area: 'each creature in a 10-foot Emanation', damage: null, condition: { enabled: true, name: 'Poisoned', duration: '' }, success: 'custom', successText: 'The target is Poisoned for {1d4} rounds instead' });
  assert.match(plain(F.formatAction(sv)), /Success: The target is Poisoned for \[rollable\]1d4;\{"diceNotation":"1d4", "rollType":"roll", "rollAction":"Gas"\}\[\/rollable\] rounds instead\.$/);

  const m = wyvernRider();
  m.multiattack.tail = 'It then heals {heal 1d8}';
  assert.equal(plain(F.formatMultiattack(m)), 'Multiattack. The Wyvern Rider makes one Bite attack, one Sting attack, and one Halberd attack. It then heals 4 [rollable](1d8);{"diceNotation":"1d8", "rollType":"heal", "rollAction":"Multiattack"}[/rollable].');
});

test('inline dice problems show up as card warnings', () => {
  assert.deepEqual(F.actionWarnings(action({ kind: 'text', description: 'Fine {1d4}' })), []);
  const w = F.actionWarnings(action({ kind: 'text', description: 'Oops {1x4}' }));
  assert.equal(w.length, 1);
  assert.match(w[0], /^Description: Can’t read \{1x4\}/);
  assert.match(F.actionWarnings(action({ rider: '{dmg 1d4 Wet}' }))[0], /^Rider: .*Wet/);
  const m = wyvernRider();
  m.multiattack.tail = '{nope}';
  assert.equal(F.multiattackWarnings(m).length, 1);
});

// ---- healing ----

const heal = (over) => ({ enabled: true, count: 2, die: 8, mod: 4, who: 'self', text: '', ...over });
const HEAL_ROLL = (name) => `13 [rollable](2d8 + 4);{"diceNotation":"2d8+4", "rollType":"heal", "rollAction":"${name}"}[/rollable] Hit Points`;

test('healing: self uses the mid-sentence subject, target says "the target"', () => {
  const a = action({ name: 'Drain', toHit: 7, damage: { count: 1, die: 8, mod: 3, type: 'Necrotic' }, healing: heal() });
  assert.equal(
    plain(F.formatAction(a, { subject: 'The dragon' })),
    `Drain. Melee Attack Roll: [rollable]+7;{"diceNotation":"1d20+7", "rollType":"to hit", "rollAction":"Drain"}[/rollable], reach 5 ft. Hit: 7 [rollable](1d8 + 3);{"diceNotation":"1d8+3", "rollType":"damage", "rollAction":"Drain", "rollDamageType":"Necrotic"}[/rollable] Necrotic damage and the dragon regains ${HEAL_ROLL('Drain')}.`,
  );
  a.healing.who = 'target';
  assert.match(plain(F.formatAction(a, { subject: 'The dragon' })), / Necrotic damage and the target regains 13 \[rollable\]/);
  assert.match(plain(F.formatAction(a)), / and the target regains /);
  a.healing.who = 'self';
  assert.match(plain(F.formatAction(a)), / and the creature regains /);
});

test('healing after a save or condition starts a new sentence; alone it leads', () => {
  const a = action({
    name: 'Leech', toHit: 5, damage: { count: 1, die: 6, mod: 2, type: 'Piercing' },
    condition: { enabled: true, name: 'Grappled', duration: '(escape DC 13)' }, healing: heal({ who: 'self' }),
  });
  assert.match(plain(F.formatAction(a, { subject: 'The leech' })), /condition \(escape DC 13\)\. The leech regains 13 \[rollable\]\(2d8 \+ 4\);.*Hit Points\.$/);
  const s = action({ name: 'Mend', kind: 'save', save: { ability: 'Wisdom', dc: 12 }, area: 'one creature it can see', damage: null, success: 'none', healing: heal({ who: 'target' }) });
  assert.equal(plain(F.formatAction(s)), `Mend. Wisdom Saving Throw: DC 12, one creature it can see. Failure: The target regains ${HEAL_ROLL('Mend')}.`);
});

test('healing: custom wording replaces the amount and still takes inline dice', () => {
  const a = action({ name: 'Life Drain', toHit: 6, damage: { count: 2, die: 6, mod: 0, type: 'Necrotic' }, healing: heal({ text: 'regains Hit Points equal to the Necrotic damage dealt' }) });
  assert.match(plain(F.formatAction(a, { subject: 'The vampire' })), / Necrotic damage and the vampire regains Hit Points equal to the Necrotic damage dealt\.$/);
  a.healing.text = 'regains {heal 1d6} Hit Points';
  assert.match(plain(F.formatAction(a, { subject: 'The vampire' })), /and the vampire regains 3 \[rollable\]\(1d6\);\{"diceNotation":"1d6", "rollType":"heal", "rollAction":"Life Drain"\}\[\/rollable\] Hit Points\.$/);
  a.healing.enabled = false;
  assert.doesNotMatch(plain(F.formatAction(a)), /regains/);
});

// ---- versatile ----

test('versatile: second damage is its own rollable with the default wording', () => {
  const a = action({
    name: 'Longsword', toHit: 5, damage: { count: 1, die: 8, mod: 3, type: 'Slashing' },
    versatile: { enabled: true, count: 1, die: 10, mod: 3, type: 'Slashing' },
  });
  assert.equal(
    plain(F.formatAction(a)),
    'Longsword. Melee Attack Roll: [rollable]+5;{"diceNotation":"1d20+5", "rollType":"to hit", "rollAction":"Longsword"}[/rollable], reach 5 ft. Hit: 7 [rollable](1d8 + 3);{"diceNotation":"1d8+3", "rollType":"damage", "rollAction":"Longsword", "rollDamageType":"Slashing"}[/rollable] Slashing damage, or 8 [rollable](1d10 + 3);{"diceNotation":"1d10+3", "rollType":"damage", "rollAction":"Longsword", "rollDamageType":"Slashing"}[/rollable] Slashing damage if used with two hands.',
  );
});

test('versatile: extra damage, saves, conditions and riders follow; ranged ignores it', () => {
  const a = action({
    name: 'Flame Spear', kind: 'both', toHit: 5, damage: { count: 1, die: 6, mod: 3, type: 'Piercing' },
    versatile: { enabled: true, count: 1, die: 8, mod: 3, type: 'Piercing', text: 'when held in two hands' },
    extraDamage: [{ count: 1, die: 6, mod: 0, type: 'Fire' }],
    condition: { enabled: true, name: 'Prone', duration: '' }, rider: 'if it is Large or smaller',
  });
  assert.match(plain(F.formatAction(a)), /Piercing damage, or 7 \[rollable\]\(1d8 \+ 3\);.*Piercing damage when held in two hands, plus 3 \[rollable\]\(1d6\);.*Fire damage, and the target has the \[condition\]Prone\[\/condition\] condition if it is Large or smaller\.$/);
  a.versatile.text = '';
  assert.match(plain(F.formatAction(a)), /Piercing"\}\[\/rollable\] Piercing damage, plus 3/);
  a.kind = 'ranged';
  assert.doesNotMatch(plain(F.formatAction(a)), /, or /);
  a.kind = 'melee';
  a.versatile.enabled = false;
  assert.doesNotMatch(plain(F.formatAction(a)), /, or /);
});

test('versatile followed by healing uses a comma before "and"', () => {
  const a = action({
    name: 'Blood Axe', toHit: 5, damage: { count: 1, die: 8, mod: 3, type: 'Slashing' },
    versatile: { enabled: true, count: 1, die: 10, mod: 3, type: 'Slashing' }, healing: heal({ count: 1, die: 4, mod: 0 }),
  });
  assert.match(plain(F.formatAction(a, { subject: 'The orc' })), / Slashing damage if used with two hands, and the orc regains 2 \[rollable\]\(1d4\);/);
});

// ---- 2014 wording ----

const W14 = { wording: '2014', subject: 'The dragon' };
// The prose with each rollable shown as «display»; its JSON is checked separately where it matters.
const readable = (tokens) => plain(tokens).replace(/\[rollable\]([^;]*);\{[^}]*\}\[\/rollable\]/g, '«$1»');
const text14 = (over) => readable(F.formatAction(action(over), W14));

test('2014 melee attack, exact markup, with the damage type lowercase only in the prose', () => {
  const a = action({ name: 'Claw', toHit: 5, reach: 5, damage: { count: 1, die: 8, mod: 3, type: 'Slashing' } });
  assert.equal(
    plain(F.formatAction(a, W14)),
    'Claw. Melee Weapon Attack: [rollable]+5;{"diceNotation":"1d20+5", "rollType":"to hit", "rollAction":"Claw"}[/rollable] to hit, reach 5 ft., one target. Hit: 7 [rollable](1d8 + 3);{"diceNotation":"1d8+3", "rollType":"damage", "rollAction":"Claw", "rollDamageType":"Slashing"}[/rollable] slashing damage.',
  );
  assert.ok(F.toHtml(F.formatAction(a, W14)).includes('<em>Melee Weapon Attack:</em> [rollable]+5;'));
});

test('2014 ranged and melee-or-ranged attacks, with extra damage', () => {
  assert.equal(
    text14({ name: 'Longbow', kind: 'ranged', toHit: 4, rangeNormal: 80, rangeLong: 320, damage: { count: 1, die: 8, mod: 2, type: 'Piercing' }, extraDamage: [{ count: 2, die: 6, mod: 0, type: 'Fire' }] }),
    'Longbow. Ranged Weapon Attack: «+4» to hit, range 80/320 ft., one target. Hit: 6 «(1d8 + 2)» piercing damage plus 7 «(2d6)» fire damage.',
  );
  assert.equal(
    text14({ name: 'Javelin', kind: 'both', toHit: 4, reach: 5, rangeNormal: 20, rangeLong: 60, damage: { count: 1, die: 6, mod: 2, type: 'Piercing' } }),
    'Javelin. Melee or Ranged Weapon Attack: «+4» to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 5 «(1d6 + 2)» piercing damage.',
  );
  assert.equal(
    text14({ name: 'Dart', kind: 'ranged', toHit: 4, rangeNormal: 20, rangeLong: 0, damage: { count: 1, die: 4, mod: 2, type: 'Piercing' } }),
    'Dart. Ranged Weapon Attack: «+4» to hit, range 20 ft., one target. Hit: 4 «(1d4 + 2)» piercing damage.',
  );
});

test('2014 versatile damage', () => {
  const a = action({
    name: 'Longsword', toHit: 5, damage: { count: 1, die: 8, mod: 3, type: 'Slashing' },
    versatile: { enabled: true, count: 1, die: 10, mod: 3, type: 'Slashing' },
    extraDamage: [{ count: 1, die: 6, mod: 0, type: 'Radiant' }],
  });
  assert.equal(
    readable(F.formatAction(a, W14)),
    'Longsword. Melee Weapon Attack: «+5» to hit, reach 5 ft., one target. Hit: 7 «(1d8 + 3)» slashing damage, or 8 «(1d10 + 3)» slashing damage if used with two hands, plus 3 «(1d6)» radiant damage.',
  );
});

test('2014 keeps rollDamageType capitalized and the [condition] tag on the proper name', () => {
  const out = plain(F.formatMonster({ ...wyvernRider(), wording: '2014' }).find((b) => b.id === 'a-sting').tokens);
  assert.ok(out.includes('"rollDamageType":"Piercing"}[/rollable] piercing damage.'));
  assert.ok(out.includes('"rollDamageType":"Poison"}[/rollable] poison damage on a failed save'));
  assert.ok(out.includes('[condition]Poisoned[/condition]'));
});

test('2014 rider save: the Wyvern Rider Sting reads like the 2014 Monster Manual', () => {
  const sting = F.formatMonster({ ...wyvernRider(), wording: '2014' }).find((b) => b.id === 'a-sting');
  assert.equal(
    readable(sting.tokens),
    'Sting. Melee Weapon Attack: «+8» to hit, reach 10 ft., one target. Hit: 11 «(2d6 + 4)» piercing damage. The target must make a DC 16 Constitution saving throw, taking 24 «(7d6)» poison damage on a failed save, or half as much damage on a successful one. On a failed save, the target is also [condition]Poisoned[/condition] until the start of the wyvern’s next turn if they failed by 5 or more.',
  );
  const noHalf = text14({ name: 'Venom', save: { enabled: true, ability: 'Constitution', dc: 12, damage: { count: 3, die: 6, mod: 0, type: 'Poison' }, half: false } });
  assert.match(noHalf, /piercing damage\. The target must succeed on a DC 12 Constitution saving throw or take 10 «\(3d6\)» poison damage\.$/);
});

test('2014 conditions: on a hit, after a save with no damage, and Exhaustion', () => {
  assert.match(
    text14({ name: 'Grab', condition: { enabled: true, name: 'Grappled', duration: '(escape DC 13)' } }),
    /piercing damage, and the target is \[condition\]Grappled\[\/condition\] \(escape DC 13\)\.$/,
  );
  assert.match(
    text14({ name: 'Slam', save: { enabled: true, ability: 'Strength', dc: 13, damage: null }, condition: { enabled: true, name: 'Prone', duration: '' }, rider: 'The slime then moves 5 feet' }),
    /piercing damage\. The target must succeed on a DC 13 Strength saving throw or be \[condition\]Prone\[\/condition\]\. The slime then moves 5 feet\.$/,
  );
  assert.match(
    text14({ name: 'Drain', save: { enabled: true, ability: 'Constitution', dc: 12, damage: { count: 3, die: 6, mod: 0, type: 'Necrotic' }, half: false }, condition: { enabled: true, name: 'Exhaustion', duration: '' } }),
    /or take 10 «\(3d6\)» necrotic damage and suffer one level of \[condition\]Exhaustion\[\/condition\]\.$/,
  );
  assert.match(text14({ name: 'Tire', condition: { enabled: true, name: 'Exhaustion', duration: '' } }), /, and the target suffers one level of \[condition\]Exhaustion\[\/condition\]\.$/);
});

test('2014 healing uses lowercase "hit points" and the same sentence rules', () => {
  const healing = heal();
  assert.match(text14({ name: 'Drain', healing }), /piercing damage and the dragon regains 13 «\(2d8 \+ 4\)» hit points\.$/);
  assert.match(text14({ name: 'Leech', condition: { enabled: true, name: 'Grappled', duration: '' }, healing }), /\[condition\]Grappled\[\/condition\]\. The dragon regains 13 «\(2d8 \+ 4\)» hit points\.$/);
  assert.match(text14({ name: 'Mend', healing: heal({ who: 'target', text: 'regains {heal 1d6} Hit Points' }) }), /and the target regains 3 «\(1d6\)» Hit Points\.$/);
});

const breath = (over) => action({
  name: 'Fire Breath', kind: 'save', usage: { type: 'recharge', recharge: 5 }, save: { ability: 'Dexterity', dc: 15 },
  area: 'each creature in a 30-foot Cone', damage: { count: 5, die: 8, mod: 0, type: 'Fire' }, ...over,
});
const save14 = (over) => readable(F.formatAction(breath(over), W14));

test('2014 save action, half damage on a success, exact markup', () => {
  assert.equal(
    plain(F.formatAction(breath({ success: 'half' }), W14)),
    'Fire Breath [rollable](Recharge 5-6);{"diceNotation":"1d6", "rollType":"recharge", "rollAction":"Fire Breath"}[/rollable]. Each creature in a 30-foot Cone must make a DC 15 Dexterity saving throw, taking 22 [rollable](5d8);{"diceNotation":"5d8", "rollType":"damage", "rollAction":"Fire Breath", "rollDamageType":"Fire"}[/rollable] fire damage on a failed save, or half as much damage on a successful one.',
  );
  assert.equal(
    save14({ success: 'half', extraDamage: [{ count: 2, die: 6, mod: 0, type: 'Cold' }], condition: { enabled: true, name: 'Blinded', duration: 'until the end of its next turn' } }),
    'Fire Breath «(Recharge 5-6)». Each creature in a 30-foot Cone must make a DC 15 Dexterity saving throw, taking 22 «(5d8)» fire damage plus 7 «(2d6)» cold damage on a failed save, or half as much damage on a successful one. On a failed save, the target is also [condition]Blinded[/condition] until the end of its next turn.',
  );
});

test('2014 save action, nothing on a success', () => {
  assert.equal(save14({ success: 'none' }), 'Fire Breath «(Recharge 5-6)». Each creature in a 30-foot Cone must succeed on a DC 15 Dexterity saving throw or take 22 «(5d8)» fire damage.');
  assert.equal(
    save14({ name: 'Frightful Presence', usage: { type: 'none' }, damage: null, success: 'none', save: { ability: 'Wisdom', dc: 16 }, area: 'each creature of its choice within 120 feet', condition: { enabled: true, name: 'Frightened', duration: 'for 1 minute' } }),
    'Frightful Presence. Each creature of its choice within 120 feet must succeed on a DC 16 Wisdom saving throw or be [condition]Frightened[/condition] for 1 minute.',
  );
  // "Half damage" with no damage has nothing to halve.
  assert.equal(save14({ name: 'Glare', usage: { type: 'none' }, damage: null, success: 'half', area: '' }), 'Glare. The target must make a DC 15 Dexterity saving throw.');
});

test('2014 save action, custom success text', () => {
  assert.equal(
    save14({ success: 'custom', successText: 'The target takes half damage and is pushed {1d4} feet' }),
    'Fire Breath «(Recharge 5-6)». Each creature in a 30-foot Cone must make a DC 15 Dexterity saving throw. On a failed save, the target takes 22 «(5d8)» fire damage. On a successful save, the target takes half damage and is pushed «1d4» feet.',
  );
  assert.equal(
    save14({ success: 'custom', successText: 'it takes half damage', condition: { enabled: true, name: 'Blinded', duration: '' } }),
    'Fire Breath «(Recharge 5-6)». Each creature in a 30-foot Cone must make a DC 15 Dexterity saving throw. On a failed save, the target takes 22 «(5d8)» fire damage and is [condition]Blinded[/condition]. On a successful save, it takes half damage.',
  );
  assert.equal(
    save14({ name: 'Gas', usage: { type: 'none' }, damage: null, success: 'custom', successText: 'Grog is Poisoned for {1d4} rounds instead', condition: { enabled: true, name: 'Poisoned', duration: '' } }),
    'Gas. Each creature in a 30-foot Cone must succeed on a DC 15 Dexterity saving throw or be [condition]Poisoned[/condition]. On a successful save, Grog is Poisoned for «1d4» rounds instead.',
  );
  // An empty custom text means nothing happens on a success, as in 2024 wording.
  assert.equal(save14({ success: 'custom', successText: '  ' }), save14({ success: 'none' }));
});

test('2014 save action with healing', () => {
  assert.equal(
    save14({ name: 'Mend', usage: { type: 'none' }, damage: null, success: 'none', area: '', healing: heal({ who: 'target' }) }),
    'Mend. The target must make a DC 15 Dexterity saving throw. On a failed save, the target regains 13 «(2d8 + 4)» hit points.',
  );
  assert.equal(
    save14({ name: 'Siphon', usage: { type: 'none' }, healing: heal() }),
    'Siphon. Each creature in a 30-foot Cone must make a DC 15 Dexterity saving throw, taking 22 «(5d8)» fire damage on a failed save, or half as much damage on a successful one. The dragon regains 13 «(2d8 + 4)» hit points.',
  );
});

test('monster wording: the setting drives every section, and old legendary.style still counts', () => {
  const m = dragon();
  assert.equal(F.wordingOf(m), '2024');
  m.wording = '2014';
  const blocks = F.formatMonster(m);
  assert.match(plain(blocks.find((b) => b.id === 'a-bite').tokens), /^Bite\. Melee Weapon Attack: /);
  assert.match(plain(blocks.find((b) => b.id === 'legendary-intro').tokens), /^The dragon can take 3 legendary actions/);
  // A monster saved before the setting existed: its legendary style becomes the wording.
  assert.equal(F.wordingOf({ legendary: { style: '2014' } }), '2014');
  assert.equal(F.wordingOf({ legendary: { style: '2024' } }), '2024');
  assert.equal(F.wordingOf({}), '2024');
  // The setting wins over a leftover style.
  assert.equal(F.wordingOf({ wording: '2024', legendary: { style: '2014' } }), '2024');
  assert.equal(F.wordingOf({ wording: 'nonsense', legendary: { style: '2014' } }), '2014');
});

// ---- lair actions ----

function lairDragon() {
  const m = dragon();
  m.lair = { initiative: 20, noRepeat: true, text: '' };
  m.actions.push(
    action({ id: 'lr-1', name: '', kind: 'text', section: 'lair', description: 'Magma erupts from a point on the ground, dealing {dmg 6d6 Fire} fire damage to anything there' }),
    action({ id: 'lr-2', name: '', kind: 'save', section: 'lair', usage: { type: 'none' }, save: { ability: 'Constitution', dc: 15 }, area: 'each creature within 20 feet of a point the dragon can see', damage: { count: 3, die: 6, mod: 0, type: 'Fire' }, success: 'half' }),
  );
  return m;
}

const LAIR_INTRO = 'When fighting inside its lair, the dragon can take lair actions. On initiative count 20 (losing initiative ties), the dragon takes a lair action to cause one of the following effects; the dragon can’t use the same effect two rounds in a row:';

test('lair actions: a sixth section after Legendary, with the intro first', () => {
  const sections = F.formatSections(lairDragon());
  const lair = sections[sections.length - 1];
  assert.deepEqual([lair.key, lair.title, lair.box], ['lair', 'Lair Actions', 'Lair and Lair Actions']);
  assert.deepEqual(lair.blocks.map((b) => b.id), ['lair-intro', 'lr-1', 'lr-2']);
  assert.equal(plain(lair.blocks[0].tokens), LAIR_INTRO);
  // No lair actions, no section and no intro.
  assert.ok(!F.formatSections(dragon()).some((s) => s.key === 'lair'));
});

test('lair intro: subject, initiative count, repeat rule and custom text', () => {
  const m = lairDragon();
  m.subject = '';
  m.name = 'Tiamat';
  m.lair = { initiative: 15, noRepeat: false };
  assert.equal(plain(F.formatLairIntro(m)), 'When fighting inside its lair, the Tiamat can take lair actions. On initiative count 15 (losing initiative ties), the Tiamat takes a lair action to cause one of the following effects:');
  m.subject = 'Tiamat';
  assert.match(plain(F.formatLairIntro(m)), /^When fighting inside its lair, Tiamat can take lair actions\./);
  assert.match(plain(F.formatLairIntro({ ...m, lair: {} })), /initiative count 20 .* Tiamat can’t use the same effect two rounds in a row:$/);
  m.lair.text = 'On initiative count 20, the lair shakes for {1d4} rounds.';
  assert.equal(plain(F.formatLairIntro(m)), 'On initiative count 20, the lair shakes for [rollable]1d4;{"diceNotation":"1d4", "rollType":"roll", "rollAction":"Lair Actions"}[/rollable] rounds.');
  m.lair.text = 'Bad {lots}';
  assert.equal(F.lairWarnings(m).length, 1);
  assert.match(F.lairWarnings(m)[0], /^Custom intro: Can’t read \{lots\}/);
});

test('lair entries: unnamed text and saves are bare paragraphs with inline dice', () => {
  const blocks = F.formatMonster(lairDragon());
  const byId = (id) => plain(blocks.find((b) => b.id === id).tokens);
  assert.equal(byId('lr-1'), 'Magma erupts from a point on the ground, dealing 21 [rollable](6d6);{"diceNotation":"6d6", "rollType":"damage", "rollAction":"Lair Action", "rollDamageType":"Fire"}[/rollable] fire damage to anything there');
  assert.equal(
    readable(blocks.find((b) => b.id === 'lr-2').tokens),
    'Constitution Saving Throw: DC 15, each creature within 20 feet of a point the dragon can see. Failure: 10 «(3d6)» Fire damage. Success: Half damage.',
  );
  const m = lairDragon();
  m.wording = '2014';
  assert.equal(
    readable(F.formatMonster(m).find((b) => b.id === 'lr-2').tokens),
    'Each creature within 20 feet of a point the dragon can see must make a DC 15 Constitution saving throw, taking 10 «(3d6)» fire damage on a failed save, or half as much damage on a successful one.',
  );
  // A named lair action keeps its name, and unnamed ones elsewhere are still "Unnamed Action".
  assert.match(plain(F.formatAction(action({ name: 'Tremor', kind: 'text', section: 'lair', description: 'The ground shakes.' }))), /^Tremor\. The ground shakes\.$/);
  assert.match(plain(F.formatAction(action({ name: '', kind: 'text', section: 'actions', description: 'x' }))), /^Unnamed Action\. x$/);
});

test('lair actions only take Text and Saving Throw kinds', () => {
  assert.equal(F.kindAllowed('text', 'lair'), true);
  assert.equal(F.kindAllowed('save', 'lair'), true);
  assert.equal(F.kindAllowed('melee', 'lair'), false);
  assert.equal(F.kindAllowed('spells', 'lair'), false);
  assert.match(F.actionWarnings(action({ section: 'lair' }))[0], /^Lair actions are Text or Saving Throw entries/);
  assert.deepEqual(F.actionWarnings(action({ section: 'lair', kind: 'text', description: '{1d4}' })), []);
});

test('copy all includes Lair Actions with its heading, and HTML renders unnamed entries', () => {
  const all = F.sectionsToClipboard(F.formatSections(lairDragon()));
  assert.ok(all.text.includes(`\n\nLair Actions\n\n${LAIR_INTRO}\n\nMagma erupts`));
  assert.ok(all.html.includes('<h3>Lair Actions</h3><p>When fighting inside its lair'));
  assert.ok(all.html.includes('<p>Magma erupts from a point'));
});
