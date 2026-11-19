# What was seen on a stock daemon

The plugin was installed by Git, from a local clone of this repository, on an unmodified Paseo
0.16.2 (the published `@getpaseo/server` and `@getpaseo/cli`) on 2026-11-19. The daemon ran on a
throwaway home with plugins turned on and the web UI enabled, with no agents, no provider sign-in
and no tracker tokens. The page was opened with a browser, at 1280 and at 390 px wide.

The first look was at this repository before its last fixes, which moved the floor's note and
changed comments, docs and the stand-up notes' prompt. A second look, at the tree this document is
in, was of the 3D view's note only. It is not repeated on each change.

A third look, on 2026-11-19, was of the session tabs and the New agent form (see "Session tabs and
the New agent form"). It used the same stock 0.16.2, with a folder under `/tmp` opened as a
workspace, and was installed from the directory, not by Git: see that section.

A fourth look, on 2026-11-19, was of the view switch's save and the made-up names (see "The view
switch and the made-up names"). It was installed by Git, with three agents of the stock Mock
provider in a workspace.

A fifth look, on 2026-11-19, was of the sounds (see "Sound"). It was installed by Git, with three
agents of the Mock provider in a workspace. A sixth, the same day, was a second look at the sounds
after the fixes the fifth one led to, and a seventh a third look, after the two fixes the sixth led
to.

An eighth look, on 2026-11-19, was of the floor plans (see "The floor plans"). It was installed by
Git, with twelve agents of the Mock provider in a workspace.

## Install

`paseo plugin install file://<path to the clone>` cloned the repository, compiled the plugin and
started it in about three seconds. The clone holds the committed files only: there is no
`node_modules` and no `build` step. `paseo plugin ls` showed the plugin as `running` with the
commit it was installed from. `paseo plugin logs office` held `Loading plugin` and `Plugin ready`,
and no error.

## Seen at 1280 px

- Settings, Plugins lists "Office 3D" with its description. Its icon is a letter, in the Plugins list
  and on the plugin's own page: Paseo's app takes a tile's icon from the plugin's listing in
  Paseo's plugin registry, never from an installed plugin's manifest, so a plugin installed by Git
  shows a letter.
- The plugin's page opens from that row and has the settings: Wake agents, Agent tools, the notes
  folder, the time zone and the Jira and Sentry fields. The 3D, 2D and List switch is on it.
- The Office 3D item is in the sidebar and opens the office.
- The 3D floor draws, with the Director's room and the Stand-up notes board.
- The 2D floor and the List show. The List has the Lobby with its board.
- The column's four tabs open: Attention (one card, the host's memory), Sessions, Activity and
  Chat.
- The gear over the floor opens the plugin's settings page.
- A to-do posted on the Lobby board shows in the List and is stored in `office/boards.json` under
  the home. A chat message shows in the Chat tab and is stored in `office/chat.json`.
- A notes folder and a time zone were saved and cleared again. The plugin's log and the daemon's
  held no error about a schedule. No note was written: there was no stand-up to write.

## Seen at 390 px

- The List shows with the bar under it, and a tab in the bar opens a sheet over the floor. The
  Chat sheet opened with the stored message.
- The 3D floor draws at that width.

## The empty floor's note

The first look found the "No agents on this host yet" note over the 3D view's camera bar at the
bottom of the floor: part of the bar at 1280 px and nearly all of it at 390 px. Only the 3D view has
that note. It now sits at the top left of the floor, under the view switch's corner. The second look
saw it there at both widths, with an empty floor, 8 px below the corner and clear of it; at 390 px
it spans the floor's width. The camera bar showed whole at both widths.

## Session tabs and the New agent form

The third look was at the branch that adds session tabs, at 1280 and at 390 px, on a daemon with
no agents. Two things differed from the first look.

- Install by Git failed. `paseo plugin install git:file://<clone>` stopped at the build with
  `Could not resolve type dependency "@getpaseo/client"` for `client/new-agent-model.ts`: that file
  and `client/use-new-agent.ts` import types from `@getpaseo/client`, and a plugin installed by Git
  has no `node_modules` for the build to find them in (type imports from `@getpaseo/plugin` and
  `@getpaseo/protocol` do resolve). The plugin was installed from the directory instead, where the
  repository's own `node_modules` supplies them, and it started in about three seconds with
  `Loading plugin` and `Plugin ready` in its log. Installed by Git, the branch did not run. Those
  types are now read off the SDK the host supplies, and the fourth look installed by Git.
