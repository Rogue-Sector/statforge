const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/format.js');
const D = require('../src/ddb.js');

// ---- DDB markup checker & repairer ----

test('analyzeDdbMarkup passes clean Stat Forge output with zero issues', () => {
  const clean = 'Claw. Melee Attack Roll: [rollable]+6;{"diceNotation":"1d20+6", "rollType":"to hit", "rollAction":"Claw"}[/rollable], reach 5 ft. Hit: 11 [rollable](2d6 + 4);{"diceNotation":"2d6+4", "rollType":"damage", "rollAction":"Claw", "rollDamageType":"Slashing"}[/rollable] Slashing damage.';
  const res = D.analyzeDdbMarkup(clean);
  assert.equal(res.rollCount, 2);
  assert.equal(res.issues.length, 0);
  assert.equal(res.repaired, clean);
});

test('analyzeDdbMarkup fixes curly quotes, missing closing quote, and misspelled diceNotaion', () => {
  const broken = 'Claw. Melee Weapon Attack: [rollable]+6;{“diceNotaion”:“1d20+6, “rollType”:“to hit”, “rollAction”:“Claw”}[/rollable] to hit.';
  const res = D.analyzeDdbMarkup(broken);
  assert.ok(res.issues.some((i) => i.kind === 'curly-quotes' && i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'missing-quote' && i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'misspelled-key' && i.fixed));
  assert.equal(res.remainingCount, 0);
  assert.equal(
    res.repaired,
    'Claw. Melee Weapon Attack: [rollable]+6;{"diceNotation":"1d20+6", "rollType":"to hit", "rollAction":"Claw"}[/rollable] to hit.',
  );
  // Re-running on the repaired output produces zero issues.
  assert.equal(D.analyzeDdbMarkup(res.repaired).issues.length, 0);
});

test('analyzeDdbMarkup closes unclosed [rollable] and fixes missing semicolon and rollable tag typos', () => {
  const broken = 'Hit: 11 [rolable](2d6 + 4){"diceNotation":"2d6 + 4", "rollType":"dmg", "rollAction":"Claw"} slashing damage.';
  const res = D.analyzeDdbMarkup(broken);
  assert.ok(res.issues.some((i) => i.kind === 'tag-typo' && i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'unclosed-rollable' && i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'missing-semicolon' && i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'roll-type-alias' && i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'missing-damage-type' && i.fixed));
  assert.equal(
    res.repaired,
    'Hit: 11 [rollable](2d6 + 4);{"diceNotation":"2d6+4", "rollType":"damage", "rollAction":"Claw", "rollDamageType":"Slashing"}[/rollable] slashing damage.',
  );
});

test('analyzeDdbMarkup detects display-vs-dice mismatch and aligns or flags it', () => {
  const mismatch = 'Hit: 11 [rollable](2d6 + 4);{"diceNotation":"2d6+3", "rollType":"damage", "rollAction":"Claw", "rollDamageType":"Slashing"}[/rollable] slashing damage.';
  const aligned = D.analyzeDdbMarkup(mismatch, { alignDice: true });
  assert.ok(aligned.issues.some((i) => i.kind === 'display-mismatch' && i.fixed));
  assert.ok(aligned.repaired.includes('"diceNotation":"2d6+4"'));

  const flagged = D.analyzeDdbMarkup(mismatch, { alignDice: false });
  assert.ok(flagged.issues.some((i) => i.kind === 'display-mismatch' && !i.fixed));
  assert.ok(flagged.repaired.includes('"diceNotation":"2d6+3"'));
});

test('analyzeDdbMarkup flags missing damage type when it cannot be inferred, and warns on wrong average', () => {
  const input = 'Deals 20 [rollable](2d6 + 4);{"diceNotation":"2d6+4", "rollType":"damage", "rollAction":"Hit"}[/rollable] damage.';
  const res = D.analyzeDdbMarkup(input);
  assert.ok(res.issues.some((i) => i.kind === 'missing-damage-type' && !i.fixed));
  assert.ok(res.issues.some((i) => i.kind === 'average-mismatch'));
});

test('analyzeDdbMarkup repairs tooltip closing mismatches and upgrades spell edition tags', () => {
  const input = 'Target is [condition]Prone[/conditon] and casts [spell]Fireball[/spell].';
  const res24 = D.analyzeDdbMarkup(input, { spellEdition: '2024' });
  assert.equal(res24.repaired, 'Target is [condition]Prone[/condition] and casts [spells]Fireball[/spells].');
  assert.equal(res24.remainingCount, 0);

  const res14 = D.analyzeDdbMarkup('Casts [spells]Cure Wounds[/spells].', { spellEdition: '2014' });
  assert.equal(res14.repaired, 'Casts [spell]Cure Wounds[/spell].');
});

// ---- pasted action parser ----

test('parseActionText extracts a 2014 melee attack with Markdown formatting', () => {
  const raw = '**Claw.** *Melee Weapon Attack:* +6 to hit, reach 5 ft., one target. *Hit:* 11 (2d6 + 4) slashing damage.';
  const res = D.parseActionText(raw);
  assert.equal(res.structured.recognized, 'Attack');
  const a = res.structured.action;
  assert.equal(a.name, 'Claw');
  assert.equal(a.kind, 'melee');
  assert.equal(a.attackSource, 'weapon');
  assert.equal(a.toHit, 6);
  assert.equal(a.reach, 5);
  assert.deepEqual(a.damage, { count: 2, die: 6, mod: 4, type: 'Slashing' });
  assert.deepEqual(F.actionWarnings(a), []);
});

