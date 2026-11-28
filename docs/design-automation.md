# Design: work that comes in by itself

Eight changes after the board's tasks (`docs/design-board-tasks.md`), from a second look at Multica
and a look at T3 Code. The board now carries a task from To do to Done with its result. What is
missing is the way in and the brake: issues do not reach the board by themselves, nothing asks
before spending a plan on them, and the owner hears about a blocked task only with the office
open. Each change is its own branch and pull request against `main`, in this order.

Three facts about the plugin shape every change here (checked in the code, 2026-11-28):

- **A plugin takes no web request.** The SDK gives RPCs from Paseo's own clients, hooks and
  settings. So everything from outside is fetched: a poll, never a webhook.
- **The office's own timers need the Paseo API**, which reaches a plugin only on a handler or a
  hook. After a daemon restart a run waits until an office is opened or an agent opens or ends a
  turn (`docs/office.md`, "Schedules"). The plan's limits are read on the server only with **Keep
  watching** on (`server/plan-watch.ts`, every 5 minutes).
- **A secret is not a setting.** Settings are readable by clients. A token is kept as the Jira and
  Sentry tokens are: a file only the host's user reads, or the host's environment, written through
  an RPC that never sends it back (`server/tracker-credentials.ts`).

## 1. A backlog

**Problem.** Every open lobby task is handed to the next idle agent at once. There is no place for
work that is known and not yet wanted.

**Change.** A lobby task can be held back: `office_post` takes `backlog: true`, and the form has
**Add to backlog**. A held task is `open` with `backlog` on the post; the pickup passes over it and
an agent cannot claim it ("in the backlog"); the owner can. The kanban gets a **Backlog** column,
first on the left; the list a folded Backlog section. **Start** on a card clears the mark, and the
task is handed out by the rules it already has (its agent, its team, what it waits on). A reopened
task does not go back to the backlog.

## 2. A gate for starting by itself

**Problem.** Starting backlog work by hand does not scale, and starting all of it spends the plan.

**Change.** Host settings under Automation, all off or empty at first:

- **Start backlog tasks** (off). On, the office starts the oldest backlog task when all of these
  hold, and says in the lobby which one stopped it when one does not:
  - every limit of every provider in use is under **Start under** (70%);
  - fewer than **At once** (3) lobby tasks are claimed;
  - fewer than **Per day** (10) were started by the office today, in the notes' zone.
- A limit that cannot be read counts as over: with Keep watching off, or before the first read,
  nothing starts by itself. The setting says so beside its switch.
- **Pace.** The plan pill adds "at this pace out by Thu 14:00" when the last two readings put a
  limit over 100% before its reset. It is a line, not a rule of the gate.

The gate only ever starts backlog tasks. A task posted to To do is handed out as today.

## 3. Jira issues on the board

**Problem.** The Jira connection only rings the incident alarm for new bugs. A ticket becomes a
lobby task by hand.

**Change.** A setting **Jira intake**: a JQL of the owner's own, and Backlog (the default) or To
do as where a ticket lands. Every 10 minutes, with the connection the office already has, the
office reads the tickets the JQL matches, at most 20 a run, and posts each one it has not seen as
a lobby task: `KEY summary`, the link, the description's first 1,000 characters. The post carries
`source: { kind: "jira", key, url }`, shown as a chip that opens the ticket.

- A ticket is posted once. The keys seen are kept in `<PASEO_HOME>/office/intake.json`, so a task
  the owner deletes does not come back.
- With 50 imported tasks open or in the backlog, the intake waits.
- The ticket's text is the task's text and is cut and indented like any post. It is other
  people's words reaching an agent's prompt: the setting says so, and Backlog is the default so
  that the owner reads a ticket before an agent does.
- **Write back** (off): when the task is done, a comment on the ticket with the result. It needs a
  token that may comment; nothing else is written and no ticket is moved.

## 4. GitHub issues on the board

