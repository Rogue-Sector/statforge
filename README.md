# Stat Forge

A small tool for building D&D monster actions with D&D Beyond's clickable dice (`[rollable]…[/rollable]`). Fill in the numbers, then copy and paste the result into D&D Beyond or AboveVTT. Nothing leaves your browser.

**Screenshot:** _coming soon_

## Running it

### In your browser

Stat Forge is a static site in `src/` with no build step and no network calls — host `src/` on any static host (GitHub Pages, Cloudflare Pages, Netlify, etc.) or serve it locally:

```bash
npx serve src
```

Your monsters save automatically in your browser's `localStorage`. Use **Export** to back them up or move them between browsers.

### Offline Windows app (optional)

Double-click `StatForge.exe` (built with `npm run dist`). There's nothing to install, and it works offline.

The app isn't code-signed, so the first time you run it Windows may show **"Windows protected your PC"**. Click **More info → Run anyway**.

In the desktop app, your monsters are saved automatically to `%APPDATA%\Stat Forge\library.json`.

## Using it

1. **Pick or create a monster** in the left sidebar, or press `Ctrl+K` (`Cmd+K` on a Mac) to find one by name, folder or type. The Wyvern Rider is preloaded as an example.
   - Click the line under the monster's name to set its **size, type, CR and folder**. They only organise your library and never appear in the copied text. **Creature is called** in the same panel sets how the text names it, e.g. "The dragon".
   - **Wording** in the same panel picks the rules the text is written for, for the whole monster:
     - **2024 rules**: "Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8 + 3) Slashing damage." Saving throws get "Failure:" and "Success:" labels.
     - **2014 rules**: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage." Saving throws read "Each creature in a 30-foot cone must make a DC 15 Dexterity saving throw, taking 22 (5d8) fire damage on a failed save, or half as much damage on a successful one." Damage types and "hit points" are lowercase. Conditions keep their capital letter, because they're D&D Beyond tooltips.
   - The sidebar groups monsters by folder. Make one with **+ New folder**, then drag monsters onto it or pick it under a monster's name. Deleting a folder moves its monsters to Unsorted.
   - **Find a monster** filters the sidebar as you type.
2. **Pick a section tab**: Traits, Actions, Bonus Actions, Reactions, Legendary or Lair. There's one tab for each box in D&D Beyond's homebrew monster form. Click an action to open it, and use **+ Add action** to add one to the current tab. You can move an action to another section later with its **Section** dropdown.
   - **Traits** are passive features such as Regeneration, Pack Tactics, Legendary Resistance and auras. They take the Text, Saving Throw and Spellcasting kinds; attacks are hidden there, and an attack moved into Traits shows a warning. Use **Usage → Custom** for tags like "3/Day, or 4/Day in Lair". In D&D Beyond they go in the **Special Traits** box.
   - **Melee, Ranged, or Melee or Ranged attack.** Set the to-hit bonus, reach or range, and damage (dice, die, modifier, type). Then add any of:
     - **Versatile** (tick it under Damage, melee attacks only): a second damage for two-handed use. "7 (1d8 + 3) Slashing damage, or 8 (1d10 + 3) Slashing damage if used with two hands". It starts as a copy of the main damage one die size bigger, and the type and wording can be changed.
     - **+ Extra damage**: "plus 7 (2d6) Fire damage"
     - **+ Healing**: "and the dragon regains 13 (2d8 + 4) Hit Points" (**Self**, using "Creature is called") or "and the target regains…" (**Target**). The amount is its own healing roll. **Custom wording** replaces "regains 13 (2d8 + 4) Hit Points". Use it for life drain ("regains Hit Points equal to the damage dealt"), which D&D Beyond can't roll separately.
     - **+ Saving throw**: "the target must make a DC 16 Constitution saving throw or take…"
     - **+ Condition**: Poisoned, Grappled, Prone, …
     - **+ Rider text**: extra wording. Start it lowercase to continue the sentence, or with a capital letter to start a new sentence.
     - **+ Miss**: what happens on a miss, added after the hit as "Miss: Half damage." It can hold dice. Tick **Hit or Miss** to label the effect "Hit or Miss:" instead of "Hit:" when it happens either way.
   - **Saving Throw.** Breath weapons and auras: DC, who it targets, what happens on a failure, and what happens on a success. It can also have **+ Healing**.
   - **Spellcasting.** Pick the ability, save DC and spell attack bonus, then add a line for each frequency ("At Will", "1/Day Each", …) and type the spells separated by commas. Each spell is wrapped as `[spell]Fireball[/spell]`, and anything in brackets like "(level 4 version)" stays outside the tag.
   - **Text.** Anything else, copied exactly as you type it. In Reactions it also has a **Trigger** box, which gives the 2024 "Trigger: … Response: …" layout.
   - **Dice in text.** Text descriptions, Trigger and Response, rider text, Miss text, custom Success text, the multiattack's extra text and a custom lair intro can hold clickable dice and D&D Beyond tooltips:
     - `{1d4}` gives a plain roll showing "1d4", e.g. "for {1d4} rounds".
     - `{dmg 3d6 Fire}` gives "10 (3d6)" that rolls Fire damage. Type the words "Fire damage" after it yourself. The damage type is optional.
     - `{heal 2d8+4}` gives "13 (2d8 + 4)" that rolls healing.
     - `{+5}` gives a "+5" that rolls 1d20+5 to hit.
     - D&D Beyond tooltips, for the name in braces:
       - `{condition Prone}` gives `[condition]Prone[/condition]`.
       - `{skill Perception}` gives `[skill]Perception[/skill]`.
       - `{spell Fireball}` gives `[spell]Fireball[/spell]`. Anything in brackets after the name, like "(level 4 version)", stays outside the tag.
       - `{action Hide}` gives `[action]Hide[/action]`.
       - `{sense Darkvision}` gives `[sense]Darkvision[/sense]`.
       - Conditions and skills are checked against the 5e lists and get their proper capitals, so `{skill sleight of hand}` gives "Sleight of Hand". An unknown condition or skill gets a warning, like an unknown damage type. Actions, senses and spells are pasted as you typed them.
     - `\{` types a plain brace. Anything in braces that the app can't read is pasted as you typed it, and a warning appears on the card.
   - **Usage** adds a clickable *(Recharge 5-6)* that rolls a d6, *(3/Day)*, *(Costs 2 Actions)* for legendary actions, or your own tag after the name.
