# Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work reaches the lobby by itself and is started under a cost gate: a backlog, a gate,
Jira and GitHub intake, a Telegram bridge, checkpoints, hand-over between providers, and a pull
request tour.

**Architecture:** Every change is additive. A post gains optional fields (`shared/contracts.ts`),
the board service (`server/board-service.ts`) enforces the rules in its one save queue, and the
pickup (`server/lobby-pickup.ts`) learns to pass over what is held. New outside connections follow
the existing ones: Jira through `server/incidents-http.ts`, a host CLI as CloudWatch runs `aws`,
secrets as `server/tracker-credentials.ts` keeps them, timers as `server/local-schedules.ts`.

**Tech Stack:** TypeScript, zod 4, vitest (jsdom for `*.mounted.test.tsx`), react-native-web,
`@getpaseo/plugin` 0.16.2, oxlint, oxfmt.

**Spec:** `docs/design-automation.md` (read it first; this plan argues from it).

## Global Constraints

- Work in `/workspace/M-DAQ/utils/paseo-office-tasks`. One branch per change, each from the one
  before, the first from `docs/design-automation`: `feat/task-backlog`, `feat/auto-start`,
  `feat/intake-jira`, `feat/intake-github`, `feat/telegram`, `feat/checkpoints`,
  `feat/hand-over`, `feat/pr-tour`.
- Commits: plain messages in the repo's style (`feat: …`, `fix: …`, `docs: …`), **no**
  `Co-authored-by` or "Generated with" (a local hook refuses them). Never push and never open a
  pull request: the controller does both.
- After each task: `npx vitest run <the task's test files>`, then `npm run typecheck && npm run lint`
  pass. Before a task is reported done: the whole `npx vitest run` passes and
  `npx oxfmt <touched files>` was run (never the whole tree).
- Every new post field is optional; `boards.json` stays `version: 1`. Agent tool inputs only gain
  optional fields; existing calls and `office_read` lines for posts without the new fields are
  unchanged. A reopen (`withoutClaim`, a whitelist copy) keeps what describes the task (`team`,
  `after`, `source`, `notProvider`) and drops what describes one holder's attempt.
- A new host setting goes in `HostValuesSchema` (`shared/settings.ts`) with a `.default()`, and the
  document's `version` is raised once per change that adds settings, with the migrate comment.
- **A secret is never a setting** (clients read settings). A token is kept in a 0600 file under the
  office's folder or read from the host's environment, saved and tested through RPCs that never
  send it back, exactly as `server/tracker-credentials.ts` and its RPCs do. A token, a chat id and
  an address never reach a log line or an error text shown to a client (`server/notify.ts` shows
  the safe-reason pattern).
- Outbound calls: 30 s timeout at most, an output or body limit, no shell (`execFile` with an
  argument array), every failure turned into a short safe message. Nothing from outside is trusted:
  parse with zod, cut text to its limit before it is stored.
- Text from outside the office (a ticket, an issue, a Telegram message) that reaches a post is cut
  and stored as the post's text only. In an assignment's prompt it is indented two spaces like any
  task text, so it cannot forge the footer or the completion line.
- Limits, verbatim: the gate's defaults `70` (percent), `3` (at once), `10` (per day); intake every
  10 minutes, at most `20` a run, `50` imported tasks open or held, a body cut to `1,000`
  characters; a plan reading older than `15` minutes is no reading; checkpoints `10` turns per
  agent; a hand-over note `1,200` characters; a "So far" entry `600` characters, the `5` newest.
- Every new interface text is English in the component and has an entry in
  `shared/ui-words-{id,vi,th}.ts` (text with a value in it in `shared/ui-patterns-{id,vi,th}.ts`).
  Accessibility labels are translated like visible text.
- Touch targets as the house `controlHeight`. No drag and drop. No new dependencies.
- Match each file's comment voice (short, plain sentences saying why); do not reformat neighbouring
  code. `docs/office.md` describes each change where its subject already is.

---

## Change 1: a backlog (branch `feat/task-backlog`)

### Task 1.1: the backlog on the server

**Files:** `shared/contracts.ts`, `server/board-service.ts`, `server/lobby-pickup.ts`,
`server/agent-tools.ts`, `server/office.ts`, `index.server.ts`, their tests.

**Rules:**

