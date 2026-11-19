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
agents of the Mock provider in a workspace, and it found one fix, which was installed and looked at
again.

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

The fifth look was at the branch that adds the sounds: first at commit
`d98d46a19a055f43c38689b672a3cb851d0725bf`, then at `8d6399e`, which brings the toolbar's buttons
closer at 520 px and narrower (see "The toolbar at 390 px"). Both were installed by Git on the
same stock 0.16.2; `paseo plugin ls` showed each `running`, from git, at its commit, and the log
held `Loading plugin` and `Plugin ready`, about three seconds apart, and no error. A scratch folder
was the workspace "Acme shop", with the three Mock agents of the fourth look.

The browser has no sound card anyone can hear, so "audible" was not checked. What was checked is
that the scene makes and starts Web Audio nodes while Sound is on and not while it is off: before
the page loaded, a script in every frame wrapped `AudioContext` and its `createOscillator`,
`createBufferSource` and `start` with counters. In this browser a context made without a press
runs at once: its autoplay rule is the loosest one, so "audio starts only inside a press" could not
be told apart from "audio starts" here.

The device's setting was read, after each press, from the page's localStorage key
`@paseo:plugin-device-settings:office/office-device`. The page was opened with fresh storage, so
the key was absent until the first press.

| After                                | The key's value                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| The toolbar's button, on             | `{"version":2,"values":{"threeD":true,"rungIncidents":{},"sound":true}}`              |
| The toolbar's button, off            | `{"version":2,"values":{"threeD":true,"rungIncidents":{},"sound":false}}`             |
| The settings page's switch, on       | `{"version":2,"values":{"threeD":true,"rungIncidents":{},"sound":true}}`              |
| With Sound on, the view switch on 2D | `{"version":2,"values":{"threeD":true,"view":"2d","rungIncidents":{},"sound":true}}`  |
| Then on 3D                           | `{"version":2,"values":{"threeD":true,"view":"3d","rungIncidents":{},"sound":true}}`  |
| Then the settings page's switch, off | `{"version":2,"values":{"threeD":true,"view":"3d","rungIncidents":{},"sound":false}}` |

The same values were read at 390 px after each tap on the toolbar's button and on the settings
page's switch. "Unable to save" did not show.

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
- With no Web Audio in the frame (`AudioContext` and `webkitAudioContext` removed by a script before
  the scene started), the button was dimmed and crossed out, its label and tooltip "Sound is not
  available here", and a press on it changed nothing: no stored value, and no toast. The button's
  toast ("This app does not let the office play sound.") is not shown anywhere: the client gives the
  scene no `onToast`, so every toast of the scene is dropped. With Sound then turned on in the
  settings and the office opened again, the button stayed off and dimmed.
- A frame whose first press does not start a context was made with a script that made the probe's
  first context report "suspended" and never resume. Escape and Shift made no probe. The first
  press on the floor made the button dimmed with "Sound is not available here" and turned the
  scene's sound off; a second press probed again, the context ran, and the button could be used:
  it showed off, though the setting was still on, until it was pressed, and then on. Fixed after
  this look, to be seen again: the scene now keeps the setting through a block and turns sound on
  by itself once a press starts audio, and a press on the button whose own probe starts audio
  turns sound on instead of saying it is unavailable.
- The autoplay rule could not be made stricter: the browser starts with the kit's own flags, and a
  context made without a press ran. A frame that refuses audio was made with the script above
  instead.

Seen at 390 px (touch, a coarse pointer, as a phone):

- The toolbar holds Overview, Desks, Meeting room, Servers, the zoom, Full screen, Photo mode and
  the speaker button; Walk in is shown for a fine pointer only. The bar ends 19 px inside the
  frame's right edge. A tap on the button turned it on and stored `sound: true`; a tap turned it
  off; the second tap also made karaoke's context, as at 1280 px.
- The settings page wraps the 3D, 2D and List switch and Sound onto a row under Wake agents and
  Agent tools; the Sound switch is 96 by 44 px.

### The toolbar at 390 px

With the button in, the bar no longer fit at 390 px with a mouse. The look's browser at 390 px has
a touch screen, which hides Walk in, so Walk in was shown by hand to measure it (the bar's sizes do
not depend on the pointer). At `d98d46a` the bar's content was 400 px wide inside 378 px, and
Walk in ended 16 px past the frame's right edge. `8d6399e` adds `.tb-tools { gap: 0; }` and
28 px buttons to the 520 px rule; after it the content is 386 px inside 378 px, and Walk in ends
2 px past the frame's edge and over the bar's border. It still does not fit, by 8 px.

The browser console held no error or warning from the plugin and no Paseo error, at either width.

## Not seen, and why

| What                                                 | Why                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The card for an agent                                | The fourth look had Mock agents at desks; no card was opened                                                                                            |
| A resting agent's tag on the 3D floor                | Shown only while it walks, is hovered or chosen; none of these done                                                                                     |
| The view choice kept across a reload                 | The fourth look read the key after each press, not after a reload                                                                                       |
| The names in text read at 390 px                     | The text was gathered at 1280 px only                                                                                                                   |
| The office's tools inside an agent's session         | No agent session. The page shows Agent tools on, nothing more                                                                                           |
| A stand-up run and the notes it writes               | The 8:00 run did not come due, and the bell was not pressed                                                                                             |
| An incidents check                                   | Needs Jira or Sentry tokens on the host, and none were set                                                                                              |
| The gear at 390 px                                   | A click on it timed out with the sheet open. It was not tried again                                                                                     |
| The phone app                                        | Only a browser was used                                                                                                                                 |
| A session's tab, its conversation and a reply        | No session was opened; the first three looks had no agent                                                                                               |
| A permission answered, and Stop on a session         | Not tried; the fourth look's waiting plan approval was left alone                                                                                       |
| An agent created from the form                       | Create was not pressed: it would start a real provider session                                                                                          |
| The session tab row scrolling when it is full        | Needs several session tabs, so agents                                                                                                                   |
| The agent card's Stop and the Host card close        | 0.16.2 lacks `cancel()` and `closeRuntime()`; see the README                                                                                            |
| Sound heard at all, on the desktop app and a browser | No sound card here; the owner's to check on the host after the update                                                                                   |
| The phone's script frame and sound                   | Whether the first tap starts audio, whether the button reads "not available", and whether an incident's siren is heard: the owner's, on the Android app |
| The second tap on a real touch screen                | Seen only with the browser's touch emulation; the owner's, on a phone                                                                                   |
| Karaoke singing at the lounge's TV with Sound on     | Needs the walk (W A S D) to the TV; the owner's                                                                                                         |
| iOS and its ring switch                              | No iOS device; unknown                                                                                                                                  |
| An incident's siren with Sound on and off            | Needs Jira or Sentry tokens on the host, and none were set                                                                                              |
