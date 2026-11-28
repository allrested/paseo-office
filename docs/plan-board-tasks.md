# Board Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lobby's board becomes a kanban, and a task gains a result, replies, a "needs you"
mark, a team, tasks it waits on, its time and cost; stale claims reopen, duties get a time, and a
merged pull request offers Mark done.

**Architecture:** Every change is additive. A post gains optional fields (`shared/contracts.ts`),
the board service (`server/board-service.ts`) enforces the rules in its one save queue, the three
agent tools (`server/agent-tools.ts`) take optional inputs, and the pickup (`server/lobby-pickup.ts`)
learns teams and waiting. On the client a pure model decides columns and attention rows; components
draw them in both layouts.

**Tech Stack:** TypeScript, zod 4, vitest (jsdom for `*.mounted.test.tsx`), react-native-web,
`@getpaseo/plugin` 0.16.2, oxlint, oxfmt.

**Spec:** `docs/design-board-tasks.md` (read it first; this plan argues from it).

## Global Constraints

- Work in `/workspace/M-DAQ/utils/paseo-office-tasks`. One branch per change, each from the one
  before: `feat/board-kanban` (has the design and this plan), `feat/task-results`,
  `feat/task-blocked`, `feat/task-stale-claims`, `feat/task-teams`, `feat/task-after`,
  `feat/task-cost`, `feat/duty-times`, `feat/task-pr-merged`.
- Commits: plain messages in the repo's style (`feat: …`, `fix: …`, `docs: …`), **no**
  `Co-authored-by` or "Generated with" (a local hook refuses them). Never push and never open a
  pull request: the owner is asked first.
- After each task: `npx vitest run <the task's test files>`, then `npm run typecheck && npm run lint`
  pass. Before a branch is finished: the whole `npx vitest run` passes and
  `npx oxfmt --check <touched files>` is clean (run `npx oxfmt <touched files>`, never the whole tree).
- Every new post field is optional; `boards.json` stays `version: 1`. Agent tool inputs only gain
  optional fields; existing calls behave exactly as before.
- Limits: a result, a reason and a reply are trimmed and at most `POST_TEXT_MAX` (2,000) characters;
  `after` holds at most `AFTER_MAX` = 5 ids; a stall is `STALL_MS` = 120,000 ms; a duty time is
  `HH:MM` from `08:00` to `23:59`, default `08:00`.
- Every new interface text is English in the component and has an entry in
  `shared/ui-words-id.ts`, `shared/ui-words-vi.ts` and `shared/ui-words-th.ts` (text with a value in
  it goes in the matching `shared/ui-patterns-*.ts`). Look at `client/ui-language.test.ts` for the
  check that enforces it.
- Touch targets at least 44 px high. No drag and drop.
- Match each file's comment voice (short, plain sentences saying why); do not reformat neighbouring
  code.
- `docs/office.md` describes each change in its "Boards and wakes" section (or "The duty board",
  "Settings"); the CHANGELOG is written at release, not per branch.

## File Structure

- `shared/contracts.ts`: `PostSchema` fields, `UpdateActionSchema` gains `block`, `DutySchema.time`,
  `AFTER_MAX`, the RPC inputs that gain fields.
- `shared/settings.ts`: `officeBoardsSettings` (`office-boards`, device scope).
- `shared/lobby-assignment.ts`: footer v2, both footers recognised.
- `server/board-service.ts`: the rules (results, replies, block, release, team, after, cost).
- `server/agent-tools.ts`: tool inputs and the read lines.
- `server/lobby-pickup.ts`: team and waiting, results in the prompt.
- `server/office.ts`: ports (team lookup, cost), `agentGone` releases, reply wakes.
- `server/mention-queue.ts`: a reply's wake prompt names its task.
- `server/duty-service.ts`, `server/local-schedules.ts`: duty times.
- `client/kanban-model.ts` (new, pure): columns.
- `client/board-kanban.tsx` (new): the kanban layout.
- `client/task-card.tsx` (new): one task with its details, thread and actions, used by both layouts.
- `client/task-attention.ts` (new, pure), `client/use-task-attention.ts` (new),
  `client/tasks-card.tsx` (new): the Attention tab's Tasks card.