- `PostSchema` gains `backlog: z.literal(true).optional()`. `office_post` and `postRpc` gain
  `backlog: z.boolean().optional()`. Only a task on the lobby: `Unable to post: only a lobby task
goes to the backlog`. It may also carry `to`, `team` and `after`.
- A held task is `open`. The pickup passes over it (`awaitingPickup`, `hasWork`, `nextFor`),
  `claimLobbyTask` returns null, and an agent's `claim` and `done` are refused `Unable to claim
p12: it is in the backlog` / `Unable to finish p12: it is in the backlog`. The user's claim and
  done are allowed and clear the mark.
- A new RPC `startRpc` (`office.task.start.request`, input `{ id }`, output `PostResultSchema`) and
  `BoardService.startTask(id)`: clears `backlog` (new seq), nothing else; a task not in the
  backlog is returned unchanged; a note or an unknown id is refused. Agents have no start: the
  tool's actions are unchanged.
- `office_post`'s description gains exactly ` Set backlog to hold a lobby task until the owner
starts it.` `office_read` adds ` (backlog)` after the state: `p12 task open (backlog), from …`.
- A reopen does not put a task back: `withoutClaim` does not copy `backlog` (an open unclaimed
  task is not changed by a reopen, so a held task stays held).

- [ ] Steps: one failing test per rule, see it fail, implement, see it pass, document in
      `docs/office.md` ("Boards and wakes"), commit `feat: a lobby task can be held in a backlog`.

### Task 1.2: the backlog on the board

**Files:** `client/kanban-model.ts`, `client/board-kanban.tsx`, `client/lobby-board.tsx`,
`client/task-card.tsx`, `client/use-board-actions.ts`, `client/board-text.ts`, words, tests.

**Rules:**

- `KanbanColumnId` gains `"backlog"`, first in the order, title `"Backlog"`; an open task with
  `backlog` is there whatever else it has (before Waiting). Dropped when empty.
- The lobby's list layout gets a folded **Backlog · n** section above the to-dos (the fold and
  heading of the room's Done section).
- A held task's card has **Start** (`BoardActions.start(id)` → `startRpc`), Delete and Follow-up;
  its checkbox still marks it done. The form has **Add to backlog** beside Add (lobby only), which
  posts with `backlog: true` and otherwise as Add does.
- `BoardActions.post` gains `backlog?: boolean`; `BoardActions.start(id): Promise<void>`.

- [ ] Steps: failing tests (column, section, Start, Add to backlog, both layouts), implement,
      pass, words, docs, commit `feat: the lobby's board has a backlog, with Start`.

---

## Change 2: the gate (branch `feat/auto-start`)

### Task 2.1: starting by itself

**Files:** `shared/settings.ts`, `server/auto-start.ts` (new), `server/plan-watch.ts`,
`server/office.ts`, `index.server.ts`, `shared/contracts.ts` (state for clients), tests.

**Rules:**

- Host settings: `autoStart` (boolean, `false`), `autoStartUnderPct` (integer 10–100, `70`),
  `autoStartAtOnce` (integer 1–20, `3`), `autoStartPerDay` (integer 1–200, `10`).
- A pure `gateDecision(input): { open: true } | { open: false; reason: "off" | "empty" |
"no-reading" | "limit" | "at-once" | "per-day"; detail?: … }` in `server/auto-start.ts`:
  - `no-reading`: no plan reading, or the newest is older than 15 minutes. The reading is the plan
    watch's (`server/plan-watch.ts`, which runs with Keep watching); expose its newest reading and
    when it was read.
  - `limit`: any window of any provider the plan pill counts (the providers switched on in the
    Host card's Plan section, as `closestLimit` treats them) is at or over `autoStartUnderPct`;
    `detail` names the provider, the window's label and its percent.
  - `at-once`: the lobby's claimed tasks number `autoStartAtOnce` or more.
  - `per-day`: the office has started `autoStartPerDay` today, the day of the notes' zone. The
    count is kept in `<PASEO_HOME>/office/auto-start.json` (`{ version: 1, day, count }`), a file
    the office cannot read being treated as today's cap reached (never start on bad data).
- When the gate is open the office starts the OLDEST backlog task (`startTask`) and counts it; one
  start per evaluation. It evaluates after a board change, a plan reading, a turn end, and a save
  of the settings; never in a loop of its own making.
- The office's state for clients gains `autoStart: { on: boolean; reason: … | null; detail?: …;
startedToday: number; perDay: number }`.

- [ ] Steps: failing tests per rule (the pure function exhaustively; the service with the fake
      clock: starts one, stops at each reason, counts per day across a restart, does not start on an
      old reading), implement, pass, docs ("Boards and wakes", "Plan limits"), commit `feat: the office
