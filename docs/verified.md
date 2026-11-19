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
  `Loading plugin` and `Plugin ready` in its log. Installed by Git, the branch does not run.
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

## Not seen, and why

| What                                          | Why                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------- |
| An agent at a desk, and the card for it       | No agents: the host has no provider sign-in, and none was created   |
| The office's tools inside an agent's session  | No agent session. The page shows Agent tools on, nothing more       |
| A stand-up run and the notes it writes        | Needs agents to report on, and the 8:00 run did not come due        |
| An incidents check                            | Needs Jira or Sentry tokens on the host, and none were set          |
| The gear at 390 px                            | A click on it timed out with the sheet open. It was not tried again |
| The phone app                                 | Only a browser was used                                             |
| A session's tab, its conversation and a reply | No agent: no provider was signed in, and none was created           |
| A permission answered, and Stop on a session  | No agent session to ask or to stop                                  |
| An agent created from the form                | Create was not pressed: it would start a real provider session      |
| The session tab row scrolling when it is full | Needs several session tabs, so agents                               |
| The agent card's Stop and the Host card close | 0.16.2 lacks `cancel()` and `closeRuntime()`; see the README        |