- `client/lobby-board.tsx`, `client/board-sheet.tsx`, `client/use-board-actions.ts`,
  `client/agent-picker.tsx`, `client/office-surface.tsx`, the duty editor (`client/duty-sheet.tsx`),
  the settings page: wiring.

---

## Change 1: the lobby as a kanban (branch `feat/board-kanban`)

### Task 1.1: the column model

**Files:**

- Create: `client/kanban-model.ts`
- Test: `client/kanban-model.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type KanbanColumnId = "waiting" | "todo" | "progress" | "needs" | "done" | "notes";
  export interface KanbanColumn {
    id: KanbanColumnId;
    title: string;
    posts: Post[];
  }
  /** The column a post belongs in. `posts` is the whole board (later changes read it). */
  export function columnOf(post: Post, posts: readonly Post[]): KanbanColumnId;
  /** The board's columns in order; empty ones left out except To do and In progress. */
  export function kanbanColumns(posts: readonly Post[]): KanbanColumn[];
  export const KANBAN_WIDE = 720;
  export function kanbanWide(width: number): boolean; // width >= KANBAN_WIDE
  ```

  Titles: `"Waiting"`, `"To do"`, `"In progress"`, `"Needs you"`, `"Done"`, `"Notes"`.
  In this change only `todo` (task open), `progress` (task claimed), `done` (task done) and
  `notes` (note) occur. Posts keep board order (seq) inside a column.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { Post } from "../shared/contracts.js";
import { columnOf, kanbanColumns, kanbanWide } from "./kanban-model.js";

const post = (id: string, extra: Partial<Post> = {}): Post => ({
  id,
  seq: Number(id.slice(1)),
  board: "lobby",
  kind: "task",
  text: id,
  author: "user",
  state: "open",
  createdAt: "2026-11-28T00:00:00.000Z",
  updatedAt: "2026-11-28T00:00:00.000Z",
  ...extra,
});