starts backlog tasks by itself under a cost gate`.

### Task 2.2: the gate's settings, its line, and the pace

**Files:** `client/host-switches.tsx` (Automation), the lobby board (a line over the Backlog
column and section), `shared/plan-usage.ts` + `client/use-plan-usage.ts` (pace), words, tests.

**Rules:**

- Automation settings: the switch **Start backlog tasks** with the three numbers, and under it the
  hint "Needs Keep watching: with no reading of the plan's limits nothing is started."
- Over the Backlog: "Starting by itself" plus why not, from the state: "no reading of the limits
  yet", "<provider>'s <window> is at 82% (starts under 70%)", "3 tasks in progress", "10 started
  today"; with the gate off, nothing.
- `planPace(earlier, later, now)` in `shared/plan-usage.ts` (pure): from two readings of one
  window at least 5 minutes apart, the instant it reaches 100% at that rate, when that is before
  its `resetsAt`; else null. The plan pill's note adds "at this pace out by <weekday HH:MM>" for
  the soonest one. The client keeps its previous reading for this.

- [ ] Steps: failing tests, implement, pass, words, docs, commit `feat: the gate's settings, why it
waits, and the plan's pace`.

---

## Change 3: Jira issues on the board (branch `feat/intake-jira`)

### Task 3.1: the intake and Jira's reader

**Files:** `shared/contracts.ts`, `shared/settings.ts`, `server/intake-service.ts` (new),
`server/intake-jira.ts` (new), `server/incidents-jira.ts` (export the tracker), `server/paths.ts`,
`server/board-service.ts`, `server/lobby-pickup.ts`, `shared/lobby-assignment.ts`,
`server/agent-tools.ts`, `index.server.ts`, tests.

**Rules:**

- `PostSchema` gains `source: z.object({ kind: z.enum(["jira", "github"]), key: z.string(), url:
z.string() }).optional()` and `wroteBack: z.literal(true).optional()`. A reopen keeps `source`.
- Host settings: `jiraIntakeJql` (string, `""`, at most 1,000 characters), `intakeLands`
  (`"backlog" | "todo"`, `"backlog"`), `intakeWriteBack` (boolean, `false`).
- `readJiraIssues(env, jql, fetchFn)`: `GET /rest/api/3/search/jql` with the owner's JQL, fields
  `summary`, `description`, at most 20, through `getJson`; a description in Atlassian's document
  format is flattened to plain text (text nodes joined, paragraphs as lines). Returns `{ key, url,
title, body }[]`; the url is `<baseUrl>/browse/<key>`.
- The intake service (sources are given to it; GitHub joins in Change 4): each run reads each
  source that is set up, and for each issue it has not seen posts a lobby task as the user:
  text `KEY title`, a line with the url, a blank line, the body cut to 1,000 characters (the whole
  within `POST_TEXT_MAX`), `source`, and `backlog` unless `intakeLands` is `todo`. It stops a run
  at 50 imported tasks open or held (posts with `source` not done).
- Seen keys live in `<PASEO_HOME>/office/intake.json` (`{ version: 1, seen: { "jira:KEY": iso } }`,
  the newest 5,000 kept), written before the task is posted is NOT wanted: post, then record; a
  task posted and not recorded (a crash between) is found by its `source` on the board at the next
  run and not posted twice.
- The timer: a local schedule `intake`, `{ type: "every", everyMs: 600_000 }`, only while a source
  is set up; it needs no Paseo API. A failure of a source is kept as a short safe problem in the
  state for clients (`intake: { jira: { problem: string | null; lastRun: iso | null; imported:
number } }`) and logged once per change of problem.
- The assignment's heading names the source: `The office assigned you lobby task p12 from Jira
PROJ-12.` (`from GitHub owner/repo#12.` in Change 4). `readLobbyAssignment` accepts it.
  `office_read`'s line adds ` [Jira PROJ-12]` before `, from`.