test('parseActionText extracts 2014 spell attack, versatile, extra damage, on-hit save, condition and miss', () => {
  const raw = 'Fire Bolt. Ranged Spell Attack: +7 to hit, range 120 ft., one target. Hit: 11 (2d10) fire damage. Miss: Half damage.';
  const bolt = D.parseActionText(raw).structured.action;
  assert.equal(bolt.kind, 'ranged');
  assert.equal(bolt.attackSource, 'spell');
  assert.equal(bolt.rangeNormal, 120);
  assert.equal(bolt.rangeLong, 0);
  assert.equal(bolt.miss, 'Half damage');

  const sting = 'Sting. Melee Attack Roll: +8, reach 10 ft. Hit: 11 (2d6 + 4) Piercing damage and the target must make a DC 16 Constitution saving throw or take 24 (7d6) Poison damage, half as much on a success, and the target has the Poisoned condition until the start of its next turn.';
  const st = D.parseActionText(sting).structured.action;
  assert.equal(st.toHit, 8);
  assert.equal(st.reach, 10);
  assert.equal(st.save.enabled, true);
  assert.equal(st.save.dc, 16);
  assert.equal(st.save.ability, 'Constitution');
  assert.deepEqual(st.save.damage, { count: 7, die: 6, mod: 0, type: 'Poison' });
  assert.equal(st.save.half, true);
  assert.equal(st.condition.enabled, true);
  assert.equal(st.condition.name, 'Poisoned');
  assert.equal(st.condition.duration, 'until the start of its next turn');

  const sword = 'Longsword. Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8 + 3) Slashing damage, or 8 (1d10 + 3) Slashing damage if used with two hands, plus 3 (1d6) Fire damage.';
  const sw = D.parseActionText(sword).structured.action;
  assert.equal(sw.versatile.enabled, true);
  assert.equal(sw.versatile.die, 10);
  assert.equal(sw.versatile.text, 'if used with two hands');
  assert.deepEqual(sw.extraDamage, [{ count: 1, die: 6, mod: 0, type: 'Fire' }]);
});

test('parseActionText extracts 2024 and 2014 saving throw actions with recharge', () => {
  const breath24 = 'Fire Breath (Recharge 5–6). Dexterity Saving Throw: DC 17, each creature in a 60-foot Cone. Failure: 52 (15d6) Fire damage. Success: Half damage.';
  const r24 = D.parseActionText(breath24).structured;
  assert.equal(r24.recognized, 'Saving Throw');
  assert.equal(r24.action.usage.type, 'recharge');
  assert.equal(r24.action.usage.recharge, 5);
  assert.equal(r24.action.save.dc, 17);
  assert.equal(r24.action.save.ability, 'Dexterity');
  assert.equal(r24.action.success, 'half');
  assert.deepEqual(r24.action.damage, { count: 15, die: 6, mod: 0, type: 'Fire' });

  const breath14 = 'Cold Breath (Recharge 6). Each creature in a 30-foot cone must make a DC 15 Constitution saving throw, taking 22 (5d8) cold damage on a failed save, or half as much damage on a successful one.';
  const r14 = D.parseActionText(breath14).structured;
  assert.equal(r14.recognized, 'Saving Throw');
  assert.equal(r14.action.usage.recharge, 6);
  assert.equal(r14.action.save.ability, 'Constitution');
  assert.equal(r14.action.success, 'half');
  assert.equal(r14.action.area, 'each creature in a 30-foot cone');
});

test('parseActionText extracts Spellcasting and always provides an exact-wording inline Text option', () => {
  const sp = `Spellcasting. The archmage casts one of the following spells, requiring no Material components and using Intelligence as the spellcasting ability (spell save DC 17, +9 to hit with spell attacks):
At Will: Detect Magic, Mage Hand
1/Day Each: Fireball (level 5 version), Teleport`;
  const res = D.parseActionText(sp);
  assert.equal(res.structured.recognized, 'Spellcasting');
  assert.equal(res.structured.action.spells.ability, 'Intelligence');
  assert.equal(res.structured.action.spells.dc, 17);
  assert.equal(res.structured.action.spells.attack, 9);
  assert.equal(res.structured.action.spells.groups.length, 2);

  const custom = 'Regeneration. The troll regains 10 (2d6 + 3) hit points at the start of its turn. If it takes acid or fire damage, this trait fails for 1d4 rounds and it is Poisoned.';
  const rCustom = D.parseActionText(custom, { section: 'traits' });
  assert.equal(rCustom.structured, null);
  assert.equal(rCustom.exactText.action.name, 'Regeneration');
  assert.ok(rCustom.exactText.action.description.includes('{heal 2d6+3}'));
  assert.ok(rCustom.exactText.action.description.includes('{1d4}'));
  assert.ok(rCustom.exactText.action.description.includes('{condition Poisoned}'));
  assert.deepEqual(F.actionWarnings(rCustom.exactText.action), []);
});

test('parseActionText detects Reaction Trigger/Response in exact-wording mode', () => {
  const react = 'Parry. Trigger: The knight is hit by a melee attack roll. Response: The knight adds 3 to its AC against that attack.';
  const res = D.parseActionText(react, { section: 'reactions' });
  assert.equal(res.exactText.action.section, 'reactions');
  assert.equal(res.exactText.action.trigger, 'The knight is hit by a melee attack roll');
  assert.equal(res.exactText.action.description, 'The knight adds 3 to its AC against that attack.');
});
