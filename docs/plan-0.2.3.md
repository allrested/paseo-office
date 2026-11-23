# Plan for 0.2.3

Three changes ship together in one version. Each is its own branch and pull request against
`main`; the version bump, tag and npm publish come after the third merges.

## 1. Stand-up writer mode

**Problem.** The stand-up notes writer always starts in Claude's "Accept File Edits" mode
(`ACCEPT_EDITS_MODE` in `server/live-ports.ts`). That mode approves file edits only. When the
writer calls a Jira or GitLab tool or a shell command it waits for an approval nobody gives at
8:00, and no note is written.

**Change.** A host setting, "Stand-up writer mode", beside the notes folder, time zone and days.

- The choices are the modes of the provider the writer runs on, by the provider's own names: for
  Claude, Always Ask, Accept File Edits, Auto mode and Bypass; for Codex, Default Permissions,
  Auto-review and Full Access. Plan mode is left out, since a writer in it writes nothing.
- The setting stores the mode's id. Empty means today's rule: accept edits where the provider
  offers it, else the provider's default.
- A stored mode the provider does not offer falls back to that same rule, and the settings say so
  under the row.
- A mode that asks for nothing (Bypass, Full Access) carries a hint: the writer then runs any tool
  or command unattended.
- Takes effect at the next run, 8:00 or the bell.

**Files.** `shared/settings.ts` (`notesMode`), `shared/contracts.ts` (the writer's provider and
its modes in the notes state), `server/live-ports.ts`, `server/notes-writer.ts`,
`client/host-switches.tsx` with a mode row, `docs/office.md`.

**Tests.** Mode choice and both fallbacks; the notes state carries the modes; the row shows them,
saves an id and shows the fallback line.

## 2. Team name

**Problem.** A room is named after its Paseo workspace, which is often a branch or a ticket. An
agent can be given a name in the office; a team cannot.

**Change.** The office keeps its own team name on the workspace and shows it wherever the room's
name shows. The Paseo workspace keeps its name everywhere else in the app.

- Stored in the workspace's plugin metadata under `office.team.name`, as an agent's appearance is
  stored on the agent. Needs a host with entity metadata, as agent names do.
- Set from the room: a "Rename team" action on the room's card and in the fullscreen office,
  with a field and Save. Empty goes back to the workspace's name.
- Shown on the room, its chip, the boards, the stand-up, the team chat and the 3D floor's door
  sign.
- Tenure: the ledger identifies a team by workspace name today, so a renamed workspace starts
  again as new hires. It moves to the workspace's id, with the existing ledger read by name once
  and rewritten by id. A team name change then never touches tenure.

**Files.** `shared/contracts.ts` and `shared/model.ts` (the room's team name), `server/directory.ts`
(reads the metadata), a rename RPC in `index.server.ts`, the tenure ledger in `server/`, the room
card and fullscreen header in `client/`, `client/world/adapter.ts`, `docs/office.md`.

**Tests.** The name is read, saved and cleared; every place that showed the workspace name shows
the team name; a ledger kept by name is carried over to ids with tenure intact.

## 3. Characters for a provider's own sub-agents

**Problem.** The office draws a character for a sub-agent only when it is a Paseo agent, started
with Paseo's create-agent tool and carrying the parent label. A sub-agent the provider runs inside
its own session, such as Claude's Agent tool, is not a Paseo agent. Paseo's plugin SDK does not
list them, so the office shows the parent "Waiting on" nothing and no new character appears.

**Change.** A stand-in character for each sub-agent call that is running.

- The office already reads the tail of each running agent's timeline every 5 s and knows a
  `Task` or `Agent` tool call as the kind `subagent`. Each such call with status `running`
  becomes a stand-in: named `<parent's name>-<n>`, seated in the parent's room, at work until the
  call ends, then walking out.
- A stand-in is display only. It has no session to open, no chat, no janitor and no wake, and the
  cards say so. A tap on it opens the parent.
- The parent counts as waiting on its stand-ins, so it stays at its desk, at work.
- Limits to accept: a call that starts and ends between two reads is never seen; the read is of
  the timeline's tail, so with many calls at once the oldest may be missed; and what a sub-agent
  is doing is not known beyond the call's description.

**Open point.** If Paseo's SDK gains a list of provider sub-agents (the app has one for its
Subagents track), the stand-ins should come from it instead. This plan does not wait for that.

**Files.** `server/activity.ts` (the running sub-agent calls of an agent), `server/hub.ts` and
`shared/contracts.ts` (stand-ins in the office state), `shared/model.ts` (rows and waiting-on),
`client/world/adapter.ts` (people on the floor), the session cards in `client/`, `docs/office.md`.

**Tests.** Calls become stand-ins and leave when they end; names are stable while a call runs;
the parent waits on them; no action that needs a session is offered on one.

## Order and release

1. Stand-up writer mode: smallest, and it unblocks the daily notes.
2. Team name.
3. Sub-agent stand-ins: largest, and the one most likely to need a second look on a phone.
4. Bump to 0.2.3, add the version to `CHANGELOG.md`, tag, publish to npm, registry update.

Each pull request passes typecheck, lint, the format check, the world check and the tests before
it is opened, and is tried on a phone before the release.