- Write back, when `intakeWriteBack` is on: when an imported task is done with a result, one
  comment on the ticket (`POST /rest/api/3/issue/<key>/comment`): `Done in the office by <agent>:
<result>`. Tried when the task becomes done and once more at the next run; `wroteBack` is set on
  success; after two failures the problem stays in the state and it is not tried again.

- [ ] Steps: failing tests per rule (reader with a fake fetch; the service with a fake source and
      the fake clock; the dedupe across a restart and the crash-between case; the cap; write back
      success, failure, once), implement, pass, docs ("Incidents" neighbours: a new "Intake" section),
      commit `feat: Jira issues reach the lobby by a JQL of the owner's`.

### Task 3.2: the intake's settings and the source on a card

**Files:** `client/host-switches.tsx` (Services), `client/task-card.tsx`, `client/board-text.ts`,
words, tests.

**Rules:** Services → **Intake**: the JQL field (several lines) with the hint "Tickets this
matches become lobby tasks, each once. Their text reaches an agent: keep Backlog unless you trust
who can write tickets.", "Imported tasks go to" Backlog / To do, the switch "Comment the result on
the ticket", and the last run with its problem or "N imported". A card and a row show a chip with
the source's key that opens its url (the app's link opener the Reviews card uses).

- [ ] Steps: failing tests, implement, pass, words, docs, commit `feat: the intake's settings, and
a task shows the ticket it came from`.

---

## Change 4: GitHub issues on the board (branch `feat/intake-github`)

### Task 4.1: GitHub's reader, and its settings

**Files:** `server/intake-github.ts` (new), `shared/settings.ts`, `server/intake-service.ts`,
`index.server.ts`, `client/host-switches.tsx`, words, tests.

**Rules:**

- Host settings: `githubIntakeRepos` (list of `owner/repo`, at most 10, each matching
  `^[\w.-]+/[\w.-]+$`), `githubIntakeSearch` (string, `"label:agent is:open"`, at most 200).
- `runGh(args)`: `execFile("gh", args, { timeout: 30_000, maxBuffer: 8_000_000 })` with the PATH
  the `aws` runner uses, never rejecting, no shell. `readGithubIssues(repos, search, run)`: for
  each repository `gh issue list --repo R --search S --limit 20 --json number,title,body,url`,
  parsed with zod; returns `{ key: "owner/repo#12", url, title, body }[]`. Safe problems: gh not
  installed, not signed in (`gh auth status` wording in stderr), an unknown repository, a timeout.
- It joins the intake service as the `github` source: the same seen file (`github:owner/repo#12`),
  cap, landing place and state (`intake.github`). Write back is `gh issue comment <n> --repo R
--body <text>` under the same once-and-once-more rule.
- Services → Intake gains the repositories (one per line) and the search, with the hint "Read with
  the host's gh CLI and its sign-in. The office keeps no GitHub token."

- [ ] Steps: failing tests (runner arguments exactly, each problem, parsing, the source in the
      service, the settings), implement, pass, words, docs, commit `feat: GitHub issues reach the lobby
through the host's gh CLI`.

---

## Change 5: Telegram (branch `feat/telegram`)

### Task 5.1: the bridge on the server

**Files:** `server/telegram.ts` (new: the two calls), `server/telegram-store.ts` (new: token and
state files), `server/telegram-bridge.ts` (new), `shared/settings.ts`, `shared/contracts.ts`
(RPCs, state), `shared/board-rules.ts` (the stall rule moved to shared so the server can use it),
`server/office.ts`, `index.server.ts`, tests.

**Rules:**

- The token: `<PASEO_HOME>/office/telegram.json` (0600, `{ version: 1, token }`) or
  `TELEGRAM_BOT_TOKEN`; saved wins. RPCs `telegramSaveRpc` (token in, never out) and
  `telegramTestRpc` (`getMe`, then a "connected" message to the chat), modelled on the trackers'.
- Host settings: `telegramChat` (string of digits with an optional leading `-`, `""`),
  `telegramUsers` (list of digit strings, at most 20), switches `telegramNeeds` (`true`),
  `telegramStalled` (`false`), `telegramDone` (`true`), `telegramIncidents` (`true`),
  `telegramPlan` (`true`), and `telegramLands` (`"backlog" | "todo"`, `"backlog"`).
