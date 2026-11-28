# Design: the board's tasks

Nine changes to the boards, after a look at Multica (multica.ai), a shared task board for people
and coding agents. Paseo already does what Multica's daemon does; what the office lacks is a task
that says what came of it, a way to ask for help, and work that waits for other work. Each change
is its own branch and pull request against `main`, in this order, each on the one before it. The
version bump, tag and npm publish come after the last merges.

What agents see changes in one place, the three board tools, and only by optional fields, so a
call that works today still works:

| Tool            | Today                         | Added                                                                       |
| --------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `office_update` | `claim`, `done`, `reopen`     | action `block`; `note`: the result with `done`, what is needed with `block` |
| `office_post`   | `kind`, `text`, `to`, `board` | `replyTo` (a task id), `team` (a roster team), `after` (task ids)           |
| `office_read`   | posts, one per line           | results, blockers, replies, teams, what a task waits on                     |

A post gains optional fields only (`shared/contracts.ts` `PostSchema`): `result`, `blocked`,
`replyTo`, `team`, `after`, `claimedAt`, `doneAt`, `costAtClaim`, `spentUsd`. `boards.json` stays version 1:
an older plugin reads the file and drops what it does not know at its next save.

## 1. The lobby as a kanban

**Problem.** A board is one list, oldest first, tasks and notes mixed. With a handful of tasks open,
claimed and done, the list does not show at a glance what waits, what runs and what is finished.

**Change.** The lobby's board is laid out as columns, one per kind of task; a room's board stays a
list. A device setting picks either layout for each.

- Columns, left to right: **To do** (open), **In progress** (claimed), **Done**, then **Notes**.
  Changes 3 and 6 add **Needs you** and **Waiting**; a column with nothing in it is left out, To do
  and In progress excepted.
- A card shows the task, who posted it and to whom, who holds it, and the actions its column
  allows, the same ones a row offers today: Delete, Mark done, Reopen. Moving a card is these
  buttons, not a drag: a drag fights scrolling on a phone and the camera on the 3D floor.
- Wide (the board sheet at 720 pt or more): the columns side by side, scrolling sideways when they
  do not fit. Narrow: the same columns stacked as sections, each with its count, Done folded.
- The "Agent tasks" list stays under the board.
- A device setting of its own, `office-boards` (the view's and the incidents' saves write
  `office-device` whole and would drop a field): `lobby` Kanban or List, Kanban by default, and
  `rooms` List or Kanban, List by default. In the settings under **Boards**.
- Every later change shows in both layouts.

**Files.** `client/kanban-model.ts` (which column a post is in, pure), `client/board-kanban.tsx`,
`client/lobby-board.tsx`, `client/board-sheet.tsx`, `shared/settings.ts`, the settings page, the
three `shared/ui-words-*.ts`, `docs/office.md`.

**Tests.** The column of every kind of post; the layout per setting and width; the actions per
column; the setting's default and save.

## 2. Results and replies

**Problem.** `done` records who finished a task and not what came of it, so the answer stays in the
agent's chat. Nobody can answer a task on the board either.

**Change.**

- `office_update` with `done` takes `note`, kept as the task's `result` (2,000 characters at most).
  A linked lobby task and its copy carry the same result.
