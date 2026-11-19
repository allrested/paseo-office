# What was seen on a stock daemon

The plugin was installed by Git, from a local clone of this repository, on an unmodified Paseo
0.16.2 (the published `@getpaseo/server` and `@getpaseo/cli`) on 2026-11-19. The daemon ran on a
throwaway home with plugins turned on and the web UI enabled, with no agents, no provider sign-in
and no tracker tokens. The page was opened with a browser, at 1280 and at 390 px wide.

The first look was at this repository before its last fixes, which moved the floor's note and
changed comments, docs and the stand-up notes' prompt. A second look, at the tree this document is
in, was of the 3D view's note only. It is not repeated on each change.

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

## Not seen, and why

| What                                          | Why                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------- |
| An agent at a desk, and the card for it       | No agents: the host has no provider sign-in, and none was created   |
| The office's tools inside an agent's session  | No agent session. The page shows Agent tools on, nothing more       |
| A stand-up run and the notes it writes        | Needs agents to report on, and the 8:00 run did not come due        |
| An incidents check                            | Needs Jira or Sentry tokens on the host, and none were set          |
| The gear at 390 px                            | A click on it timed out with the sheet open. It was not tried again |
| The phone app                                 | Only a browser was used                                             |
| The agent card's Stop and the Host card close | 0.16.2 lacks `cancel()` and `closeRuntime()`; see the README        |