- The bridge runs only with a token, a chat and at least one user id. It long-polls `getUpdates`
  (timeout 25 s, one call at a time, `allowed_updates: ["message"]`), backing off 5 s doubling to
  60 s on a failure, and stops at once when the settings no longer allow it or the plugin stops.
  Its `offset` and the last 200 `{ messageId: postId }` pairs are in
  `<PASEO_HOME>/office/telegram-state.json`.
- Out, each by its switch, each once per event, plain text with the task id first: a task newly
  blocked (`p12 needs you — <agent>: <reason>`), a claim newly stalled by the shared rule (checked
  every 60 s with the directory's statuses), a task newly done (`p12 done by <agent>: <result>` or
  "no result given"), and the notices the webhook gets (incidents, plan warnings) through the same
  `tell`. A message is cut to 3,500 characters.
- In, only from a message whose sender id is listed AND whose chat is the configured chat or a
  private chat with that sender:
  - a reply to one of the bridge's own messages that names a task still on a board posts its text
    under that task as the user's reply (the board's reply path: it unblocks and wakes);
  - `/task <text>` posts a lobby task as the user, held unless `telegramLands` is `todo`; the
    bridge answers with the id;
  - `/board` answers with the counts and the first lines of what is in progress, blocked, waiting
    and held (at most 20 lines);
  - anything else from a listed user gets one line of help.
- A message from anyone else, or in another chat, is dropped: counted in the state (`dropped`),
  never answered, its text and sender never logged.
- The state for clients: `telegram: { on: boolean; source: "saved" | "env" | null; problem: string
| null; dropped: number }`.

- [ ] Steps: failing tests per rule with a fake Telegram (a scripted `fetchFn`) and the fake clock:
      each outgoing event once; each incoming path; the allow rules (wrong user, wrong chat, a listed
      user in another group); back-off; restart resumes from the offset and still maps a reply; the
      token never in a log or an error. Implement, pass, docs (a new "Telegram" section), commit
      `feat: the office speaks through a Telegram bot`.

### Task 5.2: Telegram's settings

**Files:** `client/tracker-connections.tsx` (or a sibling), `client/host-switches.tsx` (Services),
words, tests.

**Rules:** Services → **Telegram**: the token field with Save and Test as Jira's connection has
(showing "saved" or "from the host's environment", never the token), the chat id, the user ids
(one per line), the five switches, "Tasks from Telegram go to" Backlog / To do, the problem line,
and the hint "Only the listed user ids are heard. A message that reaches an agent can make it run
commands."

- [ ] Steps: failing tests, implement, pass, words, docs, commit `feat: Telegram's settings`.

---

## Change 6: checkpoints (branch `feat/checkpoints`)

### Task 6.1: ten turns, and what each changed

**Files:** `server/undo-turn.ts`, `shared/contracts.ts` (`undoRpc`), `index.server.ts`,
`client/undo-turn.tsx`, `client/session-panel.tsx`, words, tests.

**Rules:**

- The before and end snapshots a turn already gets are kept for the last 10 turns of an agent
  (oldest dropped), still in memory, still only with `undoTurn` on and in a git work tree.
- `undoRpc` op `status` answers the turns, newest first: `{ turnId, endedAt, files: { path, added,
removed, kind: "added" | "modified" | "deleted" }[], more: number }` from `git diff-tree -r
--numstat` (and `--name-status`) between the turn's two trees, at most 200 files a turn, binary
  files with no counts. This includes what a shell command changed.
- Op `undo` undoes the NEWEST turn not yet undone, over every path that diff lists (not only the
  tool-edited ones), by the rule it has: a path changed since the turn's end tree is skipped and
  counted; a path outside the tree, in `.git`, ignored or a symlink is refused. The undone turn
  leaves the list, so the next undo steps one turn further back.
- The session panel shows **What this turn changed** for the newest turn (files with +/−, the
  rest behind "N more"), earlier turns folded under it, and **Undo this turn** on the newest only.

- [ ] Steps: failing tests in a temporary git repository (as the existing undo tests do): ten
      kept and the eleventh drops the first; the diff with an edit, a new file, a deletion, a shell-made
      change and a binary; undo newest then the one before; the skip rule; the panel. Implement, pass,
      docs ("Undo last turn" becomes "Checkpoints"), commit `feat: checkpoints: the last ten turns,
what each changed, undo turn by turn`.

