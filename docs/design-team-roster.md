# Design: team roster

Status: built on branch feat/team-roster; plan in docs/plan-team-roster.md.

## Problem

The office shows a workspace under Paseo's generated name and an agent under its session title,
or `Agent <id>` when it has none. To make the floor read like a real team the owner has to type a
team name on every workspace and a name on every agent, and do it again for each new one.

## What it does

The owner writes down their teams once, each with its teammates, in the office's settings. The
office then hands the names out by itself: a team name to a workspace, a teammate name to each
agent in that workspace.

Example. Two teams are configured, in this order:

- `PR-DEV`: Tze Jun Tan, Kharisma Muzaki Ghufron, Shashwat Gupta, Taufik Suryaman
- `PR-QA`: Rosalyn, QX

The first workspace is shown as PR-DEV. Its first four agents each take one of the four teammates
by chance, none twice, and a fifth keeps the name it has
today. A second workspace is shown as PR-QA with Rosalyn and QX. A third workspace keeps its
Paseo name, and so do its agents. When the PR-DEV workspace is archived, the next new workspace is
PR-DEV.

The names are the office's own. Paseo's workspace names and session titles are never changed, so
the sidebar, the tabs and the CLI show what they show today.

## Rules

1. **A team goes to a workspace.** Workspaces that have no team and have not been passed over,
   oldest first, each take the first team in the configured order that no open workspace holds.
   When every team is held, the workspace is marked as passed over.
2. **A teammate goes to an agent.** In a workspace that holds a team, agents that have no
   teammate and have not been passed over, oldest first, each take one teammate of that
   team that no live agent in the workspace holds, picked by chance among those (the owner's
   answer of 2026-11-23; teams still go to workspaces in the configured order). Sub-agents are agents here: they draw from the
   same list. When every teammate is held, the agent is marked as passed over.
3. **A name sticks.** A team stays with its workspace and a teammate with its agent until that
   workspace or agent is archived or closed. Nothing that already runs is renamed when a name
   becomes free.
4. **A freed name goes to the next new one.** Archiving frees the name. Only a workspace or agent
   that has not been looked at yet can take it; one that was passed over stays as it is.
5. **A workspace without a team names nobody.** Its agents keep today's names.
6. **Switching on names what is already open**, by rules 1 and 2, oldest first.
7. **Switching off** makes the office ignore the roster: every name is today's. What was handed
   out stays stored, so switching on again shows the same assignments.
8. **A longer roster is offered again.** Adding a team or a teammate, or switching the roster on,
   lets what was passed over be looked at once more, oldest first. So the owner can switch on
   first and write the teams after, or add a fifth teammate for the fifth agent. Archiving alone
   never does this: rule 4 holds.

"Oldest first" is by creation time. A workspace without one (an older host) is ordered by its
oldest agent's creation time; ties break on the id.

### Which name shows

For a workspace: the team name the owner typed by hand (`office.team.name`), then the roster's
team, then the workspace's name. As today, the office carries the workspace's own name beside it
whenever another name is shown.

For an agent: the name the owner typed by hand (`office.appearance`), then the roster's teammate,
then `<parent's office name>-<number>` for a numbered sub-agent, then the session title, then
`Agent <id>`. A sub-agent of Tze Jun Tan that was passed over is therefore `Tze Jun Tan-1`.

A hand-typed name does not release the roster name underneath: an agent the owner renamed still
holds its teammate, and shows it again if the typed name is cleared.

### Editing the roster

Every team and every teammate has an id, made when its row is added and never shown. Assignments
store ids, not names, so:

- changing a name's spelling renames whoever holds it, at once;
- deleting a teammate or a team makes its holder show today's name, and the holder is marked
  passed over: it is not given another now, and a later, longer roster reaches it by rule 8;
- reordering changes nothing that is already handed out; the order of the teams decides which
  workspace is offered which, and the order of a team's teammates only how they are listed;
- adding a teammate or a team offers it by rule 8: to what was passed over, oldest first, then to
  the next new one.

## Storage

Settings (host scope, `shared/settings.ts`), three new values:

- `rosterOn`: boolean, default `false`.
- `rosterEdition`: a whole number, default 0. The Teams section adds one to it in the same save
  that adds a team or a teammate or switches the roster on. Nothing else changes it.
- `teams`: a list, default empty, of `{ id, name, members: [{ id, name }] }`. A team name is
  tidied as a hand-typed team name is (one line, at most 40 characters); a teammate name follows
  the hand-typed agent name (one line, at most 60). An empty name is refused. Two teams with the
  same name are refused, and so are two teammates with the same name in one team. At most 50
  teams and 50 teammates per team, so a save stays small.