**Change.** The same for GitHub, through the host's `gh` CLI as CloudWatch goes through `aws`: the
office holds no GitHub token. A setting names the repositories and a search (`label:agent
is:open`); `gh issue list --json` is run with a timeout and an output limit, no shell. The post
carries `source: { kind: "github", key: "owner/repo#12", url }`. Seen issues, the limits and the
write back (a comment through `gh issue comment`, off) are as for Jira.

## 5. The office in Telegram

**Problem.** A blocked task waits until the owner opens the office. The webhook the office has
(`notifyUrl`) only sends, and nothing can answer through it.

**Change.** A Telegram bot the owner makes: its token kept as a tracker's is (or
`TELEGRAM_BOT_TOKEN`), a chat, and the Telegram user ids that may speak to it. The office calls
Telegram; Telegram never calls the office (`getUpdates`, a long poll).

- **Out**, each its own switch: a task needs you (with the question), a claim stalled, a task done
  (with its result), an incident, a plan warning. The notices the webhook gets today go here too.
- **In**, from the listed user ids only:
  - a reply to a "needs you" message is the answer: it is posted under that task as the owner's
    reply, which unblocks the task and wakes its agent;
  - `/task <text>` posts a lobby task, to the backlog unless the setting says To do;
  - `/board` lists what is in progress, blocked and waiting.
- Anything from another user id is dropped and counted, its text never logged. The list is the
  security line: a message that reaches an agent can make it run commands with its permissions.
- The team chat is not mirrored in this change. Slack, by Socket Mode, would be a second bridge
  of the same shape and is left for later.

## 6. Checkpoints

**Problem.** Undo last turn (`server/undo-turn.ts`) keeps one turn, in memory, and puts back only
files an edit or write tool touched: what a shell command changed stays. Nothing shows what a turn
changed.

**Change.** The snapshots it already takes before and after a turn (tree objects made through a
copy of the index: no ref, the real index untouched) are kept for the last 10 turns of each agent.

- **What this turn changed**: in the session's panel, the files between a turn's two trees, with
  added and removed lines (`git diff-tree`). It includes what a shell command changed.
- **Undo** steps back turn by turn, newest first, by the rule it has now: a file changed since the
  turn is skipped and said.
- Still off by default, in a git work tree only, and in memory: a daemon restart forgets the
  checkpoints.

## 7. Hand a task over

**Problem.** When a provider's plan is used up, the tasks its agents hold wait for the reset. The
agent cannot even be asked for a note: it has no turn left.

**Change.** **Hand over** on a claimed task, in the board and the Tasks card. The office reads the
holder's last answer from its timeline (up to 1,200 characters, as the chat does), posts it under
the task as "Where <agent> left it", and reopens the task marked `notProvider`, so the pickup
gives it to an agent of another provider. An assignment's prompt gains a **So far** block: the
replies under the task, cut like the results it waited on, and labelled as reports, not
instructions.

- **Hand over when a plan runs out** (off): the office does it by itself for the tasks held by a
  provider whose closest limit reads Out.
- With no agent of another provider idle, the task waits in To do like any other.

## 8. A tour of a pull request

**Change.** **Explain** in the Reviews card posts a note to an idle agent of the team, as "Ask for
a review" does: its first line starts with `Tour request:`. The agent answers with the files in
the order to read them and why each changed, and the card shows that answer as the tour. The
office reads the pull request's head branch from the descriptor (it drops it today), and the card
draws pull requests whose base is another's head as one stack, in merge order.

## Left out

- **Slack**, and mirroring the team chat: after Telegram has been used for a while.
- **A door for outside assistants** (an MCP endpoint with sign-in, events, webhooks) and **pointing
  at a page** for an agent: both are Paseo's, not a plugin's.
- **Moving tickets** in Jira or closing GitHub issues: a comment is the only write.
- **Rebase the stack** and **Merge the stack** as buttons: the card shows the order, and an agent
  can be asked.

## The owner's choices

These are set as written above unless said otherwise:

1. The gate's starting values: under 70%, 3 at once, 10 a day.
2. Imported tickets land in the Backlog, and write back is off.
3. Telegram first, Slack later; the team chat is not mirrored.
4. Checkpoints stay in memory and off by default.
5. Handing over by itself when a plan runs out is off.