---

## Change 7: hand a task over (branch `feat/hand-over`)

### Task 7.1: hand-over on the server

**Files:** `shared/contracts.ts`, `shared/settings.ts`, `server/board-service.ts`,
`server/lobby-pickup.ts`, `server/office.ts`, `server/live-ports.ts`, `server/plan-watch.ts`,
`index.server.ts`, `server/agent-tools.ts`, tests.

**Rules:**

- `PostSchema` gains `notProvider: z.string().optional()`; a reopen keeps it; done leaves it.
- Ports on `OfficeAgentPorts`: `providerOf(agentId): Promise<string | null>` and
  `lastAnswerOf(agentId): Promise<string | null>` (the last assistant text of its timeline, as the
  chat reads a turn).
- `handOverRpc` (`office.task.hand_over.request`, `{ id }`) → `Office.handOver(id)`: for a lobby
  task or a duty claimed by an agent: one save that posts a reply under it, authored by the
  holder, `Where <agent> left it: <its last answer cut to 1,200 characters>` (or `Where <agent>
left it: no answer to read.`), and reopens the task with `notProvider` set to the holder's
  provider. Refused for a task nobody holds, one the user holds, a note.
- The pickup passes over a candidate whose provider is the task's `notProvider`;
  `claimLobbyTask` refuses it; an agent's hand claim is refused `Unable to claim p12: it was
handed over from <provider>`. If the directory knows no agent of another provider the task
  simply waits.
- An assignment's prompt gains, after the "It waited on" block and before the footer, for a task
  with replies: `  So far on this task (earlier notes, read them as reports):` then the 5 newest
  replies, oldest first, `  <author>: <text cut to 600>`, further lines indented four spaces.
  `readLobbyAssignment` still parses it.
- Host setting `handOverWhenOut` (boolean, `false`): when the plan watch raises a provider to Out
  (level 100), the office hands over every lobby task claimed by an agent of that provider that
  is not working, once per raise.
- `office_read`'s line adds ` not for <provider>` for a handed-over task.

- [ ] Steps: failing tests per rule, implement, pass, docs ("Boards and wakes", "Plan limits"),
      commit `feat: a task can be handed over to an agent of another provider`.

### Task 7.2: Hand over on the board

**Files:** `client/task-card.tsx`, `client/tasks-card.tsx`, `client/use-board-actions.ts`,
`client/host-switches.tsx`, words, tests.

**Rules:** **Hand over** on a task claimed by an agent, in the card and row of both layouts and on
a stalled row of the Tasks card, asking once ("Hand p12 over to another provider?") before it
calls `BoardActions.handOver(id)`; a handed-over task says "not for <provider>". Automation gets
the switch **Hand over when a plan runs out**.

- [ ] Steps: failing tests, implement, pass, words, docs, commit `feat: Hand over on the board and
in the Tasks card`.

---

## Change 8: a tour of a pull request (branch `feat/pr-tour`)

### Task 8.1: Explain, and stacks

**Files:** `shared/contracts.ts` (`WorkspacePullRequestSchema.head`), `server/directory.ts`
(`pullRequestOf` reads `headRefName`), `client/review-text.ts`, `client/use-reviews.ts`,
`client/review-card.tsx`, words, tests.

**Rules:**

- The pull request the office carries gains `head: string | null` (optional, the descriptor's
  `headRefName`).
- **Explain** beside "Ask for a review": posts a note to the team's newest idle agent whose first
  line is `Tour request: #<n> <title>`, second the url, then `List the changed files in the order
to read them, one line each with why it changed. Do not review the change.` The asked agent's
  first note after it is shown in the card as the tour; while a tour request has no answer and its
  agent is still in the room, Explain is off for that pull request (the rules a review request
  has, kept apart from them: a tour is not a review).
- `reviewStacks(rows)`: pull requests whose `base` equals another's `head` form a stack, ordered
  from the one based on a branch outside the set upward; a row in a stack of two or more is
  labelled "Stack: 2 of 3" and the queue keeps a stack's rows together in that order.

- [ ] Steps: failing tests (the head read; the request text; the tour found and shown; Explain
      off while asked; stacks of one, two, three and a fork), implement, pass, words, docs
      ("Reviews"), commit `feat: the Reviews card explains a pull request and draws stacks`.