- The daemon had Claude, Codex and OpenCode installed but not signed in, and Paseo lists them as
  available. The form showed all three with their models, so "no provider" was seen on a second
  run with the three turned off in the daemon's config.

Seen at 1280 px:

- The column with no session open has its four tabs, Attention (2), Sessions, Activity and Chat,
  and Sessions opens first with the New agent button, the All, Needs you, Working and Resting
  filters, the search box and "No agents yet."
- New agent opens the form in the column with a Back button, the workspace list (the scratch folder
  as "Acme shop", with its path), the provider buttons, the model buttons, the First prompt box and
  Create. While it loads the column says "Loading...".
- Text typed into First prompt, and the chosen workspace, were still there after a switch to Chat
  and back to Sessions.
- The column dragged to its 280 px minimum keeps the four tabs whole (they take 212 of its width),
  the form's boxes narrow with it, and nothing overlaps the floor's switch, its gear or the camera
  bar. The tab row had nothing to scroll: it only scrolls once session tabs are added to it.
- With no provider available the form says "No provider is available." under Back, and does not
  fail.
- Settings, Plugins lists the plugin as "Office 3D"; the sidebar item and the title over the floor
  say the same.

Seen at 390 px:

- The floor draws with the view switch, the note and the camera bar clear of each other, and the
  bar of four tab icons under it.
- The Sessions icon opens a sheet over the floor with the list and New agent, and Back opens the
  form. The typed text was still in the form after the sheet was closed with its X, after
  reopening it, and after the window changed width. The floor was whole after the sheet was
  dismissed.
- With no provider the sheet says "No provider is available."

The browser console held no error from the plugin. It held Paseo's own `useNativeDriver` warning,
and one connection error when the daemon was restarted for the no-provider run.

## The view switch and the made-up names

The fourth look was on 2026-11-19 at commit tree `cf346d9d13159430f0f9e9df59bd7fe6ea8f8925`,
installed by Git (`git:file://<clone>` at the commit) on the same stock 0.16.2. `paseo plugin ls`
showed it `running`, from git, at that commit, and its log held `Loading plugin` and
`Plugin ready`, about two seconds apart, and no error. A scratch folder was opened as the workspace
"Acme shop", and three agents of Paseo's Mock provider were started in it: Acme checkout
(working), Acme search (resting) and Acme billing (waiting on a plan approval). The mock runs no
process and no model.

The page was opened with fresh storage at each width: the device setting was not set beforehand.
The view switch over the floor was pressed in the order List, 2D, 3D, and the page's
localStorage key `@paseo:plugin-device-settings:office/office-device` was read before the first
press and a few seconds after each. It read the same at both widths:

| When       | The key's value                                                            |
| ---------- | -------------------------------------------------------------------------- |
| Before     | none                                                                       |
| After List | `{"version":2,"values":{"threeD":false,"view":"list","rungIncidents":{}}}` |
| After 2D   | `{"version":2,"values":{"threeD":true,"view":"2d","rungIncidents":{}}}`    |
| After 3D   | `{"version":2,"values":{"threeD":true,"view":"3d","rungIncidents":{}}}`    |

"Unable to save the view on this device" did not show after any press, at either width.

Seen at 1280 px:

- The 3D floor draws, with the Director, the Stand-up notes label, the team chip "Team Acme shop ·
  3", and name tags for Acme checkout and Acme billing, the second under a "Needs approval" bubble.
  Acme search, resting, has no name tag on the 3D floor: the scene shows the tag of a resting
  person only while it walks, is hovered or is chosen. The floor's text counts it as "Dining room 1
  resting".
- List shows the Lobby (no agents, no to-dos) and the Acme shop card with the three agents: Acme
  checkout running, Acme search at 0%, Acme billing with "Needs permission" and its plan.
- 2D shows the three desks labelled Acme checkout, Acme search and Acme billing, a question mark
  over Acme billing's.