3. **Multiattack.** Tick it, then set how many times each attack is used. Only attacks in the Actions section can be picked.
4. **Legendary Actions.** Once the section has an action, set the number of uses and the uses in its lair (0 if it has no lair). The intro paragraph uses the monster's **Wording**. Monsters saved before the Wording setting existed keep the wording their legendary intro had.
5. **Lair Actions.** The Lair tab matches D&D Beyond's **Lair and Lair Actions** box. Each lair action is a **Text** or **Saving Throw** entry, with dice in its text (the description, or a saving throw's rider and Success text). Leave the name empty to paste the entry as a plain paragraph, the way lair actions are usually written. Once the tab has an entry, the **Lair Actions intro** card sets the opening paragraph: "When fighting inside its lair, the dragon can take lair actions. On initiative count 20 (losing initiative ties), the dragon takes a lair action to cause one of the following effects; the dragon can’t use the same effect two rounds in a row:"
   - The intro always uses 2014 wording, because the 2024 rules have no lair actions. It names the monster with **Creature is called**.
   - Change the **Initiative count**, untick **Can’t use the same effect two rounds in a row**, or type a **Custom intro** to replace the whole paragraph.
6. **Copy.** D&D Beyond has a separate box for each section, so copy one section at a time. The preview on the right shows the current tab's box:
   - **Copy Actions** (or Copy Special Traits, …) copies that whole box.
   - Clicking an action in the preview, or its copy icon, copies just that action.
   - **Copy all sections** copies everything, with each section's title on its own line between them.
   - **Paste text** shows the exact text that will be pasted.
   - **\*\*Bold\*\* names** wraps each action name in `**…**` for places that use Markdown.
7. **Check what still needs pasting.** After you copy a box, its tab says **copied**. If you change anything that alters its text, the tab says **changed since copy**, and a note next to the Copy button names what changed. Opening and closing cards doesn't count.
8. **Check a roll.** Hover over or Tab to any underlined value in the preview to see exactly what D&D Beyond will roll: the dice, the kind of roll (and damage type), the average, the range and the roll's action name. A damage roll with no damage type is flagged.

When you paste into a rich text box (the D&D Beyond homebrew editor), action names come out **bold-italic**. Plain text boxes get plain text.

**Saving:** every change saves automatically, and the top bar shows when. If the browser refuses to save (storage full, or a private window), the top bar turns into a warning with an **Export** button, so export a file before closing the tab.

**Sharing:** Use **Export**, or the download icon next to a monster's name, to save a `.json` file. Someone else can load it with **Import**.

**Shortcuts:** `Ctrl+K` finds a monster. `Ctrl+N` makes a new monster. `Ctrl+Shift+C` copies everything.

## Developing

```bash
npm install
npm start        # run the app
npm test         # check the generated text against the Wyvern Rider example
npm run dist     # build dist/StatForge.exe
```

- All the statblock text comes from `src/format.js`.
- `src/library.js` holds the pure helpers behind the UI: output hashes for the copied tracker, folder grouping, search ranking.
- The UI is `src/index.html`, `src/styles.css` and `src/app.js` (plain JavaScript, no framework). The fonts are self-hosted in `src/fonts/` under the SIL Open Font License (see the `OFL-*.txt` files there).
- `PRODUCT.md` is the product brief.
- `main.js` and `preload.js` are the Electron shell.

The first `npm start` downloads Electron itself, because `npm install` no longer does. If it says Electron "failed to install correctly", delete `node_modules/electron`, run `npm install`, then run `npx install-electron --no`. If the download is blocked, unzip `%LOCALAPPDATA%\electron\Cache\…\electron-v*-win32-x64.zip` into `node_modules/electron/dist` and create `node_modules/electron/path.txt` containing `electron.exe`.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with Wizards of the Coast or D&D Beyond.