The settings store takes any JSON value a zod schema accepts (`defineSettings` in
`@getpaseo/plugin` 0.16.2), so the nested list needs no change in Paseo. The settings version goes
up by one with no migration: every new value has a default.

Metadata, written by the office and never read by Paseo:

- on a workspace, `office.roster.team`: the team's id, or the edition it was passed over at;
- on an agent, `office.roster.member`: the teammate's id, or the edition it was passed over at.

A passed-over mark older than the settings' edition reads as not looked at yet (rule 8). An id
that is no longer in the settings reads as passed over at the current edition: deleting a name
gives its holder no other. The office then writes the edition over that id, and over a teammate's
id on an agent now in a workspace of another team, so the mark says what it reads as.

## Parts

- `shared/roster.ts` (new): the keys, the limits, the zod shape of a team, the reader of a stored
  mark (`storedRosterMark`), and `teamOf` and `memberOf`, which turn a mark into a name.
- `server/roster.ts` (new): `planRoster(teams, workspaces, agents)`, a pure function that returns
  the metadata writes rules 1, 2 and 4 call for, in the manner of `planNumbers` in
  `server/subagent-names.ts`. It takes only what it reads: ids, creation times, the workspace of
  each agent, and the stored roster values, plus the pick among a team's free teammates: the
  hub passes one by chance (`byChance` over its `random` port), and a test passes its own. It
  plans nothing when the roster is off.
- `server/hub.ts`: runs the planner where it runs `planNumbers`, on every directory change and
  when the settings change, and writes the result through the same metadata port. An agent's
  write waits for its workspace's write of the same plan, and is not sent if that one fails. A
  write that fails is not sent again until the roster changes or the office is opened again; a
  name is never shown before its write is stored, so two agents cannot show the same teammate.
  The hub also resolves the names by the order above (`teamed` for a workspace, `named` for an
  agent), since it holds the settings' teams that turn an id into a name.
- `server/directory.ts`: carries each workspace's and agent's stored mark as `roster`, and a
  workspace's creation time; it resolves no name.
- `server/subagent-names.ts` (`officeNames`): a parent's roster name counts as its office name.
- `client/teams-settings.tsx` (new) and `client/settings-sections.tsx`: a settings section,
  **Teams**, the second, after Appearance.
- `docs/office.md` and `CHANGELOG.md`.

## The Teams section

- A switch, "Name teams and agents from the roster", off by default.
- One block per team: the team's name, then its teammates one per row. Each row can be edited,
  removed and moved up or down; "Add teammate" appends a row. The team itself can be removed and
  moved up or down. "Add team" appends a block.
- Beside a team that a workspace holds, that workspace's own name; beside a teammate that an
  agent holds, a mark. Both are read-only and come from the office's state.
- The save follows the other settings: a refused value is named under its row, and a conflict
  with another device's save is reported, not overwritten.
- Phone width first: one column, every control at least 44 px high, no drag to reorder.

## Out of scope

- Renaming Paseo's own workspaces or sessions.
- Choosing by hand which workspace gets which team: a hand-typed team name already does that.
- A look per teammate (colour, avatar). The roster carries names only.
- Giving a name freed by an archive to an agent or workspace that was passed over.

## Tests

- `server/roster.test.ts`: the example above as cases; a used-up roster marks the rest as passed
  over; archive then a new agent reuses the freed teammate; archive a workspace then a new one
  reuses the team; a passed-over agent is not promoted; sub-agents draw from the list; switching
  on names what is open, oldest first; a team or teammate added later reaches what was passed
  over, and an archive alone does not; a deleted id reads as passed over and is written over with
  the edition, and a longer roster reaches it; a moved agent does not show a teammate handed on
  meanwhile; marks kept through off and on; nothing is planned when off; a workspace without a
  creation time is ordered by its oldest agent.
- `server/directory.test.ts`: a workspace and an agent carry their stored mark.
- `server/hub.test.ts`: the workspace's write before its agents', and a teammate that waits for its
  team; a name shown only once stored; a hand-typed team name over the roster's; today's names,
  the workspace's own among them, with the roster off; a failed write not sent again until the
  roster changes or the office opens again.
- `server/subagent-names.test.ts`: a roster name as an office name, and a passed-over sub-agent
  named after its parent's teammate.
- `server/life-feed.test.ts`: a workspace that takes back a team's name leaves no intern behind.
- `shared/roster.test.ts` and `shared/settings.test.ts`: the limits, the refused duplicates, the
  edition, and the order of a workspace's names.
- `client/teams-settings.mounted.test.tsx`: add, edit, remove and move a team and a teammate; the
  holder marks; a refused save; edits made while a save is out; an edit that changes nothing.
- `index.server.test.ts`: a settings save re-plans.
- By hand on the development daemon: the PR-DEV and PR-QA example with real workspaces, then
  archive and reuse, on a phone-width browser.
