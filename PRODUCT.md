# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Dungeon Masters who homebrew monsters in D&D Beyond's homebrew monster editor and want the dice in their statblocks to be clickable (rollable) in the Encounter Builder, Combat Tracker, Maps and AboveVTT. These are the people asking for help in the DDB forum threads on `[rollable]` tags. They know 5e statblocks by heart and don't want to hand-write markup.

## Product Purpose
Turn the numbers a DM already knows (to-hit, damage dice, save DC, recharge, spells) into the exact D&D Beyond `[rollable]` / `[spell]` / `[condition]` markup, one action or section at a time, with a live statblock preview. Success: a DM builds a monster's actions and pastes them into DDB with every roll working first time, without learning the syntax.

## Positioning
The only tool focused on D&D Beyond's rollable markup that handles multiattack, spellcasting, legendary actions (2014 and 2024 wording), recharge, healing and versatile damage. Existing alternatives are a 2021 Google Sheet, a Ruby CLI and DDB's own unreliable "add rollable" button.

## Operating Context
Used in a desktop browser with D&D Beyond open in the next tab. The DM copies one section at a time, because DDB has a separate box per section (Traits, Actions, Bonus Actions, Reactions, Legendary). Prep happens in evening or weekend sessions. Monsters are saved in the browser; JSON import/export is used for sharing and backup. A Windows Electron build exists as a secondary offline option.

## Capabilities and Constraints
- Plain JavaScript, no framework. `format.js` is pure text generation. Strict CSP (`script-src 'self'`); no network calls.
- Sections: Traits, Actions, Bonus Actions, Reactions, Legendary Actions.
- Action kinds: Melee, Ranged, Melee or Ranged, Saving Throw, Spellcasting, Text.
- Inline dice syntax in free text: `{1d4}`, `{dmg 3d6 Fire}`, `{heal 2d8+4}`, `{+5}`.
- Output: plain text with markup, or rich HTML clipboard with bold-italic names; optional Markdown bold.
- Not affiliated with Wizards of the Coast or D&D Beyond. Must not use their logos or trade dress.

## Brand Commitments
The tool has its own name ("Statblock Builder" for now) with a light "by RogueSector" credit linking to roguesector.dev. Light touch, not full RogueSector branding.

## Evidence on Hand
- Real DDB forum threads documenting the pain: 106856 (rollable tags guide, 2021 to 2026), article 1651, threads 227891, 232771, 212873.
- Example monster: Wyvern Rider (src/example.js).
- No users, testimonials or usage numbers exist yet. Don't invent them.

## Product Principles
1. The output must paste and roll correctly. Correctness beats features.
2. Speak 5e, not markup: users fill in statblock numbers, never syntax.
3. One section at a time, matching DDB's boxes.
4. Nothing leaves the browser.
