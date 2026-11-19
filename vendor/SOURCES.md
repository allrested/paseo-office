# Vendored files

`my-office/` is the 3D office a browser draws. `scripts/build-world.mjs` builds it into one script,
embedded in `server/world.generated.ts`, which the plugin serves over `office.world.request`; the
client runs it in a frame only when the 3D view is shown. The script starts with my-office's
licence notice, read from `my-office/LICENSE` at build time, and keeps three.js's own notice, since
minifying drops every other comment. The 2D office (`client/pixel`) is the
plugin's own and takes nothing from here.

## my-office

- Source: https://github.com/khanh020905/my-office at `b68228871fe30cd2c759a2c919337a9a9d1f5644`
  (v0.6.0, 2026-11-14).
- Licence: MIT, Copyright (c) 2026 khanh020905 (`my-office/LICENSE`, upstream's file).
- With it: `three@0.160.0`, the version upstream pins, as `my-office/three/three.module.min.js`
  and the 15 add-ons the scene imports under `my-office/three/addons/`. MIT, Copyright © 2010-2023
  three.js authors (`my-office/three/LICENSE`).
- `my-office/MANIFEST.json` records the commit, the three.js version, the order upstream starts
  its modules in, and a sha256 for every copied file.

### What is taken

The scene: the floor plans, the furniture, the people and how they move, the labels over them,
the place cards, and the lounge's four games (pool, the TV matches, foosball, karaoke: `people/
billiards.js`, `gaming.js`, `foosball.js`, `karaoke.js`). Upstream's files are copied unchanged,
except that `'three'` and `'three/addons/...'` imports are rewritten to relative paths, so the
bundle needs no resolver, and that real brand names are swapped for made-up ones (below).

The import takes English, Vietnamese and Thai area files named by the scene’s English index
and generates a matching index for each. Vietnamese and Thai come from the same pinned commit,
including the Thai people submodules. The upstream Thai drawer omits
`drawer.sessionGone`, so that message uses the English fallback. Brand replacements preserve each area’s shared keys.

The port wrote `i18n/locales/id/` in upstream’s format for all the same areas. Its `ours.js`
contains the port-specific lines. The locale tests check keys, order, plural forms, slots,
markup, emoji and list lengths. The translator recorded lines for native-speaker review in
`scripts/id-review-notes.json`. Run `node scripts/id-review-list.mjs` for English and Indonesian
side by side.

The first-person walk is taken too: Walk in, at the camera bar's end, walks the floor as your own
character, and a game can be played from there. The games call the group chat and the sounds. The
chat's window is not taken: its stand-in exports what the games import and does nothing. The sounds are upstream's,
off until the Sound switch is on, so a game and a karaoke song are heard then.

The first-visit tour is taken too (`ui/tips.js`, with its words in each shipped locale’s `tips.js`). It
shows only where Walk in does (a fine pointer; `state.isLocal` is set from it in
`ui/camera-bar.js`), once per device (`office-tips`), and its person card's words are Paseo's
(`OURS` in `i18n/index.js`). Its cards' styles are in `paseo-style.js`.

So is the 15-second clip, from photo mode's bar (`ui/timelapse.js`, `ui/clip-music.js`). It is
offered on a desktop or in a browser only (a recorder, a capturable canvas, a fine pointer, and
`host.photo`); its markup and styles are in `ui/camera-bar.js`. Its music is made in the page and
goes into the recording, never to the speakers.

The seasonal decorations and animated centrepieces come from `life/seasons.js`; the umbrella stand and entrance rain props come from `life/rain.js`.

The following copied files include changes marked with `// PASEO:`.

- `src/office/audio/sfx.js`: the one tune that stands for a real brand's is cut (its sound and its
  gap); the engine and every other sound are upstream's.
- `src/office/core/env.js`: the build flag upstream reads from `process.env` is a constant, and
  the floor plan comes from Paseo, not from the page's address and storage.
- `src/office/interact/first-person.js`: E at the lift enters the enabled street. E on a person passes `opts.open` to the session drawer, and `floorBounds` is
  exported for the camera bar.
- `src/office/interact/place-cards.js`: the lounge's card has a cup for its icon, not a sparkle,
  and the launch pad's card lists no repositories (a team is a workspace, and Paseo sends no
  repository state).