- 3D after the switch draws the floor again with the same tags.
- The column's Sessions tab lists the three agents under the filters All 3, Needs you 1,
  Working 1 and Resting 1. Attention holds Acme billing's request and the Host, Janitor, Stand-up
  and Library cards. Activity shows Acme checkout's commands and searches. Chat shows the group's
  empty-state line and the box with Send.
- The plugin's settings page shows the switch on 3D, the setting a press over the floor saved.

Seen at 390 px:

- The 3D floor draws with the same tags and the bar of four tab icons under it. In the first
  screenshot Acme checkout's tag covered the lower half of the Stand-up notes label; after the
  switch back to 3D the two were clear of each other.
- List shows the filters, the Lobby and the Acme shop card with the three agents; 2D shows the
  three labelled desks.

The names: the text a person can read at 1280 px was gathered into one string, about 3000
characters: the scene frame's text (room names, chips, tags, the bubble), the page's text with the
List open, then with each of the Attention, Sessions, Activity and Chat tabs open, and the
plugin's settings page. The repository's `leftIn` (in `scripts/genericise-street.mjs`) returned an
empty list for it, and for each part alone. The same call on a text holding two names from
`scripts/street-brands.mjs` returned them. The page's text includes Paseo's own sidebar and
settings menu; it does not include what is typed in a field.

The browser console held no error or warning from the plugin at either width, and no Paseo error.
It held Paseo's `useNativeDriver` warning and the frame's "GPU stall due to ReadPixels" notes,
which come from the screenshots.

## Sound

Sound was looked at three times. The first look was at commit
`d98d46a19a055f43c38689b672a3cb851d0725bf`, then at `8d6399e`, which brought the toolbar's buttons
closer at 520 px and narrower. It found five things, which were fixed. The second look was at
`7d11e772cb3a0488f7bd9d67738107f330e4a985`, with those fixes, and found two more. The third, at
`16b3757e`, was of those two only, at 1280 px. Each was installed by Git on the same stock 0.16.2.
`paseo plugin ls` showed each `running`, from git, at its commit, and the log held `Loading plugin`
and `Plugin ready`, about three seconds apart, and no error. A scratch folder was the workspace
"Acme shop", with three Mock agents. The browser console held no error or warning from the plugin,
at either width, in any look.