- `office_post` takes `replyTo`: a note under that task, on the task's board whatever `board` says
  (a reply to a copy goes to its lobby task, and a reply to a reply to the reply's task).
- A reply wakes the agent holding the task, unless that agent wrote it, by the post wake's rules
  (idle, at most 6 an hour, Wake agents on). A reply from the holder is for the user and wakes
  nobody.
- A task takes its replies with it when it is deleted, cleared or pruned.
- A session finishing by the completion line, its tools gone, has the rest of that reply kept as
  the result.
- The assignment's footer asks for a short result. The footer an earlier prompt carries is still
  recognised (`readLobbyAssignment`), and the completion line is unchanged.
- `office_read` lists a result under its task and a reply as `p14 note re p12`.
- A card and a row show the result, and the replies under the task with a Reply field. A long
  result is cut by its text (three lines, 160 characters) with More, not by a line clamp, which
  cannot be measured: nothing is hidden without a way to it.
- A room's board hid its done tasks, so a result there could not be read. It keeps them in a
  folded **Done** section under the list, with Clear finished, and in the Done column of a kanban.
- A reply is kept under the task itself, also when it answers another reply, and a reply to a
  done task still goes to the agent that did it.

**Files.** `shared/contracts.ts`, `shared/lobby-assignment.ts`, `server/board-service.ts`,
`server/agent-tools.ts`, `server/office.ts`, `client/` board rows and cards, the words,
`docs/office.md`.

**Tests.** Result kept and mirrored; reply placement, root and wake; replies leave with their task;
completion-line result; both footers parse.

## 3. Needs you

**Problem.** The assignment tells an agent that needs input to "leave it claimed and explain what
you need". The board then shows "claimed", and the question is only in the agent's chat.

**Change.**

- `office_update` action `block` with `note` (required): the task stays claimed and is marked
  `blocked` with that reason. Only the agent holding it blocks it.
- The mark goes when the holder finishes, claims again or reopens, when the user reopens, and when
  somebody other than the holder replies: the reply is the answer and wakes the holder (change 2).
- A linked lobby task and its copy carry the same mark.
- A **Tasks** card in the Attention tab lists the blocked tasks, each with its reason and an
  Answer field. It counts in the Attention count.
- The kanban's **Needs you** column; a row's "Needs you" badge.
- The footer says to block with what is needed.

**Files.** `shared/contracts.ts`, `server/board-service.ts`, `server/agent-tools.ts`,
`shared/lobby-assignment.ts`, `client/tasks-card.tsx` (new), the attention entries, the board, the
words, `docs/office.md`.

**Tests.** Who may block; what clears the mark; the mirror; the card's list and Answer.

## 4. Claims nobody works on

**Problem.** A claim stays until the task is done or reopened, also when its agent was closed or
archived, or stopped on an error. The duty board's Reopen exists to work around it.

**Change.**

- When an agent is closed or archived (`agentGone`), every task it holds, on every board, duties
  included, is reopened, and the pickup hands it on.
- The Tasks card also lists a claim whose agent stopped on an error, or is idle while the task is
  neither done nor blocked and has not changed for 2 minutes. Each has **Nudge**, a reply from the
  user asking the agent to finish with a result or block with what it needs (which wakes it, as a
  reply does), and **Reopen**.

**Files.** `server/office.ts`, `server/board-service.ts`, `client/tasks-card.tsx`, the words,
`docs/office.md`.

**Tests.** Every board's claims reopen on close and on archive; which claims count as stalled;
Nudge posts the reply.

## 5. Tasks for a team

**Problem.** The roster names teams (PR-DEV, QA-PR), but a lobby task goes to one agent or to any.

**Change.**

- `office_post` takes `team`, a roster team by name (any case) or id. Refused when the roster is
  off or has no such team, and together with `to`.
- The pickup hands it only to an idle agent that holds a teammate of that team, by the rules of
  "Any idle agent" otherwise, so it needs Agent tools as they do.
- The To picker lists the teams under Any idle agent; a card and a row say "for team QA-PR".

**Files.** `shared/contracts.ts`, `server/agent-tools.ts`, `server/lobby-pickup.ts`, the roster
lookup on the server, the post form, the words, `docs/office.md`.

**Tests.** Team resolution and refusals; pickup within the team only.

## 6. Work that waits for work

**Problem.** "Review it once it is built" is two tasks today, the second posted by hand later, and
its agent has to go and find what the first one found.

**Change.**

- `office_post` takes `after`, up to 5 task ids on any board. A task waits while one of them is
  there and not done; a deleted one no longer holds it.
- The pickup passes over a waiting task, and an agent cannot claim it ("waiting on p12"). The user
  can still claim it or mark it done.
- When it is handed out, its prompt carries the result of each task it waited on. That is the
  hand-off: no separate workflow is added.
- **Follow-up** on a task opens the post form set to wait on it.
- The kanban's **Waiting** column; a row's "waiting on p12".

**Files.** `shared/contracts.ts`, `server/agent-tools.ts`, `server/board-service.ts`,
`server/lobby-pickup.ts`, the post form, the board, the words, `docs/office.md`.

**Tests.** Validation; waiting and release; refused claim; the results in the prompt.

## 7. Time and cost of a task

**Problem.** Nothing says what a task took.

**Change.** At a claim the post keeps `claimedAt` and the agent's reported cost so far
(`costAtClaim`, from the directory's `costUsd`). At done it keeps `doneAt`, and `spentUsd`, the
difference, when both are known and it is not negative. A done card and row say "took 23 min · $0.42", or the time
alone. A reopen drops them. It is what the agent spent while it held the task: chat with it in that
time counts too.

**Files.** `shared/contracts.ts`, `server/board-service.ts` (a cost port), `server/office.ts`, the
board, the words, `docs/office.md`.

**Tests.** Kept at claim, worked out at done, dropped at reopen; unknown or lower cost.

**Settled at the end of the turn.** A provider reports an agent's cost when a turn ends, and an
agent marks its task done in the middle of one. So a task done while its agent works is marked
`spentPending`, and `spentUsd` is worked out when the directory shows the agent no longer working.
An agent that is closed, archived or gone from the directory before that leaves the task with its
time and no cost: a figure is right or absent. A claim made by tool in the middle of a turn counts
that turn whole.

## 8. A time for each duty

**Problem.** Every duty is posted at 8:00.

**Change.** A duty has a time of day, 08:00 unless set, in the notes' zone, from 08:00 to 23:59:
the duty board's day begins at 08:00 (`dutyClock`) and that stays, so an earlier time would fall on
the day before. It is due on its days once that time has passed, so the posting rules stay as they
are and only the hour moves. The duty board's timer runs at 08:00 and at each later time a duty
has. The duty editor gets a time field.

**Files.** `shared/contracts.ts` (`DutySchema`), `server/duty-service.ts`,
`server/local-schedules.ts`, the duty editor, the words, `docs/office.md`.

**Tests.** Due before and after its time; the timer's next run; the editor saves the time.

## 9. A merged pull request

**Problem.** A task's work often ends with a merge, and the task stays claimed.

**Change.** The Tasks card lists a claimed task whose holder's workspace has a merged pull request
(the workspace descriptor's `pullRequest.state`), with **Mark done**. Nothing is marked done by
itself, since one workspace can hold several tasks.

**Files.** `client/tasks-card.tsx`, the words, `docs/office.md`.

**Tests.** Listed only for a merged pull request; Mark done.

## Left out

- **Duties started by a webhook.** The plugin SDK (0.16.2) gives a plugin RPCs, subscriptions and
  hooks, and no HTTP route.
- **Dragging cards.** Buttons work the same on every device; a drag for desktop can come later.
- **Cost of tasks in the weekly recap.** Change 7 first; the recap later, if the figure proves useful.