- `src/office/life/weather.js` draws rain, storm flashes, fog and light. The host supplies readings through `setWeather`. The upstream city list, storage, chips, timer and Open-Meteo fetch are removed. `wx.city` stays empty.
- `src/office/life/tests.js`: `clearRun` puts out the lamp of a test run whose end Paseo never
  learns.
- `src/office/ui/photo.js`: the mark painted into a photo is the host's brand name (Paseo's when
  there is none), the file is named `office-YYYY-MM-DD-HHMM.png`, and a host with `photo` false
  has no Photo mode (the button is hidden and `enterPhoto` returns), and leaving photo mode calls
  `setTimeMode('auto')`, so Day and Night, held for the photo, go back to the app's theme, the
  Music button is synced with the Sound setting as the bar opens, and Escape and P do nothing
  while a clip is made.
- `src/office/ui/tips.js`: the bell card is dropped (a click on the bell in Paseo also has the
  stand-up notes written), and a card's look calls `setView(null)`, so Overview is not shown
  pressed and a resize does not refit under the card.
- `src/office/ui/timelapse.js`: the clip's file is named `office-clip-...`.
- `src/office/ui/clip-music.js`: `musicTrack` returns null while `sfx.on` is false, so the music,
  and the audio context that carries it into the recording, exist only while the Sound setting is
  on.

- `src/office/people/farewell.js` and `interns.js` read the host’s tenure list and report ceremonies through its callback.
- `src/office/people/duty.js`: while the host gives its duty board (`host.duties`, from `setDuties`), the day's duties and
  who has each are the host's. The scene keeps no rota, assigns nobody and posts no grumble, so an owed duty gets no apology either. HR posts the host's list in
  the morning. A free person acts out a pretend duty, chosen by `paseo-duty-plan.js`, and `host.dutyDone` tells Paseo.
  An agent's duty is acted out once by its holder. A duty with no chore of its own has its person walk to the board and
  back. The tooltip is the host's list with short names. The cups in the sink are still counted here. Without host
  duties it is upstream's rota.
- `src/office/world/props/duty-board.js`: a row may carry the duty's own `label`, no chore marker, and `owed` in red.
  More than five rows share the board's height, a host row's tick has no time, `none` is said with no row, and
  `BOARD_AT` is exported for the walk.
- `src/office/people/staff.js` uses a plain parcel mark on the courier’s carton.

### Made-up names

my-office's text and comments name real shops, apps and products: the convenience stores and
cafés people pop out to, ride and delivery apps, a bank, medicines, a film studio's look. This
plugin is public and ships no real brand's name, so `scripts/genericise-street.mjs` swaps each
for a made-up one through one table, `scripts/street-brands.mjs` (the one list of the real
names). It renames the keys upstream uses for them too (they become `frosty`, `ridely`, the
look `cartoon`...), and their camelCase compounds (`frostyAsk`), in every file, so a key stays
the same across files. In code a name becomes something that still parses: a quoted key or
property (`x['Pebble Mart']`) or an identifier (`NAVY_COFFEE_HOUSE`), the same in every file. It
works on every `.js` under `my-office/src/` and `../shared/upstream/`, and puts
`// PASEO: names ...` on the first line of each file it changes. A file is clean exactly when
the swap would change nothing in it. It changed these, and nothing else in them:

- `../shared/upstream/chat.js`
- Under `src/i18n/locales/en/` and `vi/`: `fp.js`, `people.js`, `settings.js`, `ui.js`, `world.js`
- Under `src/i18n/locales/th/`: the same files, with `people-a.js` and `people-b.js` holding the dialogue
- `src/office/people/chibi-rig.js`, `src/office/people/look.js`
- `src/office/world/props/tv-games.js`
- `src/office/interact/first-person.js`, which is also changed by hand (above)
- `src/office/audio/sfx.js`, which is also changed by hand (above)
- `src/office/ui/timelapse.js`, which is also changed by hand (above)

Vietnamese and Thai use the same replacements during import. Run
`node scripts/replace-locale-brands.mjs --check` to scan the dictionaries.

The import tool runs the same swap on what it copies: a file whose only note is the names one is
written as upstream's with the names swapped, so it is compared and updated like an unchanged
copy, and `MANIFEST.json` keeps upstream's sha256. `npm run test:scripts` runs the script's
`--check` over the tree, and `server/world-script.test.ts` checks the bundle.

One file is taken trimmed. Its path stays in the import tool's `DENY`, so it never writes it
and only checks that it exports what the kept modules import (which is why `MANIFEST.json` lists
it under `standIns`). Each cut or change starts with `// PASEO:`. `paseo-entry.js` runs its
`setup` where upstream's start-up order has it, just before the loop.