The browser has no sound card anyone can hear, so "audible" was not checked. What was checked is
that the scene makes and starts Web Audio nodes while Sound is on and not while it is off: before
the page loaded, a script in every frame wrapped `AudioContext` and its `createOscillator`,
`createBufferSource` and `start` with counters. In this browser a context made without a press
runs at once: its autoplay rule is the loosest one, so "audio starts only inside a press" could not
be told apart from "audio starts" here. The rule could not be made stricter (the browser starts
with the kit's own flags). Frames that refuse audio were made with scripts instead: one with no
`AudioContext` or `webkitAudioContext`, and one whose probe's first context (or first two) reports
"suspended" and never resumes.

The device's setting was read, after each press, from the page's localStorage key
`@paseo:plugin-device-settings:office/office-device`. In the first look the page was opened with
fresh storage, so the key was absent until the first press.

| After                                | The key's value                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| The toolbar's button, on             | `{"version":2,"values":{"threeD":true,"rungIncidents":{},"sound":true}}`              |
| The toolbar's button, off            | `{"version":2,"values":{"threeD":true,"rungIncidents":{},"sound":false}}`             |
| The settings page's switch, on       | `{"version":2,"values":{"threeD":true,"rungIncidents":{},"sound":true}}`              |
| With Sound on, the view switch on 2D | `{"version":2,"values":{"threeD":true,"view":"2d","rungIncidents":{},"sound":true}}`  |
| Then on 3D                           | `{"version":2,"values":{"threeD":true,"view":"3d","rungIncidents":{},"sound":true}}`  |
| Then the settings page's switch, off | `{"version":2,"values":{"threeD":true,"view":"3d","rungIncidents":{},"sound":false}}` |

The same values were read at 390 px after each tap on the toolbar's button and on the settings
page's switch.

### The first look

Seen at 1280 px:

- Settings > Plugins > Office 3D has "Sound" after the 3D, 2D and List switch, on the same row as
  Wake agents and Agent tools, off. Turned on, it read on after a reload of the page.
- The 3D floor's toolbar has the speaker button after Photo mode: a speaker crossed out, with the
  tooltip "Sound". Pressed, the speaker gets two waves and the button takes the accent colour on a
  dark ground; pressed again it is crossed out.
- A floor lamp was found with the scene's own hover tooltip ("Floor lamp") and pressed. With Sound
  off the press made the probe's context (made and closed) and the engine's context, and no
  oscillator. With Sound on the next press on the lamp made one oscillator and started it, and a
  third context: karaoke's own, which it makes on a press while Sound is on. Ten seconds later no
  other node had been made. With Sound off again, a press on the lamp and ten more seconds made no
  node.
- With Sound on in the setting and the page then loaded, the button showed on, and the engine's
  context existed before any press (made when the scene was told Sound is on); the first press,
  on the lamp, made and started an oscillator.
- A second tab held the settings page while the toolbar's button was pressed in the first. The
  second tab's switch did not follow, after 8 and after about 30 seconds; after a reload of that tab
  it showed the stored value. The settings page opened in the same tab after the press showed it.
- With no Web Audio, the button was dimmed and crossed out, its label and tooltip "Sound is not
  available here". Escape and Shift made no probe in a frame that refuses audio.

Seen at 390 px (touch, a coarse pointer, as a phone): the toolbar holds Overview, Desks, Meeting
room, Servers, the zoom, Full screen, Photo mode and the speaker button; Walk in is shown for a
fine pointer only. A tap on the button turned it on and stored `sound: true`; a tap turned it off.
The settings page wraps the 3D, 2D and List switch and Sound onto a row under Wake agents and Agent
tools; the Sound switch is 96 by 44 px.

What the first look found, each fixed before the second: the dimmed button also dimmed its tooltip;
the button's "not available" line was never shown, because the client gives the scene no
`onToast`; after a refused probe was followed by one that ran, the button showed off though the
setting was on; a press on the button while audio was held off was answered "not available" even
when its own probe started audio; and with a mouse at 390 px Walk in ran past the frame's right
edge.

### The second look

The second look used the same counters and the same refusing frames, with the stored setting
written before the page loaded where a case needs it on or off.

- The setting kept through a block (1280 px): with Sound stored on and the first probe made to
  fail, a press on the floor made the button dimmed with "Sound is not available here". A second
  press on the floor, whose probe ran, made the button show on by itself, with no press on it; a
  press on a floor lamp then made one oscillator and started it. The stored document said
  `sound: true` throughout: the probes did not write it.
- A press on the button while audio is held off (1280 px): with Sound stored off and the first
  probe made to fail, a press near the button's edge, whose own probe ran, turned sound on, stored
  `sound: true`, and showed no "not available" note. With the first two probes made to fail, a
  press on the button left it dimmed and, about 1.9 s later, showed the note "This app does not let
  the office play sound."; the stored value stayed off. A press in the middle of the button, on the
  speaker icon, did not do what the edge did: see "Found in the second look".
- The scene's note (1280 and 390 px): with no Web Audio, a press on the button showed "This app
  does not let the office play sound." in a note over the toolbar, light text (13 px, weight 600)
  on the page's raised surface, 14 px above the toolbar and well under the view switch's corner. At
  1280 px it was 303 by 40 px; at 390 px (touch) 301 by 40 px, centred, 44 px from each side. It
  was there 3.0 s after the press and gone by 3.7 s (the time counted from when the press had been
  sent, which itself takes time in this browser), and a second press replaced it with one note.
  For the 390 px screenshot the note's timer was held by a script, since a screenshot there takes
  longer than four seconds.
- A refused save (390 px, mouse): a script made the page's `localStorage.setItem` throw a quota
  error for the device setting's key. A press on the floor's Sound button turned it on and the
  view corner showed, under the 3D, 2D and List switch, "Unable to save the Sound setting on this
  device. It holds until this screen is closed." The settings page's Sound switch showed the same
  line under its switches after a tap, and the switch held on. Nothing was stored.
- The toolbar with a mouse at 390 px: the look's browser at 390 px has a touch screen, and turning
  its touch emulation off did not make it report a fine pointer, so a script made the scene's own
  `(pointer: fine)` question answer yes; the scene then showed Walk in itself. The bar's sizes do
  not depend on the pointer. Measured in CSS pixels against the 390 px frame: the bar from 5 to 385
  (380 wide), its content 378 wide with nothing to scroll, the buttons 28 px wide (Walk in 38),
  and the last, Walk in, from 340 to 378: 7 px inside the bar's right edge and 12 px inside the
  frame's. A view button under the pointer changed none of it. Only 390 px was measured, not 320.
- The unavailable button's tooltip (1280 px): its icon at 0.45 opacity, the button and its tooltip
  at full strength, as Photo mode's tooltip.

#### Found in the second look

The first two were fixed and looked at again: see "The third look". The third stands.

- A mouse press on the speaker icon in the middle of the Sound button is lost when that press's
  probe ends: the probe redraws the icon between the press and the click, and the browser then
  sends no click. Seen twice. At 390 px with a mouse, the first press on the button in a fresh page
  (no probe yet) gave `pointerdown` and `pointerup` on the icon and no `click`: Sound stayed off and
  nothing was saved; the second press worked. At 1280 px, with audio held off, a press on the icon
  whose probe ran left Sound off with no note, and the button usable; the same press 3 px inside
  the button's corner turned Sound on. A tap on a touch screen was not lost in either look.
- Space on the focused Sound button (1280 px), with Sound stored on and the first probe made to
  fail: Sound ended off, the button usable and crossed out, and the stored document said
  `sound: false`; no note showed. The key's probe ran, so the scene most likely turned sound on by
  itself first, and the click the key makes then asked for the opposite.
- With a mouse, the button's own tooltip ("Sound is not available here") stays while the pointer is
  on the button, and covers the lower right corner of the note.

### The third look

The third look was at 1280 px with a mouse and a keyboard, with the same counters and refusing
frames, and a script in the scene's frame that listed each `pointerdown`, `pointerup`, `click`,
`keydown` and `keyup` with the element it reached.

- The first press in a fresh page, on the middle of the Sound button (Sound stored off): the
  element under the pointer was the button, not its drawing, and the button got `pointerdown`,
  `pointerup` and `click`. The button showed on and the stored document said `sound: true`.
- A press on the middle of the button while audio is held off (Sound stored off, the first probe
  made to fail, so the button was dimmed): the same three events reached the button, it showed on,
  the stored document said `sound: true`, and no note showed.
- Space on the focused button with Sound stored on and the first probe made to fail (the button
  dimmed, the stored document `sound: true`): after Space the button showed on and the stored
  document still said `sound: true`; no note showed. A second Space turned it off, and the stored
  document said `sound: false`.

Not looked at again in the third look: 390 px, a touch screen, Enter in place of Space, and the
tooltip over the note.

## The floor plans

The look was at commit `26165fc4c17ccc4f3e5cb0c746cc49725d6ca65a`, installed by Git on the same
stock 0.16.2. `paseo plugin ls` showed `office` `running`, from git, at that commit, and the log
held `Loading plugin` and `Plugin ready`, three seconds apart, and no error. The workspace "Acme
shop" had twelve Mock agents: working, resting and waiting on a plan approval. The browser console
held no error or warning from the plugin in any of the five runs, at either width.

- The setting (1280 and 390 px): the settings page has a row "Floor plan" with "Company floor" and
  "Cozy room", "Company floor" pressed at first, and under it "The 3D floor only: the 2D floor and
  the List are the same on both. Company floor has 12 desks, Cozy room 9. Changing it starts the 3D
  view again." A press on "Cozy room" showed it pressed 0.3 s later, with no "Unable to save" line,
  and the host's settings document then held `floorPlan: "cozy"` at version 4. The buttons are 32
  px high with a mouse and 44 px on a touch screen; at 390 px the row and its hint fit the width.
- An open office follows a save (1280 px): with the office open on the company floor, the gear
  over the floor opened the settings, "Cozy room" was pressed, and the browser's Back returned to
  the office. Without a reload the page had a new frame "Office in 3D" in under 12 s, the only one,
  drawing the cozy room.
- The company floor (1280 and 390 px): drawn as in the earlier looks, with the director, the lobby
  and the "Stand-up notes" label, and no line about desks with twelve agents.
- The cozy room (1280 and 390 px): one open room, nine desks in three rows of three, a library
  wall, a coffee corner, the aquarium, the arcade, a round meeting table, the racks and the
  rocket. Its labels were "Library", "Window · web search", "Server room", "Launch pad",
  "Whiteboard", "Entrance", "Coffee corner" and "Meeting room": no director, no lobby, no
  "Stand-up notes". Over the floor the page said "3 agents have no desk on this floor. The list
  shows everyone."
- The cozy room's views (1280 and 390 px): Desks showed the nine desks at 175%, Meeting room the
  round table at 230%, Servers the racks and the rocket at 220%, and Overview the whole room at
  100%; each pressed button showed pressed, the others not.
- Walk in on the cozy room (1280 px): the button turned the walk on with its "Walking the office"
  line and Exit button; W moved the view forward toward the desks; Escape left it. Photo mode
  opened with its own bar and the toolbar gone, and Escape left it, at both widths.
- The plan switched back and forth (1280 and 390 px): on the settings page the two buttons were
  pressed in turn, seven presses, 2.5 s apart. Each showed pressed with no "Unable to save" line.
  While the settings page was up the page held no scene frame after the first change. Back on the
  office there was one frame, the company floor that was pressed last, and the stored value was
  `"pro"`.

Seen and left: on the cozy room at 1280 px with more than nine agents, the walk's "Walking the
office" line starts about 3 px above the bottom edge of the page's line about desks, so the two
touch.

## Not seen, and why

| What                                                                         | Why                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The phone app's 3D view on a change of floor plan                            | Only a browser was used. To check on a phone: "Loading", then the other plan, with no error, twice running                                              |
| Memory after several changes of floor plan                                   | The look's browser cannot report it                                                                                                                     |
| A cozy room's resting agents at the fish and the arcade, and going home      | Needs a day: rest from 08:00 to 21:00, and the walk home after 21:00                                                                                    |
| A floor plan saved on one device seen on another                             | One browser was used. The setting is the host's, so another device reads it when its office opens                                                       |
| The card for an agent                                                        | The fourth look had Mock agents at desks; no card was opened                                                                                            |
| A resting agent's tag on the 3D floor                                        | Shown only while it walks, is hovered or chosen; none of these done                                                                                     |
| The view choice kept across a reload                                         | The fourth look read the key after each press, not after a reload                                                                                       |
| The names in text read at 390 px                                             | The text was gathered at 1280 px only                                                                                                                   |
| The office's tools inside an agent's session                                 | No agent session. The page shows Agent tools on, nothing more                                                                                           |
| A stand-up run and the notes it writes                                       | The 8:00 run did not come due, and the bell was not pressed                                                                                             |
| An incidents check                                                           | Needs Jira or Sentry tokens on the host, and none were set                                                                                              |
| The gear at 390 px                                                           | A click on it timed out with the sheet open. It was not tried again                                                                                     |
| The phone app                                                                | Only a browser was used                                                                                                                                 |
| A session's tab, its conversation and a reply                                | No session was opened; the first three looks had no agent                                                                                               |
| A permission answered, and Stop on a session                                 | Not tried; the fourth look's waiting plan approval was left alone                                                                                       |
| An agent created from the form                                               | Create was not pressed: it would start a real provider session                                                                                          |
| The session tab row scrolling when it is full                                | Needs several session tabs, so agents                                                                                                                   |
| The agent card's Stop and the Host card close                                | 0.16.2 lacks `cancel()` and `closeRuntime()`; see the README                                                                                            |
| Sound heard at all, on the desktop app and a browser                         | No sound card here; the owner's to check on the host after the update                                                                                   |
| The phone's script frame and sound                                           | Whether the first tap starts audio, whether the button reads "not available", and whether an incident's siren is heard: the owner's, on the Android app |
| The second tap on a real touch screen                                        | Seen only with the browser's touch emulation; the owner's, on a phone                                                                                   |
| Karaoke singing at the lounge's TV with Sound on                             | Needs the walk (W A S D) to the TV; the owner's                                                                                                         |
| iOS and its ring switch                                                      | No iOS device; unknown                                                                                                                                  |
| An incident's siren with Sound on and off                                    | Needs Jira or Sentry tokens on the host, and none were set                                                                                              |
| Sound's note with reduced motion, in photo mode, and read by a screen reader | Not tried                                                                                                                                               |
| A refused full screen and my-office's game and karaoke lines in the note     | Not tried                                                                                                                                               |