describe("kanban columns", () => {
  it("puts each kind of post in its column", () => {
    const posts = [
      post("p1"),
      post("p2", { state: "claimed", claimedBy: "a1" }),
      post("p3", { state: "done" }),
      post("p4", { kind: "note", state: undefined }),
    ];
    expect(posts.map((p) => columnOf(p, posts))).toEqual(["todo", "progress", "done", "notes"]);
  });
  it("keeps To do and In progress when empty and drops other empty columns", () => {
    expect(kanbanColumns([]).map((c) => c.id)).toEqual(["todo", "progress"]);
    expect(kanbanColumns([post("p3", { state: "done" })]).map((c) => c.id)).toEqual([
      "todo",
      "progress",
      "done",
    ]);
  });
  it("keeps board order inside a column", () => {
    const columns = kanbanColumns([post("p9"), post("p2")]);
    expect(columns[0]?.posts.map((p) => p.id)).toEqual(["p2", "p9"]);
  });
  it("is wide from 720", () => {
    expect([kanbanWide(719), kanbanWide(720)]).toEqual([false, true]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**: `npx vitest run client/kanban-model.test.ts` — fails, module not found.
- [ ] **Step 3: Implement** `client/kanban-model.ts` to the interface above (a fixed order array,
      `columnOf` by kind and state, sort by `seq`).
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit** `feat: a model of the board's kanban columns`.

### Task 1.2: the board layout setting

**Files:**

- Modify: `shared/settings.ts` (after `officeLanguageSettings`)
- Modify: the settings page that draws the device choices (find it with
  `grep -rn "officeLanguageSettings\|graphics" client/*settings*.tsx client/host-*.tsx`)
- Test: `shared/settings.test.ts` (or the file testing `officeLanguageSettings`), the settings
  page's mounted test.

**Interfaces:**

- Produces:
  ```ts
  export const BOARD_LAYOUTS = ["kanban", "list"] as const;
  export type BoardLayout = (typeof BOARD_LAYOUTS)[number];
  /** Per device: how the lobby's board and the rooms' boards are laid out. A setting of its own, as
   * the column's is: the view's and the incidents' saves write `office-device` whole. */
  export const officeBoardsSettings = defineSettings({
    id: "office-boards",
    scope: "device",
    version: 1,
    schema: z.object({
      lobby: z.enum(BOARD_LAYOUTS).default("kanban"),
      rooms: z.enum(BOARD_LAYOUTS).default("list"),
    }),
  });
  ```
  A hook `useBoardLayouts(): { lobby: BoardLayout; rooms: BoardLayout }` in
  `client/use-board-layouts.ts`, read the way `client/use-column.ts` reads `office-column`.
- Settings page: a **Boards** section with two choices, "Lobby board" (Kanban, List) and "Room
  boards" (List, Kanban), saved whole.

- [ ] Steps: failing tests (defaults `{ lobby: "kanban", rooms: "list" }`; a saved value read back;
      the section draws both choices and saves the picked one), see them fail, implement, see them
      pass, commit `feat: a device setting lays the lobby's and the rooms' boards out as a kanban or a list`.

### Task 1.3: the kanban layout

**Files:**

- Create: `client/task-card.tsx` (lift `TodoRow` and `DeleteQuestion` out of
  `client/lobby-board.tsx` unchanged and export them as `TaskCard` and `DeleteQuestion`; the list
  keeps using them)
- Create: `client/board-kanban.tsx`
- Modify: `client/lobby-board.tsx` (`LobbyBody` draws `KanbanBoard` when `layout === "kanban"`),
  `client/board-sheet.tsx` (`SheetBody` for a room draws `KanbanBoard` when the rooms' layout is
  kanban), `client/styles.ts` (column styles)
- Test: `client/board-kanban.mounted.test.tsx`, existing `client/board-sheet.mounted.test.tsx`

**Interfaces:**

- Consumes: `kanbanColumns`, `kanbanWide` (Task 1.1), `useBoardLayouts` (Task 1.2), `TaskCard`.
- Produces:

  ```ts
  export interface KanbanBoardProps {
    posts: readonly Post[];
    name(author: string): string;
    actions: BoardActions;
    styles: OfficeStyles;
  }
  export function KanbanBoard(props: KanbanBoardProps): JSX.Element;
  ```

  It measures its own width with `onLayout` (width 0 until measured counts as narrow). Wide: a
  horizontal `ScrollView` of columns, each column a fixed 280 px wide `View` with its heading
  ("To do · 3") and its cards. Narrow: the columns stacked, each heading a button that folds and
  unfolds it; Done starts folded. A task card is `TaskCard`; a note is `PostWithActions`. The
  lobby's "Clear finished" stays in the Done column's heading.

- [ ] Steps: failing mounted tests — the lobby in kanban draws the column headings with counts and
      each post under its column; narrow stacks them with Done folded and a press unfolds it; the
      list layout still draws today's list; a room with `rooms: "kanban"` draws columns. See them
      fail, implement, see them pass. Add the new words (`"To do"`, `"In progress"`, `"Done"`,
      `"Notes"`, `"Waiting"`, `"Needs you"`, `"Boards"`, `"Lobby board"`, `"Room boards"`, `"Kanban"`,
      `"List"`, and the count heading pattern) to the three word tables. Document in `docs/office.md`
      ("Boards and wakes", "Settings"). Commit `feat: the lobby's board is a kanban`.

---

## Change 2: results and replies (branch `feat/task-results`)

### Task 2.1: results and replies on the server

**Files:**

- Modify: `shared/contracts.ts`, `server/board-service.ts`, `server/office.ts`,
  `server/mention-queue.ts`
- Test: `server/board-service.test.ts`, `server/office.test.ts`, `server/mention-queue.test.ts`

**Interfaces:**

- Produces (contracts): `PostSchema` gains `result: z.string().optional()` and
  `replyTo: z.string().optional()`. `postRpc` input gains `replyTo: z.string().min(1).optional()`;
  `updateRpc` input gains `note: z.string().max(POST_TEXT_MAX).optional()`.
- Produces (service): `NewPost.replyTo?: string`; `PostUpdate.note?: string`.
- Rules:
  - `done` with a non-empty trimmed `note` sets `result`; a linked partner gets the same `result`
    when it is marked done with it. Without `note` nothing is set.
  - A post with `replyTo` is always `kind: "note"` and goes on its root task's board: follow
    `replyTo` while the target is itself a reply, then a copy's `link` to its lobby task. The root
    must exist and be a task, else `Unable to post: no task <id>`.
  - The reply's `to` is set to the root's `claimedBy` when that is an agent other than the
    author, so `office.mentioned` wakes it through the mention queue unchanged. A reply by the
    holder, or to an unclaimed task, gets no `to`.
  - `commit` drops every note whose `replyTo` names a post that is gone (beside `withoutDeadLinks`),
    so delete, clear and prune take a task's replies with it.
  - `withoutClaim` (reopen) drops `result`.
  - The mention queue's prompt for a post with `replyTo` says it is a reply to that task, e.g.
    `Reply to task p12 from the user: …` (keep the existing prompt shape otherwise; the queue item
    gains `replyTo?: string`).
  - `checkCompletion` (office.ts): when the completion line finishes a claim, the reply's text
    before that line, trimmed and cut to 2,000 characters, becomes the result (empty: none).
    `finishLobbyClaim(claim, result?)` passes it as the `done` note.

- [ ] Steps: one failing test per rule above (`board-service.test.ts` uses the fake store and clock
      already there — follow an existing `describe` block), see each fail, implement, see it pass,
      commit `feat: a done task keeps its result, and a reply sits under its task and wakes its holder`.

### Task 2.2: the tools and the footer

**Files:**

- Modify: `server/agent-tools.ts`, `shared/lobby-assignment.ts`
- Test: `server/agent-tools.test.ts`, `shared/lobby-assignment.test.ts`

**Interfaces:**

- `PostInputSchema` gains `replyTo: z.string().min(1).optional()`; `UpdateInputSchema` gains
  `note: z.string().min(1).max(POST_TEXT_MAX).optional()`. Descriptions:
  - `office_post`: `"Post a task or note to your workspace's office board (or board: lobby). Set to to an agent id from list_agents to wake it with the post. Set replyTo to a task id to reply under that task; its holder gets the reply."`
  - `office_update`: `"Claim, finish (done) or reopen a task or a duty on an office board (the duty board too), by post id. With done, put the outcome in note."`
- `postLine`: a reply reads `p14 note re p12, from …: …`; a result adds a line `  result: …`
  (indented like the text).
- Footer v2 (`assignmentFooter`):

  ```
  Work on this task. When it is complete, use office_update with id "<id>", action "done" and a short result in note. If you need input, leave it claimed and explain what you need.
  If the tool is unavailable and you have finished, put this exact line at the end of your reply: <completionLine>
  ```

  `readLobbyAssignment` accepts the v2 footer and the v1 footer (today's exact text). Keep v1 as
  `LEGACY_FOOTERS` and test both.

- [ ] Steps: failing tests (schemas take the fields; reply placement through the tool; result line
      in read; both footers parse; v2 is what a new assignment carries), implement, pass, commit
      `feat: the board tools take a result and a reply`.

### Task 2.3: results and threads on the board

**Files:**

- Modify: `client/task-card.tsx`, `client/board-text.ts`, `client/kanban-model.ts`,
  `client/use-board-actions.ts`, `client/board-sheet.tsx`, the word tables, `docs/office.md`
- Test: `client/board-text.test.ts`, `client/kanban-model.test.ts`, `client/task-card.mounted.test.tsx`

**Interfaces:**

- `BoardActions.reply(task: Post, text: string): Promise<void>` (posts `{ board: task.board, kind:
"note", text, replyTo: task.id }`).
- `export function repliesOf(task: Post, posts: readonly Post[]): Post[]` in `board-text.ts`
  (notes with `replyTo === task.id`, seq order).
- `kanbanColumns` and the list leave replies out of the top level (a note with `replyTo` is never
  in `notes`).
- `TaskCard` shows the result under the text ("Result: …", three lines, the rest behind "More"),
  the replies under it (author · text), and a "Reply" field with Send, in both layouts.

- [ ] Steps: failing tests (repliesOf; replies not in Notes; result and thread drawn; Reply posts
      with `replyTo`), implement, pass, words, docs, commit `feat: a task on the board shows its result and its replies`.

---

## Change 3: needs you (branch `feat/task-blocked`)

### Task 3.1: block on the server and in the tools

**Files:** `shared/contracts.ts`, `server/board-service.ts`, `server/agent-tools.ts`,
`shared/lobby-assignment.ts` and their tests.

**Interfaces / rules:**

- `UpdateActionSchema = z.enum(["claim", "done", "reopen", "block"])`; `VERBS.block = "block"`.
- `PostSchema` gains `blocked: z.string().optional()` (the reason).
- `block` needs a non-empty `note` (`Unable to block p12: say what you need in note`), a task
  claimed by the actor (`claim it first` / `claimed by …`); the user does not block (`refuse`).
  It sets `blocked` to the trimmed note; the linked partner gets the same mark.
- `blocked` is cleared by the holder's `claim`, `done` and `reopen`, by any reopen, and by a reply
  (Task 2.1's reply path) from anyone but the holder, in the same save as the reply, mirrored to
  the partner.
- `postLine` adds `  needs: <reason>`.
- Footer v3: the second sentence becomes `If you need input, use office_update with action "block" and say what you need in note; the answer comes back as a prompt.` v1 and v2 stay recognised.
- `office_update` description adds `Block it with note when you need input from the user.`

- [ ] Steps: failing tests per rule, implement, pass, commit `feat: an agent can block its task with what it needs`.

### Task 3.2: the Tasks card and the Needs you column

**Files:**

- Create: `client/task-attention.ts`, `client/use-task-attention.ts`, `client/tasks-card.tsx`
- Modify: `client/office-surface.tsx` (wire like `useReviews` near line 2066), `client/kanban-model.ts`
  (`needs` column: claimed with `blocked`), `client/task-card.tsx` ("Needs you: <reason>" badge),
  words, `docs/office.md`
- Test: `client/task-attention.test.ts`, `client/tasks-card.mounted.test.tsx`, `client/kanban-model.test.ts`

**Interfaces:**

```ts
export type TaskAttentionKind = "blocked"; // Change 4 adds "stalled", Change 9 "merged"
export interface TaskAttentionRow {
  kind: TaskAttentionKind;
  post: Post;
  board: string;
  holder: string | null;
  reason: string | null;
}
/** Rows across every board of the model, blocked first, oldest first. */
export function taskAttentionRows(model: OfficeModel, now: number): TaskAttentionRow[];
export function taskAttentionNote(rows: readonly TaskAttentionRow[]): string | null; // "2 need you"
```

The card lists each row with the task, its holder, the reason and an Answer field (posts a reply
with `BoardActions.reply`), and "Open board". The strip entry counts in the Attention count (check
how `StripCard` marks an informing card and do not mark this one).

- [ ] Steps: failing tests, implement, pass, words, docs, commit `feat: blocked tasks show in a Tasks card and a Needs you column`.

---

## Change 4: claims nobody works on (branch `feat/task-stale-claims`)

### Task 4.1: release on close and archive

**Files:** `server/board-service.ts` (new `releaseClaims(agentId: string): Promise<string[]>`, the ids
reopened), `server/office.ts` (`agentGone` calls it after `queue?.agentGone`), tests.

**Rules:** every task with `state === "claimed"` and `claimedBy === agentId` on any board is reopened
as the user would (a copy's lobby task is reopened through the lobby task, which deletes the copy);
one save; logged as `[office] released p12, p15 held by <agentId>`. Nothing happens for an agent
holding nothing.

- [ ] Steps: failing tests (lobby task with copy, duty, room task; nothing for others), implement,
      pass, commit `feat: an agent's claims reopen when it is closed or archived`.

### Task 4.2: stalled claims in the Tasks card

**Files:** `client/task-attention.ts`, `client/tasks-card.tsx`, words, `docs/office.md`, tests.

**Rules:** a `stalled` row is a claimed task, not blocked, whose holder is an agent of the model with
status `error`, or status `idle` while the post's `updatedAt` is at least `STALL_MS` before `now`.
Its actions: **Nudge** posts a reply with the text
`Status check: finish with office_update done and a short result, or block with what you need.`
and **Reopen** (`BoardActions.reopen`). Blocked rows first, then stalled.

- [ ] Steps: failing tests (error holder; idle holder before and after 2 minutes; running holder not
      listed; Nudge posts the reply), implement, pass, commit `feat: the Tasks card lists claims nobody works on, with Nudge and Reopen`.

---

## Change 5: tasks for a team (branch `feat/task-teams`)

### Task 5.1: team on the server

**Files:** `shared/contracts.ts` (`team: z.string().optional()`, `postRpc.team`), `server/office.ts`
(ports), `server/agent-tools.ts`, `server/board-service.ts`, `server/lobby-pickup.ts`, `index.server.ts`
(implement the ports from the roster settings and the agents' `office.roster.member` metadata with
`seatOf` from `shared/roster.ts`), tests.

**Interfaces:**

- `OfficeAgentPorts.teamOf(agentId: string): Promise<string | null>` (the roster team id of the
  agent's seat; null when the roster is off or it has none) and
  `OfficeAgentPorts.findTeam(nameOrId: string): Promise<string | null>` (id by exact id or
  case-insensitive name).
- `office_post` gains `team: z.string().min(1).optional()`; refused together with `to`
  (`Unable to post: give to or team, not both`) and for an unknown team
  (`Unable to post: no team <name>`). Only tasks take a team.
- Pickup: a task with `team` is handed out by the automatic rules (needs `enabled()`), only to a
  candidate whose `teamOf` is that id; `claimLobbyTask` refuses an agent of another team.
  `postLine` adds ` for team <name>`.

- [ ] Steps: failing tests (resolution, refusals, pickup within the team, refusal of another
      team's claim), implement, pass, commit `feat: a lobby task can go to a roster team`.

### Task 5.2: teams in the post form and on cards

**Files:** `client/agent-picker.tsx`, `client/agent-picker-text.ts`, `client/board-sheet.tsx`
(`useWakeChoice` carries a team choice as `team:<id>`), `client/lobby-board.tsx` (posts `team`),
`client/board-text.ts` (`for team <name>` in `todoMeta`), words, docs, tests.

- [ ] Steps: failing tests (the picker lists the roster's teams under Any idle agent when the
      roster is on; picking one posts `team`; a card says `for team QA-PR`), implement, pass, commit
      `feat: the lobby's form gives a task to a team`.

---

## Change 6: work that waits for work (branch `feat/task-after`)

### Task 6.1: after on the server, results in the prompt

**Files:** `shared/contracts.ts` (`after: z.array(z.string()).max(AFTER_MAX).optional()`,
`AFTER_MAX = 5`, `postRpc.after`), `server/board-service.ts`, `server/agent-tools.ts`,
`server/lobby-pickup.ts`, `server/office.ts` (`onBoard` refreshes the pickup for every board, not
only lobby and duty, since a task can wait on a room's task), tests.

**Rules:**

- `export function waitingOn(post: Post, posts: readonly Post[]): string[]` in
  `shared/board-rules.ts` (new, pure; the client reuses it): the ids in `after` that exist and are
  not done.
- At post: only tasks; ids unique, each an existing task, at most 5
  (`Unable to post: no task p99` / `Unable to post: after holds at most 5 tasks`).
- The pickup passes over a task with `waitingOn(...).length > 0`; an agent's `claim` of it is
  refused `waiting on p12`; the user's claim and done are not.
- The assignment of a task with `after` carries, after the task text and before the footer, a block:
  ```
    It waited on:
    p12: <result, or "no result given">
  ```
  each line indented two spaces like the task text, and `readLobbyAssignment` still reads the body
  (the block is part of the indented body).
- `postLine` adds ` after p12, p13` (and ` waiting` while any is not done).

- [ ] Steps: failing tests per rule, implement, pass, commit `feat: a task can wait for others and gets their results when handed out`.

### Task 6.2: Waiting column, Follow-up

**Files:** `client/kanban-model.ts` (`waiting` column for an open task with `waitingOn` non-empty),
`client/task-card.tsx` ("Waiting on p12" line, **Follow-up** button), `client/lobby-board.tsx` (the
form takes a preset `after` from Follow-up and shows "After p12" with a clear button), words, docs,
tests.

- [ ] Steps: failing tests (column, line, Follow-up sets the form, posting carries `after`),
      implement, pass, commit `feat: the board shows what waits, and Follow-up posts a task after another`.

---

## Change 7: time and cost of a task (branch `feat/task-cost`)

### Task 7.1

**Files:** `shared/contracts.ts` (`claimedAt`, `doneAt`: `z.string().optional()`; `costAtClaim`,
`spentUsd`: `z.number().nonnegative().optional()`), `server/board-service.ts`
(`BoardServicePorts.costOf(agentId: string): number | undefined`), `server/office.ts` +
`index.server.ts` (from the directory's agent `costUsd`), `client/board-text.ts`
(`export function taskSpent(post: Post): string | null` — `"took 23 min · $0.42"`, `"took 23 min"`,
`"took 1 h 5 min"`, null when not done or no `claimedAt`), `client/task-card.tsx`, words, docs, tests.

**Rules:** a claim by an agent sets `claimedAt` and `costAtClaim` (when known); done sets `doneAt`
and `spentUsd = costOf(holder) - costAtClaim` when both known and not negative; reopen drops all four.

- [ ] Steps: failing tests, implement, pass, commit `feat: a done task says what it took`.

---

## Change 8: a time for each duty (branch `feat/duty-times`)

### Task 8.1

**Files:** `shared/contracts.ts` (`DutySchema.time: z.string().regex(/^(0[89]|1\d|2[0-3]):[0-5]\d$/).optional()`,
`DutyDraftSchema.time` the same), `server/duty-service.ts` (`dutyDueMinute(duty)`; a duty is due on
its board day when the zone's minute of day is at least its time; `dutyCadence` becomes one cron
per distinct time, `0 8 * * *` always among them), `server/local-schedules.ts` (several cadences for
the duty run), the duty editor (`client/duty-sheet.tsx`: a time field per duty, `HH:MM`, 08:00
placeholder), words, docs, tests.

- [ ] Steps: failing tests (due before and after its time; 08:00 default; the cadences for times
      08:00, 13:30, 13:30 are `0 8 * * *` and `30 13 * * *`; the editor saves a time and refuses 07:00),
      implement, pass, commit `feat: each duty has a time of day`.

---

## Change 9: a merged pull request (branch `feat/task-pr-merged`)

### Task 9.1

**Files:** `client/task-attention.ts` (`merged` rows: a claimed task whose holder's room has
`workspace.pullRequest.state === "merged"`), `client/tasks-card.tsx` (**Mark done**), words, docs, tests.

- [ ] Steps: failing tests (listed only when merged; Mark done calls `markDone`), implement, pass,
      commit `feat: the Tasks card offers Mark done when a task's pull request is merged`.