- `src/office/life/incidents.js`: upstream's alarm, `startIncident`, `updateIncident` and `setup`:
  a red light over the floor and a red stage for 25 s, a fail bubble over each person at work, and
  the siren. Under reduced motion the light holds a steady red. Cut: `fails` and the branch that
  rang for three failures in five minutes (an incident is one the office found in Jira or Sentry,
  and the entry's `setIncidents` rings it); `headache()` (the errand for headache pills); `onEvent`
  (its part that moves people stands in `paseo-entry.js`); and the banner, which is the entry's
  and shows while an incident is open, not only for the 25 s.

The importer takes the team chat engine (`src/shared/chat-engine.js`), the local prompt coach
(`src/shared/prompt-coach.js`) and English chat strings (`src/i18n/locales/en/chat.js`) into
`shared/upstream/`. It records their upstream hashes under `chat` in `MANIFEST.json`. The plugin
compiler can bundle modules from this directory on web, native and server. Adjacent `.d.ts`
files describe what the plugin uses. `server/chat-service.ts` runs the chat engine with
`shared/chat-words.ts` for translations. The composer calls the coach directly on the current
draft to suggest clearer directions before sending. The scene bundle loads separately.

The Headquarters wing (`src/office/world/pro/wing.js`) is imported from upstream. Its room plaques follow desk assignment. The camera uses the walk bounds for all three plans.

### What is not taken

Upstream's own interface (panels, the session drawer, the chat, settings, the top bar), its server
connection, replay and the demo. Paseo supplies the fullscreen session rail and workspace and hosts the team messenger around upstream’s chat engine. Of the camera toolbar and photo mode, the list
button is left out on purpose.

The kept modules still import those files, so each has a stand-in at the same path that starts
with `// PASEO: stand-in`. Most export what is asked of them and do nothing. These do work:

| Stand-in                    | What it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `i18n/index.js`             | Reads the selected dictionary at scene start, falls back to English, removes decorative emoji and applies the port’s own wording |
| `ui/session-drawer.js`      | A chosen person is told to Paseo, which opens its agent card           |
| `ui/whiteboard.js`          | Draws Paseo's rows on the board; picks people and furniture            |
| `ui/camera-bar.js`          | Builds upstream's toolbar and photo mode's bar; Overview is the floor fitted to the frame, the other three views are upstream's places for the floor plan in use; zoom and full screen, the Sound button, and Walk in with its overlay; the automatic camera: upstream's `autoCam` and `panTo`, copied, with a glide ending when anything else takes the camera; `state.isLocal` for the tour |
| `ui/settings.js`            | `setTimeMode`: Auto is the app's theme, Day and Night are held for a photo or a clip (`world/backdrops/index.js` `holdNight`); `syncTimeBtns` marks photo mode's buttons; `togglePop` does nothing |
| `ui/mac-drawer.js`          | Holds the host's readings Paseo sets; opens Paseo's panel when it has one |
| `ui/activity.js`            | Passes the scene's toasts to Paseo; where Paseo gives none, `paseo-entry.js` shows them in a note over the floor |
| `world/backdrops/index.js`  | Builds the selected Plain, City, Countryside, or Beach backdrop and its day and night window views. Photo mode can hold either lighting setting. |

A click on the pantry's duty board opens Paseo's duty board (`onDuties`) once the host has given its duties, and is upstream's note before that; its tooltip stays the scene's. The entry makes the wall clock inert: its click changes nothing and its tooltip says the lights
follow the app's theme (`paseo.clock.hint` in `OURS`). A person already in the office whose status
becomes `wait` glides the camera to them (upstream's `ui/permissions.js` `onPerm`, in
`paseo-entry.js`).

Paseo's own files sit beside upstream's and are named for it: `paseo-entry.js` (the bundle's
entry: builds the page, starts the modules in upstream's order, sets `PaseoOfficeWorld`, and shows
the scene's toasts in a note of its own over the floor where the host gives no `onToast`),
`paseo-host.js` (what the stand-ins read and call), `paseo-sound.js` (the Sound switch's state, and
the probe that finds out whether the page lets audio start: it runs on a real activating press only,
never on Escape or a bare modifier key or while the frame has no active user activation; 'blocked'
is tried again on the next press, 'ready' and 'unsupported' are final), `paseo-style.js` (the page's
stylesheet, in Paseo's design language, the tour's cards included), `paseo-modules.js` (generated: the kept modules in start-up order),
`paseo-duty-plan.js` (the host's duty board: the pantry board's rows, its tooltip, and who acts out which duty next;
no scene in it, so `client/world/duty-plan.test.ts` runs it), `paseo-sign.js` (the picture on the lobby's sign and the reception's plaque, with the host's
brand; the entry puts it on the material upstream's floor made), and the lively floor:
`paseo-leisure-plan.js` (who gets up from a rest, when and for what; no scene in it, so
`client/world/leisure.test.ts` runs it) and `paseo-leisure.js` (which moves the people with
upstream's own moves and starts upstream's games through their starters). The marker update in `ui/activity.js` runs it every frame, yielding during the midday nap.

The library's place card is not shown: `paseo-entry.js` gives the place an `open`, so its chip
and the bookshelf open Paseo's Library card.

Of the team chat, only the engine and its words are taken, into `shared/upstream/`. Its window
(`ui/group-chat*.js`; the games' `ui/group-chat.js` stays a stand-in), its CI, loop and denied
cards, voice, push notifications and prompt rewriting are not. All seven staff have names. The scene sends moments through `ui/group-chat.js` and the server chooses words and reactions using `shared/life-lines.ts`. Game chat and chat photos stay local.

### What the scene is told

Paseo sends the scene who is there and what kind of thing each person does (`client/world/
world-api.ts`), never a file name, a command or a prompt. It sends each agent’s reported spending and, through `office.life`, the repository birthdays, team tenure and lift servicing. It sends the day's duties (`setDuties`): each one's name, chore, holder and state, never its instructions. It also sends the weather mode or reading and the open incidents' keys
and titles for the banner. A translated scene receives its language and dictionary. The scene runs in upstream's streamer mode, which writes "a file" and
"a command" where upstream would write the name, and the entry keeps the feed and the counts
upstream's server would keep, from the moment the office opens.

The scene writes office state to the app origin's `localStorage`, under keys that start with
`office-`: which team sits where, the plants, the graphics level, the Sound switch
(`office-sound`, which the host's setting overwrites at each start), that the tour was seen
(`office-tips`), and the clip's shape and music choice (`office-clip-shape`, `office-clip-music`).
It also records the cups in the pantry's sink (`office-duty`, which holds upstream's duty rota only where the host gives no duties), the fire drill’s day (`office-drill-day`), team farewells (`office-gone`) and returns (`office-back:*`). It reads `office-autocam` (`off` turns the automatic camera off) and a few more `office-` keys
that nothing here writes. It makes no network call; a clip is recorded in the page and saved as a
download.

### Taking a newer upstream

```
git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office
npm install --prefix /tmp/ref-office/three three@<the version in upstream's package.json>
node vendor/my-office/import-upstream.mjs \
  --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

`--check` writes nothing and lists what would change. Without it the tool copies the files,
regenerates `paseo-modules.js`, the English, Vietnamese and Thai locale indexes and `MANIFEST.json`, and reports:

- files it kept because they carry a `PASEO:` note: compare each with upstream by hand;
- stand-ins that lack an export a kept module now imports: add it.

Compare upstream’s `src/i18n/index.js` with the stand-in for new exports or value shapes.
Then run `node scripts/genericise-street.mjs`: the tool swaps the names it copies, but a kept
file you merged by hand needs the script. The script knows only the table's names: read the new
text upstream brings for a shop, an app or a product the table lacks, add it to
`scripts/street-brands.mjs` with a made-up name, and run the script again. Then run
`npm run build:world`, then `npm test`, and look at the office in a browser: a module
upstream added to its start-up list may need a stand-in or a place in `DENY`.

### Street assets and source changes

The city, its population, staff outings, countryside and beach come from the pinned checkout. The alternate landscapes use upstream's `countryside.js`, `beach.js` and `shared.js`. The importer skips the eight chain-specific shop modules and every logo image. Shops use generic fittings and signs drawn in `world/backdrops/paseo-signs.js`. The ATM uses a plain square. Street audio waits for the street and sound switches. The optional Kenney Car Kit (CC0) is recorded in the manifest. The server sends it separately through `office.world.street`.

After an upstream update run the importer, run `node scripts/genericise-street.mjs --check`, review changes in the hand-edited shops, ATM, traffic, audio and outings modules, and rebuild both generated files with `npm run build:world`.
