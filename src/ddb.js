// D&D Beyond markup checker/repairer and pasted-action parser.
// Pure functions, no DOM: loaded as a classic <script> in the app (window.StatblockDDB)
// and with require() in the tests.
(function (root, factory) {
  const F = typeof module === 'object' && module.exports ? require('./format.js') : root.StatblockFormat;
  const api = factory(F);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatblockDDB = api;
})(typeof self !== 'undefined' ? self : this, function (F) {
  'use strict';

  const ROLL_KEYS = ['diceNotation', 'rollType', 'rollAction', 'rollDamageType'];
  const ROLL_TYPES = ['to hit', 'damage', 'heal', 'roll', 'recharge', 'save', 'check', 'spell'];
  const ROLL_TYPE_ALIASES = {
    tohit: 'to hit', 'to-hit': 'to hit', attack: 'to hit', hit: 'to hit', 'spell attack': 'to hit',
    dmg: 'damage', healing: 'heal', dice: 'roll',
  };
  const TOOLTIP_TAGS = ['condition', 'spell', 'spells', 'skill', 'action', 'sense'];

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return dp[m][n];
  }

  function matchKnownKey(key) {
    if (ROLL_KEYS.includes(key)) return key;
    const lower = key.toLowerCase();
    if (lower === 'damagetype' || lower === 'damage_type') return 'rollDamageType';
    if (lower === 'notation' || lower === 'dice') return 'diceNotation';
    if (lower === 'type') return 'rollType';
    if (lower === 'action' || lower === 'actionname') return 'rollAction';
    for (const k of ROLL_KEYS) {
      if (k.toLowerCase() === lower) return k;
    }
    let best = null, bestDist = 3;
    for (const k of ROLL_KEYS) {
      const d = levenshtein(lower, k.toLowerCase());
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best;
  }

  function canonicalDamageType(str) {
    if (!str) return null;
    const lower = String(str).trim().toLowerCase();
    return F.DAMAGE_TYPES.find((t) => t.toLowerCase() === lower) || null;
  }

  function parseDiceExpr(str) {
    const m = /^\s*(\d+)\s*d\s*(\d+)(?:\s*([+\-\u2212])\s*(\d+))?\s*$/i.exec(String(str || ''));
    if (!m) return null;
    const count = parseInt(m[1], 10);
    const die = parseInt(m[2], 10);
    if (count <= 0 || die <= 0) return null;
    const mod = m[3] ? parseInt(`${m[3] === '+' ? '+' : '-'}${m[4]}`, 10) : 0;
    return { count, die, mod, notation: F.diceNotation({ count, die, mod }) };
  }

  function formatRollJson(obj) {
    const ordered = [];
    for (const k of ROLL_KEYS) if (k in obj) ordered.push([k, obj[k]]);
    for (const [k, v] of Object.entries(obj)) if (!ROLL_KEYS.includes(k)) ordered.push([k, v]);
    return '{' + ordered.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(', ') + '}';
  }

  /** Attempts targeted repairs on broken JSON inside a [rollable] block. */
  function repairRollJson(rawJson, issues, snippet) {
    let s = rawJson.trim();
    // 1. Curly quotes -> straight double quotes.
    if (/[“”„‟]/.test(s)) {
      s = s.replace(/[“”„‟]/g, '"');
      issues.push({
        severity: 'error', kind: 'curly-quotes', fixed: true, snippet,
        message: 'Replaced curly quotation marks with straight quotes (curly quotes prevent D&D Beyond from reading the roll).',
      });
    }
    // 2. Single-quoted keys/values like {'diceNotation':'1d6'} -> double quotes.
    if (/^\{\s*'/.test(s) || /:\s*'[^']*'\s*[,}]/.test(s)) {
      s = s.replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":').replace(/:\s*'([^']*)'(\s*[,}])/g, ':"$1"$2');
      issues.push({
        severity: 'error', kind: 'single-quotes', fixed: true, snippet,
        message: 'Replaced single quotes with double quotes inside roll JSON.',
      });
    }
    // 3. Trailing comma before }.
    if (/,\s*\}$/.test(s)) {
      s = s.replace(/,\s*\}$/, '}');
      issues.push({
        severity: 'error', kind: 'trailing-comma', fixed: true, snippet,
        message: 'Removed a trailing comma before “}” inside roll JSON.',
      });
    }
    // Try direct parse first.
    const tryParse = (str) => { try { const v = JSON.parse(str); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
    let parsed = tryParse(s);
    if (parsed) return parsed;

    // 4. Missing closing quote before comma or brace: "1d20+6, "rollType" or "Claw}
    const fixedMissingClose = s
      .replace(/:\s*"([^"}\r\n,]+)(\s*,\s*")/g, ':"$1"$2')
      .replace(/:\s*"([^"}\r\n]+)(\s*\})/g, ':"$1"$2')
      // Missing opening quote after colon: :"1d20+6" vs :1d20+6"
      .replace(/:\s*([^"\s,{][^",}]*)"(\s*[,}])/g, ':"$1"$2')
      // Unquoted key before colon: {diceNotation:"1d6"}
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
    parsed = tryParse(fixedMissingClose);
    if (parsed) {
      issues.push({
        severity: 'error', kind: 'missing-quote', fixed: true, snippet,
        message: 'Repaired a missing quotation mark inside the roll JSON.',
      });
      return parsed;
    }

    // 5. Missing closing brace at the end.
    if (fixedMissingClose.startsWith('{') && !fixedMissingClose.endsWith('}')) {
      parsed = tryParse(`${fixedMissingClose}}`);
      if (parsed) {
        issues.push({
          severity: 'error', kind: 'missing-brace', fixed: true, snippet,
          message: 'Added a missing closing “}” to the roll JSON.',
        });
        return parsed;
      }
    }

    issues.push({
      severity: 'error', kind: 'invalid-json', fixed: false, snippet,
      message: 'Could not read the JSON data inside this rollable tag. Check for missing quotes, colons, or braces.',
    });
    return null;
  }

  /**
   * Analyzes and repairs raw D&D Beyond homebrew text containing [rollable] and tooltip tags.
   * opts: { spellEdition: 'any' | '2024' | '2014', alignDice: true }
   * Returns { issues, repaired, fixedCount, remainingCount, rollCount }.
   */
  function analyzeDdbMarkup(input, opts = {}) {
    const spellEdition = opts.spellEdition || 'any';
    const alignDice = opts.alignDice !== false;
    const issues = [];
    let text = String(input ?? '');

    // 1. Repair typoed [rollable] / [/rollable] tag names.
    text = text.replace(/\[(\/?)(rol+ables?)\]/gi, (m, slash, word) => {
      if (word.toLowerCase() === 'rollable') return `[${slash}rollable]`;
      issues.push({
        severity: 'error', kind: 'tag-typo', fixed: true, snippet: m,
        message: `Fixed misspelled tag “${m}” to “[${slash}rollable]”.`,
      });
      return `[${slash}rollable]`;
    });

    // 2. Auto-close unclosed [rollable]...{...} when followed by plain text or another tag.
    let closedText = '';
    let pos = 0;
    while (pos < text.length) {
      const openIdx = text.indexOf('[rollable]', pos);
      if (openIdx === -1) { closedText += text.slice(pos); break; }
      closedText += text.slice(pos, openIdx);
      const afterOpen = openIdx + '[rollable]'.length;
      const closeIdx = text.indexOf('[/rollable]', afterOpen);
      const nextOpen = text.indexOf('[rollable]', afterOpen);
      const hasProperClose = closeIdx !== -1 && (nextOpen === -1 || closeIdx < nextOpen);
      if (hasProperClose) {
        closedText += text.slice(openIdx, closeIdx + '[/rollable]'.length);
        pos = closeIdx + '[/rollable]'.length;
      } else {
        // Look for the end of the JSON object "}" before nextOpen (or end of line).
        const limit = nextOpen !== -1 ? nextOpen : text.length;
        const segment = text.slice(afterOpen, limit);
        const braceEnd = segment.indexOf('}');
        if (braceEnd !== -1) {
          const body = segment.slice(0, braceEnd + 1);
          closedText += `[rollable]${body}[/rollable]`;
          pos = afterOpen + braceEnd + 1;
          issues.push({
            severity: 'error', kind: 'unclosed-rollable', fixed: true, snippet: `[rollable]${body}`,
            message: 'This rollable block was missing its closing [/rollable] tag.',
          });
        } else {
          const lineEnd = segment.indexOf('\n');
          const badEnd = lineEnd !== -1 ? afterOpen + lineEnd : limit;
          const bad = text.slice(openIdx, badEnd);
          issues.push({
            severity: 'error', kind: 'unclosed-rollable', fixed: false, snippet: bad.slice(0, 70),
            message: 'Found an unclosed [rollable] tag with no JSON object.',
          });
          closedText += bad;
          pos = badEnd;
        }
      }
    }
    text = closedText;

    // 3. Check each [rollable]...[/rollable] block.
    let rollCount = 0;
    const parts = [];
    let last = 0;
    const rollRe = /\[rollable\]([\s\S]*?)\[\/rollable\]/g;
    let m;
    while ((m = rollRe.exec(text))) {
      rollCount++;
      const before = text.slice(last, m.index);
      const after = text.slice(rollRe.lastIndex);
      parts.push(before);
      last = rollRe.lastIndex;

      const body = m[1];
      const snippet = m[0].length > 80 ? `${m[0].slice(0, 77)}…` : m[0];
      let semi = body.indexOf(';');
      let display, rawJson;
      if (semi === -1) {
        const brace = body.indexOf('{');
        if (brace !== -1) {
          display = body.slice(0, brace).trim();
          rawJson = body.slice(brace);
          issues.push({
            severity: 'error', kind: 'missing-semicolon', fixed: true, snippet,
            message: 'Added the missing semicolon “;” between the displayed text and roll JSON.',
          });
        } else {
          issues.push({
            severity: 'error', kind: 'missing-json', fixed: false, snippet,
            message: 'This [rollable] block has no semicolon or JSON roll data.',
          });
          parts.push(m[0]);
          continue;
        }
      } else {
        display = body.slice(0, semi);
        rawJson = body.slice(semi + 1);
      }

      const obj = repairRollJson(rawJson, issues, snippet);
      if (!obj) {
        parts.push(m[0]);
        continue;
      }

      // 3a. Normalize / fix misspelled keys.
      const fixedObj = {};
      for (const [k, v] of Object.entries(obj)) {
        const matched = matchKnownKey(k);
        if (matched && matched !== k) {
          issues.push({
            severity: 'error', kind: 'misspelled-key', fixed: true, snippet,
            message: `“${k}” should be “${matched}”.`,
          });
          fixedObj[matched] = v;
        } else {
          if (!matched) {
            issues.push({
              severity: 'warn', kind: 'unknown-key', fixed: false, snippet,
              message: `Unknown roll field “${k}”. D&D Beyond expects diceNotation, rollType, rollAction, and rollDamageType.`,
            });
          }
          fixedObj[k] = v;
        }
      }

      // 3b. Check rollType.
      if (fixedObj.rollType != null) {
        const rt = String(fixedObj.rollType).trim();
        const lower = rt.toLowerCase();
        if (ROLL_TYPES.includes(lower)) {
          if (rt !== lower) {
            issues.push({
              severity: 'warn', kind: 'roll-type-case', fixed: true, snippet,
              message: `Changed rollType “${rt}” to lowercase “${lower}”.`,
            });
            fixedObj.rollType = lower;
          }
        } else if (ROLL_TYPE_ALIASES[lower]) {
          issues.push({
            severity: 'error', kind: 'roll-type-alias', fixed: true, snippet,
            message: `Changed rollType “${rt}” to “${ROLL_TYPE_ALIASES[lower]}”.`,
          });
          fixedObj.rollType = ROLL_TYPE_ALIASES[lower];
        } else {
          issues.push({
            severity: 'warn', kind: 'unknown-roll-type', fixed: false, snippet,
            message: `Unrecognized rollType “${rt}”. Common types are "to hit", "damage", "heal", "roll", and "recharge".`,
          });
        }
      } else {
        issues.push({
          severity: 'error', kind: 'missing-roll-type', fixed: false, snippet,
          message: 'This roll is missing its “rollType” field.',
        });
      }

      // 3c. Check & normalize diceNotation.
      if (!fixedObj.diceNotation || typeof fixedObj.diceNotation !== 'string') {
        issues.push({
          severity: 'error', kind: 'missing-dice', fixed: false, snippet,
          message: 'This roll is missing its “diceNotation” field.',
        });
      } else {
        const rawNot = fixedObj.diceNotation;
        const parsedDice = parseDiceExpr(rawNot);
        if (!parsedDice) {
          issues.push({
            severity: 'error', kind: 'invalid-dice', fixed: false, snippet,
            message: `“${rawNot}” is not valid dice notation (expected something like "1d20+6" or "2d6+4").`,
          });
        } else if (parsedDice.notation !== rawNot) {
          fixedObj.diceNotation = parsedDice.notation;
          issues.push({
            severity: 'warn', kind: 'dice-spacing', fixed: true, snippet,
            message: `Tidied diceNotation from “${rawNot}” to “${parsedDice.notation}”.`,
          });
        }
      }

      // 3d. Compare displayed text with diceNotation.
      const dispTrim = display.trim();
      if (fixedObj.diceNotation && parseDiceExpr(fixedObj.diceNotation)) {
        const toHitDisp = /^([+\-\u2212])\s*(\d+)$/.exec(dispTrim);
        const diceDisp = /^\(?\s*(\d+\s*d\s*\d+(?:\s*[+\-\u2212]\s*\d+)?)\s*\)?$/i.exec(dispTrim);
        if (toHitDisp && fixedObj.rollType === 'to hit') {
          const sign = toHitDisp[1] === '+' ? '+' : '-';
          const expected = `1d20${sign}${parseInt(toHitDisp[2], 10)}`;
          if (fixedObj.diceNotation !== expected) {
            if (alignDice) {
              issues.push({
                severity: 'warn', kind: 'display-mismatch', fixed: true, snippet,
                message: `The text shows ${dispTrim}, but the roll was configured for ${fixedObj.diceNotation}. Updated to ${expected}.`,
              });
              fixedObj.diceNotation = expected;
            } else {
              issues.push({
                severity: 'warn', kind: 'display-mismatch', fixed: false, snippet,
                message: `The text shows ${dispTrim}, but the button is configured to roll ${fixedObj.diceNotation}.`,
              });
            }
          }
        } else if (diceDisp) {
          const shown = parseDiceExpr(diceDisp[1]);
          if (shown && shown.notation !== fixedObj.diceNotation) {
            if (alignDice) {
              issues.push({
                severity: 'warn', kind: 'display-mismatch', fixed: true, snippet,
                message: `The text shows ${dispTrim}, but the roll was configured for ${fixedObj.diceNotation}. Updated to ${shown.notation}.`,
              });
              fixedObj.diceNotation = shown.notation;
            } else {
              issues.push({
                severity: 'warn', kind: 'display-mismatch', fixed: false, snippet,
                message: `The text shows ${dispTrim}, but the button is configured to roll ${fixedObj.diceNotation}.`,
              });
            }
          }
        }
      }

      // 3e. Check damage type on damage rolls.
      if (fixedObj.rollType === 'damage') {
        if (!fixedObj.rollDamageType || !String(fixedObj.rollDamageType).trim()) {
          const afterWord = /^\s+([a-z]+)\s+damage\b/i.exec(after);
          const inferred = afterWord && canonicalDamageType(afterWord[1]);
          if (inferred) {
            fixedObj.rollDamageType = inferred;
            issues.push({
              severity: 'warn', kind: 'missing-damage-type', fixed: true, snippet,
              message: `This damage roll had no rollDamageType; filled in “${inferred}” from the following text.`,
            });
          } else {
            issues.push({
              severity: 'warn', kind: 'missing-damage-type', fixed: false, snippet,
              message: 'This damage roll does not identify its damage type (rollDamageType).',
            });
          }
        } else {
          const canon = canonicalDamageType(fixedObj.rollDamageType);
          if (!canon) {
            issues.push({
              severity: 'warn', kind: 'unknown-damage-type', fixed: false, snippet,
              message: `“${fixedObj.rollDamageType}” isn’t a standard 5e damage type.`,
            });
          }
        }
      }

      // 3f. Check printed average before damage/heal rolls.
      if ((fixedObj.rollType === 'damage' || fixedObj.rollType === 'heal') && fixedObj.diceNotation) {
        const parsedDice = parseDiceExpr(fixedObj.diceNotation);
        const avgMatch = /(?:^|[\s:(])(\d+)\s+$/.exec(before);
        if (parsedDice && avgMatch) {
          const printed = parseInt(avgMatch[1], 10);
          const expectedAvg = F.avgDamage(parsedDice);
          if (printed !== expectedAvg) {
            issues.push({
              severity: 'warn', kind: 'average-mismatch', fixed: false, snippet,
              message: `Printed average is ${printed}, but ${parsedDice.notation} averages ${expectedAvg}.`,
            });
          }
        }
      }

      parts.push(`[rollable]${display};${formatRollJson(fixedObj)}[/rollable]`);
    }
    parts.push(text.slice(last));
    text = parts.join('');

    // 4. Stray closing [/rollable] tags left outside any matched block.
    const strayCheck = text.replace(/\[rollable\][\s\S]*?\[\/rollable\]/g, '');
    if (strayCheck.includes('[/rollable]')) {
      issues.push({
        severity: 'error', kind: 'stray-close', fixed: false, snippet: '[/rollable]',
        message: 'Found an extra [/rollable] closing tag with no matching [rollable] opener.',
      });
    }

    // 5. Tooltip tag repairs: mismatched/typoed closing tags and 2014/2024 spell tag alignment.
    text = text.replace(/\[(condition|spells?|skill|action|sense)\]([^\[\]\r\n]+?)\[\/([a-z]+)\]/gi, (full, openTag, inner, closeTag) => {
      const open = openTag.toLowerCase();
      const close = closeTag.toLowerCase();
      let target = open;
      if (open !== close) {
        // Check if it's a typo or singular/plural mismatch.
        issues.push({
          severity: 'error', kind: 'tooltip-close-mismatch', fixed: true, snippet: full,
          message: `Fixed mismatched tooltip closing tag [/${closeTag}] to [/${open}].`,
        });
      }
      if ((target === 'spell' || target === 'spells') && (spellEdition === '2024' || spellEdition === '2014')) {
        const want = spellEdition === '2024' ? 'spells' : 'spell';
        if (target !== want) {
          issues.push({
            severity: 'warn', kind: 'spell-edition', fixed: true, snippet: full,
            message: `Updated [${target}]${inner}[/${target}] to [${want}]${inner}[/${want}] for ${spellEdition} rules.`,
          });
          target = want;
        }
      }
      return `[${target}]${inner}[/${target}]`;
    });

    // Unclosed tooltip opener (e.g. "[condition]Prone" with no closing tag).
    const strippedTags = text.replace(/\[(condition|spells?|skill|action|sense)\][^\[\]\r\n]+?\[\/\1\]/gi, '');
    let unclosedTip;
    const unclosedRe = /\[(condition|spells?|skill|action|sense)\]([^\[\]\r\n]{1,40})/gi;
    while ((unclosedTip = unclosedRe.exec(strippedTags))) {
      issues.push({
        severity: 'error', kind: 'unclosed-tooltip', fixed: false, snippet: unclosedTip[0],
        message: `Tooltip tag [${unclosedTip[1]}] appears to be missing its closing [/${unclosedTip[1]}] tag.`,
      });
    }

    const fixedCount = issues.filter((i) => i.fixed).length;
    const remainingCount = issues.length - fixedCount;
    return { issues, repaired: text, fixedCount, remainingCount, rollCount };
  }

  // ---- paste existing action parser -------------------------------------

  /** Strips Markdown emphasis and existing DDB tags into clean plain statblock prose. */
  function cleanStatblockInput(raw) {
    let s = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
    // Unwrap existing [rollable]display;{...}[/rollable] -> display
    s = s.replace(/\[rollable\]([^;\[\]]+);[\s\S]*?\[\/rollable\]/gi, '$1');
    // Unwrap existing tooltip tags [condition]Prone[/condition] -> Prone
    s = s.replace(/\[(condition|spells?|skill|action|sense)\]([^\[\]]+?)\[\/\1\]/gi, '$2');
    // Strip Markdown bold/italic wrappers: ***Name.***, **Name.**, *Hit:*
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1');
    // Normalize unicode minus/dashes in numbers and whitespace inside lines
    s = s.replace(/[\u2013\u2014]/g, '-').replace(/\u2212/g, '-');
    // Collapse multiple spaces on each line
    return s.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
  }

  /**
   * Splits "Name (Recharge 5-6). Rest of text..." into { name, usage, body }.
   * Handles both named actions and bare paragraphs.
   */
  function splitHeader(cleaned) {
    const usage = { type: 'none', recharge: 5, perDay: 1, cost: 2, text: '' };
    // Match leading "Name (optional tag)." followed by space or newline.
    const m = /^([^.:\n]{1,60}?)(?:\s*\(([^)\n]{1,40})\))?\.\s+([\s\S]+)$/.exec(cleaned);
    if (!m) return { name: '', usage, body: cleaned };
    const name = m[1].trim();
    const tag = m[2] ? m[2].trim() : '';
    const body = m[3].trim();
    // Guard against accidentally splitting a normal sentence ("The creature moves 30 feet. It then...").
    if (name.split(/\s+/).length > 6 && !tag) return { name: '', usage, body: cleaned };
    if (tag) {
      const rech = /^Recharge\s+(\d)(?:\s*-\s*6)?$/i.exec(tag);
      const day = /^(\d+)\s*\/\s*Day$/i.exec(tag);
      const cost = /^Costs?\s+(\d+)\s+Actions?$/i.exec(tag);
      if (rech) { usage.type = 'recharge'; usage.recharge = Math.min(Math.max(parseInt(rech[1], 10), 2), 6); }
      else if (day) { usage.type = 'perDay'; usage.perDay = Math.max(parseInt(day[1], 10), 1); }
      else if (cost) { usage.type = 'cost'; usage.cost = Math.max(parseInt(cost[1], 10), 1); }
      else { usage.type = 'custom'; usage.text = tag; }
    }
    return { name, usage, body };
  }

  /**
   * Converts plain statblock prose into Stat Forge's inline syntax ({dmg ...}, {heal ...}, {+N}, {1d4}, {condition ...})
   * while preserving the author's exact wording.
   */
  function convertTextToInline(text) {
    let s = String(text ?? '');
    const dmgTypesPattern = F.DAMAGE_TYPES.join('|');
    // 1. Healing: "regains 13 (2d8 + 4) hit points" -> "regains {heal 2d8+4} hit points"
    s = s.replace(/\b(regains?\s+)\d+\s*\((\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)\)(\s+hit points?)\b/gi, (_, pre, dice, post) => {
      const d = parseDiceExpr(dice);
      return d ? `${pre}{heal ${d.notation}}${post}` : _;
    });
    // 2. Typed damage: "11 (2d6 + 4) slashing damage" -> "{dmg 2d6+4 Slashing} slashing damage"
    const typedDmgRe = new RegExp(`\\b\\d+\\s*\\((\\d+\\s*d\\s*\\d+(?:\\s*[+-]\\s*\\d+)?)\\)\\s+(${dmgTypesPattern})\\s+damage\\b`, 'gi');
    s = s.replace(typedDmgRe, (full, dice, type) => {
      const d = parseDiceExpr(dice);
      const canon = canonicalDamageType(type);
      return d && canon ? `{dmg ${d.notation} ${canon}} ${type} damage` : full;
    });
    // 3. Untyped average+dice damage: "10 (3d6) damage" -> "{dmg 3d6} damage"
    s = s.replace(/\b\d+\s*\((\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)\)\s+damage\b/gi, (full, dice) => {
      const d = parseDiceExpr(dice);
      return d ? `{dmg ${d.notation}} damage` : full;
    });
    // 4. To-hit bonuses: "+6 to hit" or "Attack Roll: +6"
    s = s.replace(/(Attack Roll:\s*)([+-]\d+)\b/gi, '$1{$2}');
    s = s.replace(/([+-]\d+)(\s+to hit)\b/gi, '{$1}$2');
    // 5. Remaining bare dice outside braces (e.g. "for 1d4 rounds")
    s = s.replace(/(^|[(\s])(\d+d\d+(?:\s*[+-]\s*\d+)?)(?=$|[\s).,;:])/gi, (full, lead, dice) => {
      if (lead === '(') return full; // skip already-unmatched parenthesized dice
      const d = parseDiceExpr(dice);
      return d ? `${lead}{${d.notation}}` : full;
    });
    // 6. Standard 5e conditions when phrased as a condition ("is Poisoned", "has the Prone condition", "be Grappled")
    const condPattern = F.CONDITIONS.join('|');
    const condRe = new RegExp(`\\b(is|be|becomes?|has the|have the|gains? the|while)\\s+(${condPattern})\\b`, 'g');
    s = s.replace(condRe, '$1 {condition $2}');
    return s;
  }

  function parseDamageClause(str) {
    const dmgTypesPattern = F.DAMAGE_TYPES.join('|');
    const diceRe = new RegExp(`^(?:\\d+\\s*)?\\((\\d+\\s*d\\s*\\d+(?:\\s*[+-]\\s*\\d+)?)\\)\\s+(${dmgTypesPattern})\\s+damage`, 'i');
    const dm = diceRe.exec(str);
    if (dm) {
      const d = parseDiceExpr(dm[1]);
      const type = canonicalDamageType(dm[2]) || 'Bludgeoning';
      if (d) return { damage: { count: d.count, die: d.die, mod: d.mod, type }, rest: str.slice(dm[0].length) };
    }
    const flatRe = new RegExp(`^(\\d+)\\s+(${dmgTypesPattern})\\s+damage`, 'i');
    const fm = flatRe.exec(str);
    if (fm) {
      const type = canonicalDamageType(fm[2]) || 'Bludgeoning';
      return { damage: { count: 0, die: 6, mod: parseInt(fm[1], 10), type }, rest: str.slice(fm[0].length) };
    }
    return null;
  }

  function parseConditionFrom(str) {
    const condPattern = F.CONDITIONS.join('|');
    // 2024: "has the Poisoned condition until ..." / 2014: "is Poisoned (escape DC 13)"
    const re24 = new RegExp(`(?:,?\\s*and\\s+)?(?:the target\\s+)?(?:has|have)\\s+the\\s+(${condPattern})\\s+condition(?:\\s+([^.]+))?`, 'i');
    const re14 = new RegExp(`(?:,?\\s*and\\s+)?(?:the target\\s+)?(?:is(?:\\s+also)?|be)\\s+(${condPattern})(?:\\s+([^.]+))?`, 'i');
    for (const re of [re24, re14]) {
      const m = re.exec(str);
      if (m) {
        const name = F.CONDITIONS.find((c) => c.toLowerCase() === m[1].toLowerCase());
        const duration = m[2] ? m[2].trim().replace(/\.$/, '') : '';
        const before = str.slice(0, m.index).trim();
        const after = str.slice(m.index + m[0].length).trim().replace(/^\.\s*/, '');
        return { condition: { enabled: true, name, duration }, leftover: [before, after].filter(Boolean).join(' ') };
      }
    }
    return null;
  }

  function parseAttackStructured(header, section) {
    const { name, usage, body } = header;
    // Match 2014 ("Melee Weapon Attack:", "Ranged Spell Attack:") or 2024 ("Melee Attack Roll:", "Melee or Ranged Attack Roll:")
    const atkRe = /^(Melee or Ranged|Melee|Ranged)\s+(?:(Weapon|Spell)\s+)?Attack(?:\s+Roll)?:\s*([+-]?\d+)(?:\s+to hit)?,\s*([\s\S]+?)\s*\b(Hit or Miss|Hit):\s*([\s\S]+)$/i;
    const m = atkRe.exec(body);
    if (!m) return null;

    const kindRaw = m[1].toLowerCase();
    const kind = kindRaw.includes('or') ? 'both' : kindRaw;
    const attackSource = m[2] && m[2].toLowerCase() === 'spell' ? 'spell' : 'weapon';
    const toHit = parseInt(m[3], 10);
    const rangeStr = m[4];
    const hitOrMiss = m[5].toLowerCase() === 'hit or miss';
    let rest = m[6].trim();

    let reach = 5, rangeNormal = 80, rangeLong = 320;
    const reachM = /reach\s+(\d+)\s*ft/i.exec(rangeStr);
    if (reachM) reach = parseInt(reachM[1], 10);
    const rangeM = /range\s+(\d+)(?:\/(\d+))?\s*ft/i.exec(rangeStr);
    if (rangeM) {
      rangeNormal = parseInt(rangeM[1], 10);
      rangeLong = rangeM[2] ? parseInt(rangeM[2], 10) : 0;
    }

    // Separate optional trailing "Miss: ..." sentence.
    let miss = '';
    const missM = /\bMiss:\s*([\s\S]+)$/i.exec(rest);
    if (missM) {
      miss = convertTextToInline(missM[1].trim().replace(/\.$/, ''));
      rest = rest.slice(0, missM.index).trim();
    }

    const notes = [];
    // Primary damage
    let damage = null;
    const prim = parseDamageClause(rest);
    if (prim) {
      damage = prim.damage;
      rest = prim.rest.trim();
    } else {
      notes.push('Could not extract a standard primary damage roll; kept hit text in Rider.');
    }

    // Optional versatile damage: ", or 8 (1d10 + 3) slashing damage if used with two hands"
    const versatile = { enabled: false, count: 1, die: 10, mod: 3, type: damage ? damage.type : 'Slashing', text: F.VERSATILE_WORDING };
    const versLead = /^,?\s*or\s+/i.exec(rest);
    if (versLead && (kind === 'melee' || kind === 'both')) {
      const vp = parseDamageClause(rest.slice(versLead[0].length));
      if (vp) {
        let afterVers = vp.rest.trim();
        const wordsM = /^([^,.;]+?)(?=,?\s*plus\b|,?\s*and\b|\.|;|$)/i.exec(afterVers);
        const words = wordsM ? wordsM[1].trim() : '';
        if (wordsM) afterVers = afterVers.slice(wordsM[0].length).trim();
        versatile.enabled = true;
        versatile.count = vp.damage.count;
        versatile.die = vp.damage.die;
        versatile.mod = vp.damage.mod;
        versatile.type = vp.damage.type;
        versatile.text = words;
        rest = afterVers;
      }
    }

    // Extra damage: "plus 7 (2d6) fire damage"
    const extraDamage = [];
    while (true) {
      const plusM = /^,?\s*plus\s+/i.exec(rest);
      if (!plusM) break;
      const ep = parseDamageClause(rest.slice(plusM[0].length));
      if (!ep) break;
      extraDamage.push(ep.damage);
      rest = ep.rest.trim();
    }

    // Optional on-hit saving throw
    const save = { enabled: false, ability: 'Constitution', dc: 13, damage: null, half: true };
    const condition = { enabled: false, name: 'Poisoned', duration: '' };
    rest = rest.replace(/^\.\s*/, '').trim();

    const saveRe = new RegExp(`^(?:and\\s+)?the target must (?:make|succeed on) a DC (\\d+) (${F.ABILITIES.join('|')}) saving throw([\\s\\S]*)$`, 'i');
    const sm = saveRe.exec(rest);
    if (sm) {
      save.enabled = true;
      save.dc = parseInt(sm[1], 10);
      save.ability = F.ABILITIES.find((ab) => ab.toLowerCase() === sm[2].toLowerCase()) || 'Constitution';
      let afterSave = sm[3].trim();
      const saveDmgLead = /^(?:,?\s*taking\s+|or take\s+)/i.exec(afterSave);
      if (saveDmgLead) {
        const sdp = parseDamageClause(afterSave.slice(saveDmgLead[0].length));
        if (sdp) {
          save.damage = sdp.damage;
          afterSave = sdp.rest.trim();
          const halfRe = /^(?:\s*on a failed save,?\s*or half as much(?: damage)? on a successful one|,?\s*half as much on a success)/i;
          const hm = halfRe.exec(afterSave);
          if (hm) {
            save.half = true;
            afterSave = afterSave.slice(hm[0].length).trim();
          } else {
            save.half = false;
          }
        }
      }
      afterSave = afterSave.replace(/^[.,]\s*/, '').replace(/^On a failed save,?\s*/i, '').trim();
      const cm = parseConditionFrom(afterSave);
      if (cm) {
        Object.assign(condition, cm.condition);
        afterSave = cm.leftover;
      }
      rest = afterSave;
    } else if (rest) {
      const cm = parseConditionFrom(rest);
      if (cm && !cm.leftover) {
        Object.assign(condition, cm.condition);
        rest = '';
      }
    }

    const rider = rest ? convertTextToInline(rest.replace(/^[.,]\s*/, '').replace(/\.$/, '').trim()) : '';
    if (rider) notes.push('Extra wording was preserved in Rider text — check the preview to make sure it reads as intended.');

    return {
      recognized: 'Attack',
      notes,
      action: {
        name: name || 'Attack',
        kind,
        attackSource,
        section: section === 'traits' || section === 'lair' ? 'actions' : section,
        usage,
        toHit,
        reach,
        rangeNormal,
        rangeLong,
        damage: damage || { count: 1, die: 8, mod: 0, type: 'Slashing' },
        extraDamage,
        versatile,
        save,
        condition,
        rider,
        showRider: !!rider,
        miss,
        hitOrMiss,
        showMiss: !!(miss || hitOrMiss),
      },
    };
  }

  function parseSaveStructured(header, section) {
    const { name, usage, body } = header;
    const abPattern = F.ABILITIES.join('|');
    // 2024: "Dexterity Saving Throw: DC 17, each creature in a 60-foot Cone. Failure: ... Success: ..."
    const re24 = new RegExp(`^(${abPattern})\\s+Saving Throw:\\s*DC\\s*(\\d+)(?:,\\s*([^.]+))?\\.\\s*Failure:\\s*([\\s\\S]+)$`, 'i');
    // 2014: "Each creature in a 30-foot cone must make a DC 15 Dexterity saving throw, taking ..."
    const re14 = new RegExp(`^([^.]+?)\\s+must\\s+(?:make|succeed on)\\s+a\\s+DC\\s*(\\d+)\\s+(${abPattern})\\s+saving throw([\\s\\S]+)$`, 'i');

    let ability, dc, area, failText, success = 'none', successText = '';
    const m24 = re24.exec(body);
    if (m24) {
      ability = F.ABILITIES.find((a) => a.toLowerCase() === m24[1].toLowerCase()) || 'Dexterity';
      dc = parseInt(m24[2], 10);
      area = (m24[3] || '').trim();
      failText = m24[4].trim();
      const succM = /\bSuccess:\s*([\s\S]+)$/i.exec(failText);
      if (succM) {
        const st = succM[1].trim().replace(/\.$/, '');
        failText = failText.slice(0, succM.index).trim();
        if (/^half damage$/i.test(st)) success = 'half';
        else { success = 'custom'; successText = convertTextToInline(st); }
      }
    } else {
      const m14 = re14.exec(body);
      if (!m14) return null;
      area = m14[1].trim();
      if (/^the target$/i.test(area)) area = '';
      else if (/^Each /.test(area)) area = `each ${area.slice(5)}`;
      dc = parseInt(m14[2], 10);
      ability = F.ABILITIES.find((a) => a.toLowerCase() === m14[3].toLowerCase()) || 'Dexterity';
      failText = m14[4].trim()
        .replace(/^,?\s*taking\s+/i, '')
        .replace(/^\s*or take\s+/i, '')
        .replace(/^\.\s*On a failed save,?\s*the target takes\s+/i, '');
      const half14 = /\s*on a failed save,?\s*or half as much(?: damage)? on a successful one\.?/i.exec(failText);
      if (half14) {
        success = 'half';
        failText = `${failText.slice(0, half14.index)} ${failText.slice(half14.index + half14[0].length)}`.trim();
      } else {
        const custom14 = /\bOn a successful save,?\s*([\s\S]+)$/i.exec(failText);
        if (custom14) {
          success = 'custom';
          successText = convertTextToInline(custom14[1].trim().replace(/\.$/, ''));
          failText = failText.slice(0, custom14.index).trim();
        }
      }
    }

    failText = failText.replace(/^On a failed save,?\s*/i, '').trim();
    let damage = null;
    const extraDamage = [];
    const prim = parseDamageClause(failText);
    if (prim) {
      damage = prim.damage;
      failText = prim.rest.trim();
      while (true) {
        const plusM = /^,?\s*plus\s+/i.exec(failText);
        if (!plusM) break;
        const ep = parseDamageClause(failText.slice(plusM[0].length));
        if (!ep) break;
        extraDamage.push(ep.damage);
        failText = ep.rest.trim();
      }
    }
    const condition = { enabled: false, name: 'Poisoned', duration: '' };
    failText = failText.replace(/^\.\s*/, '').replace(/^On a failed save,?\s*/i, '').trim();
    const cm = parseConditionFrom(failText);
    if (cm) {
      Object.assign(condition, cm.condition);
      failText = cm.leftover;
    }
    const rider = failText ? convertTextToInline(failText.replace(/^[.,]\s*/, '').replace(/\.$/, '').trim()) : '';
    const notes = [];
    if (rider) notes.push('Extra wording was preserved in Rider text — review the preview before adding.');

    return {
      recognized: 'Saving Throw',
      notes,
      action: {
        name: name || (section === 'lair' ? '' : 'Saving Throw'),
        kind: 'save',
        section,
        usage,
        save: { enabled: true, ability, dc, damage: null, half: true },
        area,
        damage,
        extraDamage,
        condition,
        success,
        successText,
        rider,
        showRider: !!rider,
      },
    };
  }

  function parseSpellcastingStructured(header, section) {
    const { name, usage, body } = header;
    if (!/spellcasting ability|casts one of the following spells|spell save DC/i.test(body)) return null;
    const abM = /\b(Intelligence|Wisdom|Charisma)\b/i.exec(body);
    const dcM = /spell save DC\s*(\d+)/i.exec(body);
    const atkM = /([+-]\d+)\s+to hit with spell attacks/i.exec(body);
    const compM = /,\s*(requiring [^,]+?)\s+and using\b/i.exec(body);
    const lines = body.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    const groups = [];
    for (const line of lines) {
      const gm = /^([^:]{2,40}):\s*(.+)$/.exec(line);
      if (gm) groups.push({ label: gm[1].trim(), spells: gm[2].trim().replace(/\.$/, '') });
    }
    if (!groups.length && !dcM) return null;
    const notes = [];
    if (!groups.length) notes.push('Spell lines were not on separate lines; add or split them in the editor.');
    return {
      recognized: 'Spellcasting',
      notes,
      action: {
        name: name || 'Spellcasting',
        kind: 'spells',
        section: section === 'lair' ? 'actions' : section,
        usage,
        spells: {
          ability: abM ? abM[1][0].toUpperCase() + abM[1].slice(1).toLowerCase() : 'Intelligence',
          dc: dcM ? parseInt(dcM[1], 10) : 13,
          attack: atkM ? parseInt(atkM[1], 10) : 5,
          hasAttack: !!atkM,
          edition: 'auto',
          components: compM ? compM[1].trim() : '',
          groups: groups.length ? groups : [{ label: 'At Will', spells: '' }],
        },
      },
    };
  }

  /**
   * Parses pasted plain-text, Markdown, or DDB statblock text for a single action/trait.
   * Returns:
   *  - structured: { recognized, notes, action } or null (when not confidently recognized)
   *  - exactText: { action, convertedCount } — always available; keeps exact wording with inline dice/tags
   */
  function parseActionText(raw, opts = {}) {
    const section = opts.section || 'actions';
    const cleaned = cleanStatblockInput(raw);
    if (!cleaned) return { structured: null, exactText: null };

    const header = splitHeader(cleaned);
    let structured = null;
    if (section !== 'lair') structured = parseAttackStructured(header, section);
    if (!structured) structured = parseSaveStructured(header, section);
    if (!structured) structured = parseSpellcastingStructured(header, section);

    // Build the exact-wording Text card (also detects Trigger: / Response: for Reactions).
    let trigger = '';
    let descBody = header.body;
    const trigM = /^Trigger:\s*([\s\S]+?)\s*Response:\s*([\s\S]+)$/i.exec(header.body);
    if (trigM) {
      trigger = convertTextToInline(trigM[1].trim().replace(/\.$/, ''));
      descBody = trigM[2].trim();
    }
    const description = convertTextToInline(descBody);
    const convertedCount = ((trigger + ' ' + description).match(/\{[^{}]+\}/g) || []).length;
    const exactAction = {
      name: header.name || (section === 'lair' ? '' : 'Imported Ability'),
      kind: 'text',
      section: trigM ? 'reactions' : section,
      usage: header.usage,
      trigger,
      description,
    };

    return {
      structured,
      exactText: { action: exactAction, convertedCount },
    };
  }

  return {
    analyzeDdbMarkup,
    cleanStatblockInput,
    convertTextToInline,
    parseActionText,
  };
});
