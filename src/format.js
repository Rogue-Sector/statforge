// Turns monster/action data into D&D Beyond / AboveVTT statblock text.
// Pure functions, no DOM: loaded as a classic <script> in the app (window.StatblockFormat)
// and with require() in the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatblockFormat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAMAGE_TYPES = [
    'Acid', 'Bludgeoning', 'Cold', 'Fire', 'Force', 'Lightning', 'Necrotic',
    'Piercing', 'Poison', 'Psychic', 'Radiant', 'Slashing', 'Thunder',
  ];
  const ABILITIES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
  const CONDITIONS = [
    'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated',
    'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious',
  ];
  const KINDS = {
    melee: 'Melee Attack Roll:',
    ranged: 'Ranged Attack Roll:',
    both: 'Melee or Ranged Attack Roll:',
  };
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  const int = (v, fallback = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const signed = (n) => (n < 0 ? `-${Math.abs(n)}` : `+${n}`);
  const clean = (s) => String(s ?? '').trim();

  // ---- dice -------------------------------------------------------------

  function avgDamage(d) {
    const count = int(d.count), die = int(d.die), mod = int(d.mod);
    if (count <= 0 || die <= 0) return Math.max(mod, 1);
    return Math.max(Math.floor((count * (die + 1)) / 2) + mod, 1);
  }

  /** Text shown inside the rollable, e.g. "(2d6 + 4)", "(1d4 - 1)", "(7d6)". */
  function diceText(d) {
    const mod = int(d.mod);
    const base = `${int(d.count)}d${int(d.die)}`;
    if (mod === 0) return `(${base})`;
    return `(${base} ${mod < 0 ? '-' : '+'} ${Math.abs(mod)})`;
  }

  /** Dice notation for the roller, e.g. "2d6+4", "1d4-1", "7d6". */
  function diceNotation(d) {
    const mod = int(d.mod);
    const base = `${int(d.count)}d${int(d.die)}`;
    return mod === 0 ? base : `${base}${signed(mod)}`;
  }

  const hasDice = (d) => !!d && int(d.count) > 0 && int(d.die) > 0;
  const isDamage = (d) => !!d && (hasDice(d) || int(d.mod) > 0);

  // ---- tokens -----------------------------------------------------------
  // An action is built as a list of tokens, then rendered to plain text, HTML or the preview.
  //   { t: 'name' | 'label' | 'text' | 'cond', v }
  //   { t: 'roll', display, json }

  const text = (v) => ({ t: 'text', v });

  function rollJson(fields) {
    return '{' + Object.entries(fields).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(', ') + '}';
  }

  function toHitTokens(bonus, actionName) {
    const b = int(bonus);
    return [{
      t: 'roll',
      display: signed(b),
      json: rollJson({ diceNotation: `1d20${signed(b)}`, rollType: 'to hit', rollAction: actionName }),
    }];
  }

  function damageTokens(d, actionName) {
    const type = clean(d.type) || 'Bludgeoning';
    if (!hasDice(d)) return [text(`${avgDamage(d)} ${type} damage`)];
    return [
      text(`${avgDamage(d)} `),
      {
        t: 'roll',
        display: diceText(d),
        json: rollJson({ diceNotation: diceNotation(d), rollType: 'damage', rollAction: actionName, rollDamageType: type }),
      },
      text(` ${type} damage`),
    ];
  }

  // ---- dice inside free text ---------------------------------------------
  //   {1d4}            -> 1d4                 (rollType "roll")
  //   {dmg 3d6 Fire}   -> 10 (3d6)            (rollType "damage", type optional)
  //   {heal 2d8+4}     -> 13 (2d8 + 4)        (rollType "heal")
  //   {+5}             -> +5                  (1d20+5, rollType "to hit")
  //   \{               -> a literal {
  // Anything else in braces is left as typed and reported, never thrown.

  const DICE_RE = '(\\d+)\\s*d\\s*(\\d+)(?:\\s*([+-])\\s*(\\d+))?';
  const INLINE_FORMS = [
    [new RegExp(`^${DICE_RE}$`, 'i'), 'roll'],
    [new RegExp(`^dmg\\s+${DICE_RE}(?:\\s+([a-z]+))?$`, 'i'), 'damage'],
    [new RegExp(`^heal\\s+${DICE_RE}$`, 'i'), 'heal'],
  ];

  const diceOf = (m) => ({ count: int(m[1]), die: int(m[2]), mod: m[3] ? int(`${m[3]}${m[4]}`) : 0 });

  /** One "{…}" body to tokens, or a reason string when it can't be read. */
  function inlineRoll(body, actionName) {
    const inner = body.trim();
    const hit = /^([+-])\s*(\d+)$/.exec(inner);
    if (hit) return toHitTokens(int(`${hit[1]}${hit[2]}`), actionName);
    for (const [re, kind] of INLINE_FORMS) {
      const m = re.exec(inner);
      if (!m) continue;
      const d = diceOf(m);
      if (!hasDice(d) || d.count > 99) return `“${d.count}d${d.die}” isn’t a dice roll`;
      if (kind === 'roll') {
        return [{ t: 'roll', display: diceText(d).slice(1, -1), json: rollJson({ diceNotation: diceNotation(d), rollType: 'roll', rollAction: actionName }) }];
      }
      const fields = { diceNotation: diceNotation(d), rollType: kind, rollAction: actionName };
      if (kind === 'damage' && m[5]) {
        const type = DAMAGE_TYPES.find((t) => t.toLowerCase() === m[5].toLowerCase());
        if (!type) return `“${m[5]}” isn’t a damage type`;
        fields.rollDamageType = type;
      }
      return [text(`${avgDamage(d)} `), { t: 'roll', display: diceText(d), json: rollJson(fields) }];
    }
    return 'use {1d4}, {dmg 3d6 Fire}, {heal 2d8+4} or {+5}';
  }

  /**
   * Free text with inline dice to tokens. Returns { tokens, errors } where errors are
   * readable strings; text that can't be parsed is kept exactly as typed.
   */
  function parseInline(str, actionName) {
    const src = String(str ?? '');
    const tokens = [], errors = [];
    let buf = '';
    const flush = () => { if (buf) { tokens.push(text(buf)); buf = ''; } };
    const re = /\\\{|\{([^{}]*)\}|\{/g;
    let last = 0, m;
    while ((m = re.exec(src))) {
      buf += src.slice(last, m.index);
      last = re.lastIndex;
      if (m[0] === '\\{') { buf += '{'; continue; }
      if (m[0] === '{') {
        buf += '{';
        errors.push('A “{” has no closing “}”. Type \\{ for a literal brace.');
        continue;
      }
      const result = inlineRoll(m[1], actionName);
      if (typeof result === 'string') {
        buf += m[0];
        errors.push(`Can’t read ${m[0]}: ${result}. It will be pasted as plain text.`);
        continue;
      }
      flush();
      tokens.push(...result);
    }
    buf += src.slice(last);
    flush();
    return { tokens, errors };
  }

  const inline = (str, actionName) => parseInline(str, actionName).tokens;

  function conditionTokens(cond, lead) {
    const out = [text(lead), { t: 'cond', v: cond.name }, text(' condition')];
    const duration = clean(cond.duration);
    if (duration) out.push(text(` ${duration}`));
    return out;
  }

  const plainOf = (tokens) => tokens.map((tk) => (tk.t === 'roll' ? 'x' : tk.v)).join('');

  /** Appends a final period unless the text already ends a sentence. */
  function endSentence(tokens) {
    const s = plainOf(tokens).trimEnd();
    if (s && !/[.!?]$/.test(s)) tokens.push(text('.'));
    return tokens;
  }

  const VERSATILE_WORDING = 'if used with two hands';

  /** The versatile damage when it applies: melee or melee-or-ranged attacks with it switched on. */
  function versatileOf(action) {
    const v = action.versatile;
    if (!v || !v.enabled || !(action.kind === 'melee' || action.kind === 'both')) return null;
    return isDamage(v) && isDamage(action.damage) ? v : null;
  }

  function healingOf(action) {
    const hl = action.healing;
    if (!hl || !hl.enabled) return null;
    return clean(hl.text) || isDamage(hl) ? hl : null;
  }

  /** "regains 13 (2d8 + 4) Hit Points", or the custom wording, without the subject. */
  function healTokens(hl, name) {
    const custom = clean(hl.text);
    if (custom) return inline(custom, name);
    if (!hasDice(hl)) return [text(`regains ${avgDamage(hl)} Hit Points`)];
    return [
      text(`regains ${avgDamage(hl)} `),
      { t: 'roll', display: diceText(hl), json: rollJson({ diceNotation: diceNotation(hl), rollType: 'heal', rollAction: name }) },
      text(' Hit Points'),
    ];
  }

  /**
   * What happens on a hit (attacks) or a failed save (save actions): damage, versatile damage,
   * extra damage, an optional rider save, a condition, healing and a free-text rider.
   */
  function effectTokens(action, name, { allowSave, subject = 'The creature' }) {
    const out = [];
    const versatile = versatileOf(action);
    const damages = [action.damage, ...(action.extraDamage || [])].filter(isDamage);
    damages.forEach((d, i) => {
      if (i > 0) out.push(text(versatile ? ', plus ' : ' plus '));
      out.push(...damageTokens(d, name));
      if (i === 0 && versatile) {
        out.push(text(', or '), ...damageTokens({ ...versatile, type: clean(versatile.type) || clean(d.type) }, name));
        const wording = versatile.text == null ? VERSATILE_WORDING : clean(versatile.text);
        if (wording) out.push(text(` ${wording}`));
      }
    });

    const cond = action.condition && action.condition.enabled && clean(action.condition.name) ? action.condition : null;
    const save = allowSave && action.save && action.save.enabled ? action.save : null;

    if (save) {
      out.push(text(`${out.length ? ' and the target' : 'The target'} must make a DC ${int(save.dc)} ${save.ability} saving throw`));
      if (isDamage(save.damage)) {
        out.push(text(' or take '), ...damageTokens(save.damage, name));
        if (save.half !== false) out.push(text(', half as much on a success'));
        if (cond) out.push(...conditionTokens(cond, ', and the target has the '));
      } else if (cond) {
        out.push(...conditionTokens(cond, ' or have the '));
      }
    } else if (cond) {
      out.push(...conditionTokens(cond, out.length ? ', and the target has the ' : 'The target has the '));
    }

    const heal = healingOf(action);
    if (heal) {
      const self = heal.who !== 'target';
      const clause = healTokens(heal, name);
      if (!out.length) out.push(text(`${self ? subject : 'The target'} `), ...clause);
      else if (save || cond) { endSentence(out); out.push(text(` ${self ? subject : 'The target'} `), ...clause); }
      else out.push(text(`${versatile ? ',' : ''} and ${self ? midSentence(subject) : 'the target'} `), ...clause);
    }

    const rider = clean(action.rider);
    if (rider) {
      const r = inline(rider, name);
      if (!out.length) out.push(...r);
      else if (/^[,;:.]/.test(rider)) out.push(...r);
      else if (/^[A-Z]/.test(rider)) { endSentence(out); out.push(text(' '), ...r); }
      else out.push(text(' '), ...r);
    }
    return out;
  }

  /** Plain-text usage tag after the name. Recharge is a rollable instead; see headerTokens. */
  function usageText(usage) {
    if (!usage || !usage.type || usage.type === 'none') return '';
    if (usage.type === 'perDay') return ` (${Math.max(int(usage.perDay, 1), 1)}/Day)`;
    if (usage.type === 'cost') {
      const n = Math.max(int(usage.cost, 2), 1);
      return n > 1 ? ` (Costs ${n} Actions)` : '';
    }
    if (usage.type === 'custom' && clean(usage.text)) return ` (${clean(usage.text)})`;
    return '';
  }

  function rangeText(a) {
    const reach = `reach ${int(a.reach, 5)} ft.`;
    const normal = int(a.rangeNormal, 30), long = int(a.rangeLong, 0);
    const range = long > normal ? `range ${normal}/${long} ft.` : `range ${normal} ft.`;
    if (a.kind === 'ranged') return range;
    if (a.kind === 'both') return `${reach} or ${range}`;
    return reach;
  }

  /** "Name." or "Name (3/Day).", or for recharge "Name [rollable](Recharge 5-6);…[/rollable]." */
  function headerTokens(a, name) {
    const usage = a.usage || {};
    if (usage.type !== 'recharge') return [{ t: 'name', v: `${name}${usageText(usage)}.` }];
    const n = Math.min(Math.max(int(usage.recharge, 5), 2), 6);
    return [
      { t: 'name', v: name },
      text(' '),
      {
        t: 'roll',
        display: n === 6 ? '(Recharge 6)' : `(Recharge ${n}-6)`,
        json: rollJson({ diceNotation: '1d6', rollType: 'recharge', rollAction: name }),
      },
      text('.'),
    ];
  }

  /** "Fireball (level 4 version)" -> [spell]Fireball[/spell] (level 4 version) */
  function spellTokens(entry) {
    const m = /^(.*?)(\s*\(.*\))$/.exec(entry);
    return m && m[1] ? [{ t: 'spell', v: m[1] }, text(m[2])] : [{ t: 'spell', v: entry }];
  }

  function spellcastingTokens(a, ctx) {
    const s = a.spells || {};
    const components = clean(s.components);
    const attack = s.hasAttack !== false ? `, ${signed(int(s.attack))} to hit with spell attacks` : '';
    const out = [text(` ${ctx.subject} casts one of the following spells, ${components ? `${components} and ` : ''}using ${s.ability || 'Intelligence'} as the spellcasting ability (spell save DC ${int(s.dc, 10)}${attack}):`)];
    for (const g of s.groups || []) {
      const spells = String(g.spells || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (!spells.length) continue;
      out.push({ t: 'br', v: '\n' }, { t: 'label', v: `${clean(g.label) || 'At Will'}:` }, text(' '));
      spells.forEach((sp, i) => {
        if (i > 0) out.push(text(', '));
        out.push(...spellTokens(sp));
      });
    }
    return out;
  }

  // ---- public formatters -----------------------------------------------

  function formatAction(a, ctx = {}) {
    const name = clean(a.name) || 'Unnamed Action';
    const tokens = headerTokens(a, name);

    if (a.kind === 'spells') {
      tokens.push(...spellcastingTokens(a, { subject: ctx.subject || 'The creature' }));
      return tokens;
    }

    if (a.kind === 'save') {
      const save = a.save || {};
      const area = clean(a.area);
      tokens.push(text(' '), { t: 'label', v: `${save.ability || 'Dexterity'} Saving Throw:` });
      tokens.push(text(` DC ${int(save.dc, 10)}${area ? `, ${area}` : ''}`));
      endSentence(tokens);
      tokens.push(text(' '), { t: 'label', v: 'Failure:' }, text(' '));
      const effect = effectTokens(a, name, { allowSave: false, subject: ctx.subject || 'The creature' });
      tokens.push(...(effect.length ? effect : [text('No effect')]));
      endSentence(tokens);
      const success = a.success || 'half';
      if (success === 'half') tokens.push(text(' '), { t: 'label', v: 'Success:' }, text(' Half damage.'));
      else if (success === 'custom' && clean(a.successText)) {
        tokens.push(text(' '), { t: 'label', v: 'Success:' }, text(' '), ...inline(clean(a.successText), name));
        endSentence(tokens);
      }
      return tokens;
    }

    if (a.kind === 'text') {
      const trigger = clean(a.trigger);
      const body = clean(a.description);
      if (trigger) {
        // 2024 reaction layout
        tokens.push(text(' '), { t: 'label', v: 'Trigger:' }, text(' '), ...inline(trigger, name));
        endSentence(tokens);
        tokens.push(text(' '), { t: 'label', v: 'Response:' }, text(' '), ...inline(body || 'No effect', name));
        endSentence(tokens);
      } else if (body) {
        tokens.push(text(' '), ...inline(body, name));
      }
      return tokens;
    }

    tokens.push(text(' '), { t: 'label', v: KINDS[a.kind] || KINDS.melee }, text(' '));
    tokens.push(...toHitTokens(a.toHit, name));
    tokens.push(text(`, ${rangeText(a)} `), { t: 'label', v: 'Hit:' }, text(' '));
    tokens.push(...effectTokens(a, name, { allowSave: true, subject: ctx.subject || 'The creature' }));
    return endSentence(tokens);
  }

  const isAttack = (a) => a.kind in KINDS;

  function countWord(n) {
    return NUMBER_WORDS[n] || String(n);
  }

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  }

  // title: the statblock heading (used in "Copy all"). box: the name of the matching box in
  // D&D Beyond's homebrew monster form (used in the preview and the copy toasts).
  const SECTIONS = [
    { key: 'traits', title: 'Traits', box: 'Special Traits' },
    { key: 'actions', title: 'Actions', box: 'Actions' },
    { key: 'bonus', title: 'Bonus Actions', box: 'Bonus Actions' },
    { key: 'reactions', title: 'Reactions', box: 'Reactions' },
    { key: 'legendary', title: 'Legendary Actions', box: 'Legendary Actions' },
  ];
  const sectionOf = (a) => (SECTIONS.some((s) => s.key === a.section) ? a.section : 'actions');

  /** Attacks don't belong in Traits; every other kind is allowed everywhere. */
  const kindAllowed = (kind, section) => !(section === 'traits' && kind in KINDS);

  /** Problems to show on an action's card in the editor. Never throws. */
  function actionWarnings(a) {
    const out = [];
    if (!kindAllowed(a.kind, sectionOf(a))) {
      out.push('Attacks don’t belong in Traits. Change this to Text, Saving Throw or Spellcasting, or move it to another section.');
    }
    const fields = [];
    if (a.kind === 'text') fields.push(['Trigger', a.trigger], [clean(a.trigger) ? 'Response' : 'Description', a.description]);
    if (a.kind in KINDS || a.kind === 'save') fields.push(['Rider', a.rider]);
    if (a.kind === 'save' && a.success === 'custom') fields.push(['Success', a.successText]);
    if ((a.kind in KINDS || a.kind === 'save') && a.healing && a.healing.enabled) fields.push(['Healing', a.healing.text]);
    for (const [label, value] of fields) {
      for (const e of parseInline(clean(value), '').errors) out.push(`${label}: ${e}`);
    }
    return out;
  }

  /** Inline-dice problems in the multiattack's extra text. */
  function multiattackWarnings(monster) {
    const m = monster.multiattack || {};
    return parseInline(clean(m.tail), '').errors.map((e) => `Extra text: ${e}`);
  }

  /** How the text refers to the monster at the start of a sentence, e.g. "The Wyvern Rider". */
  function subjectOf(monster) {
    return clean(monster.subject)
      || clean(monster.multiattack && monster.multiattack.subject)
      || `The ${clean(monster.name) || 'creature'}`;
  }
  const midSentence = (subject) => subject.replace(/^The /, 'the ');

  /** Returns null when the multiattack is off or nothing is selected. */
  function formatMultiattack(monster) {
    const m = monster.multiattack;
    if (!m || !m.enabled) return null;
    const counts = m.counts || {};
    const items = (monster.actions || [])
      .filter((a) => isAttack(a) && sectionOf(a) === 'actions' && int(counts[a.id]) > 0)
      .map((a) => {
        const n = int(counts[a.id]);
        return `${countWord(n)} ${clean(a.name) || 'Unnamed'} attack${n > 1 ? 's' : ''}`;
      });
    const tail = clean(m.tail);
    if (!items.length && !tail) return null;
    const tokens = [{ t: 'name', v: 'Multiattack.' }];
    if (items.length) tokens.push(text(` ${subjectOf(monster)} makes ${joinList(items)}.`));
    if (tail) { tokens.push(text(' '), ...inline(tail, 'Multiattack')); endSentence(tokens); }
    return tokens;
  }

  /** The paragraph that opens the Legendary Actions section, in 2024 or 2014 wording. */
  function formatLegendaryIntro(monster) {
    const l = monster.legendary || {};
    const uses = Math.max(int(l.uses, 3), 1);
    const lair = int(l.lairUses, 0);
    const subject = subjectOf(monster);
    if (l.style === '2014') {
      return [text(`${subject} can take ${uses} legendary action${uses === 1 ? '' : 's'}, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature’s turn. ${subject} regains spent legendary actions at the start of its turn.`)];
    }
    return [
      { t: 'label', v: `Legendary Action Uses: ${uses}${lair > uses ? ` (${lair} in Lair)` : ''}.` },
      text(` Immediately after another creature’s turn, ${midSentence(subject)} can expend a use to take one of the following actions. ${subject} regains all expended uses at the start of each of its turns.`),
    ];
  }

  /** The monster's non-empty sections in statblock order: [{ key, title, blocks: [{ id, section, tokens }] }]. */
  function formatSections(monster) {
    return SECTIONS.map((s) => {
      const actions = (monster.actions || []).filter((a) => sectionOf(a) === s.key);
      const blocks = [];
      if (s.key === 'actions') {
        const multi = formatMultiattack(monster);
        if (multi) blocks.push({ id: 'multiattack', section: s.key, tokens: multi });
      }
      if (s.key === 'legendary' && actions.length) {
        blocks.push({ id: 'legendary-intro', section: s.key, tokens: formatLegendaryIntro(monster) });
      }
      for (const a of actions) blocks.push({ id: a.id, section: s.key, tokens: formatAction(a, { subject: subjectOf(monster) }) });
      return { ...s, blocks };
    }).filter((s) => s.blocks.length);
  }

  /** Every block of the monster in paste order. */
  function formatMonster(monster) {
    return formatSections(monster).flatMap((s) => s.blocks);
  }

  // ---- roll readout -------------------------------------------------------

  /**
   * What D&D Beyond will get from one roll token, read back from the token's own JSON (the same
   * string that goes into [rollable]…[/rollable]), so the preview shows exactly what is pasted.
   * Returns { notation, rollType, label, damageType, missingDamageType, average, min, max, action }
   * or null when the token isn't a roll or its JSON can't be read.
   */
  function rollReadout(tk) {
    if (!tk || tk.t !== 'roll') return null;
    let info;
    try { info = JSON.parse(tk.json); } catch { return null; }
    const notation = String(info.diceNotation || '');
    const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(notation);
    const rollType = String(info.rollType || '');
    const damageType = info.rollDamageType ? String(info.rollDamageType) : null;
    const isDmg = rollType === 'damage';
    const label = isDmg ? (damageType ? `${damageType} damage` : 'damage')
      : rollType === 'heal' ? 'healing'
        : rollType === 'to hit' ? 'to hit'
          : rollType === 'recharge' ? 'recharge'
            : rollType || 'roll';
    let average = null, min = null, max = null;
    if (m) {
      const count = int(m[1]), die = int(m[2]), mod = int(m[3] || 0);
      min = count + mod;
      max = count * die + mod;
      // Damage and healing use the statblock average (rounded down), which is the number printed
      // before the roll. Everything else shows the true mean, e.g. 15.5 for 1d20+5.
      average = isDmg || rollType === 'heal' ? avgDamage({ count, die, mod }) : (min + max) / 2;
    }
    return {
      notation, rollType, label, damageType,
      missingDamageType: isDmg && !damageType,
      average, min, max,
      action: String(info.rollAction ?? ''),
    };
  }

  // ---- renderers --------------------------------------------------------

  function toPlain(tokens, opts = {}) {
    return tokens.map((tk) => {
      switch (tk.t) {
        case 'name': return opts.markdownBold ? `**${tk.v}**` : tk.v;
        case 'roll': return `[rollable]${tk.display};${tk.json}[/rollable]`;
        case 'cond': return `[condition]${tk.v}[/condition]`;
        case 'spell': return `[spell]${tk.v}[/spell]`;
        default: return tk.v;
      }
    }).join('');
  }

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** Rich-text version for the clipboard: same markup, with the name bold-italic. */
  function toHtml(tokens) {
    const body = tokens.map((tk) => {
      switch (tk.t) {
        case 'name': return `<strong><em>${escapeHtml(tk.v)}</em></strong>`;
        case 'label': return `<em>${escapeHtml(tk.v)}</em>`;
        case 'roll': return escapeHtml(`[rollable]${tk.display};${tk.json}[/rollable]`);
        case 'cond': return escapeHtml(`[condition]${tk.v}[/condition]`);
        case 'spell': return escapeHtml(`[spell]${tk.v}[/spell]`);
        case 'br': return '<br>';
        default: return escapeHtml(tk.v);
      }
    }).join('');
    return `<p>${body}</p>`;
  }

  function blocksToClipboard(blockTokens, opts = {}) {
    return {
      text: blockTokens.map((t) => toPlain(t, opts)).join('\n\n'),
      html: blockTokens.map(toHtml).join(''),
    };
  }

  /** Several sections at once: each gets its title as a heading line, unless there's only one. */
  function sectionsToClipboard(sections, opts = {}) {
    const withHeadings = sections.length > 1;
    const text = [], html = [];
    for (const s of sections) {
      if (withHeadings) {
        text.push(s.title);
        html.push(`<h3>${escapeHtml(s.title)}</h3>`);
      }
      for (const b of s.blocks) {
        text.push(toPlain(b.tokens, opts));
        html.push(toHtml(b.tokens));
      }
    }
    return { text: text.join('\n\n'), html: html.join('') };
  }

  return {
    DAMAGE_TYPES, ABILITIES, CONDITIONS, SECTIONS,
    VERSATILE_WORDING,
    avgDamage, diceText, diceNotation, isAttack, sectionOf, kindAllowed, actionWarnings, multiattackWarnings, parseInline,
    formatAction, formatMultiattack, formatLegendaryIntro, formatSections, formatMonster,
    rollReadout,
    toPlain, toHtml, escapeHtml, blocksToClipboard, sectionsToClipboard,
  };
});
