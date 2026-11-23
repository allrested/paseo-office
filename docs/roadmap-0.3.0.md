# Roadmap to 0.3.0

0.3.0 brings the rest of upstream my-office (v0.6.0, the commit this port is built from) to Paseo.
It is developed as six versions, each one group of features. Every version is published to npm
and the registry when it is done, so it can be tried on a phone. 0.2.9 holds the fixes found on
the way, and 0.3.0 is the release.

| Version | Group                                                  |
| ------- | ------------------------------------------------------ |
| 0.2.3   | Stand-up writer mode, team name, sub-agents walking in |
| 0.2.4   | Out of Claude, the plan pill, and the small things     |
| 0.2.5   | Timeline and replay, weekly recap                      |
| 0.2.6   | History vault, weekly prompt report                    |
| 0.2.7   | What upstream builds on Claude Code hooks              |
| 0.2.8   | Plan and machine tools                                 |
| 0.2.9   | Fixes                                                  |
| 0.3.0   | The release                                            |

Each version gets its own design before any code, one pull request per feature, and a look on a
phone before it is published. `docs/plan-0.2.3.md` is the first of those designs.

## What differs from upstream

Upstream reads Claude Code directly, on one Mac. This port runs in a Paseo daemon, often a Linux
container, beside several providers. A feature is rebuilt on what Paseo gives a plugin, so some
arrive in another form and three are left out.

## 0.2.3

`docs/plan-0.2.3.md`, with one change: a sub-agent is not a stand-in the port draws itself. The
scene already has upstream's own sub-agents (`spawnSub` on a `substart` event: in through the
door, a brief from the boss, work, a report, and out), and the plugin sends it none today
(`subs: []` in `client/world/adapter.ts`). The running `Agent` and `Task` calls the office reads
from a parent's timeline become those events.

## 0.2.4

- **Out of Claude.** The scene's `life/quota.js` is loaded and never told anything. It gets the
  account's limits from Paseo's provider usage (`paseo.providers.listUsage()`): when a window is
  used up, the people on that provider take their break and the wall board counts down to the
  reset.
- **The plan pill.** The closest limit of each provider in use, with the warnings at 80% and 95%.
- **Small things.** A streamer mode switch (the scene always runs in it today), the graphics
  level in the settings, and the owner's sticky notes on the whiteboard.

## 0.2.5

- **Timeline and replay.** A lane per session, replayed at up to 120 times the speed. Upstream's
  server keeps the events; here the office's server keeps what its 5-second reads see, so a replay
  holds what the office saw while it ran, not what happened before it started.
- **Weekly recap.** The week's card: hours, prompts, edits, commands, cost, the busiest team.

## 0.2.6

- **History vault.** What was said in each conversation, kept on the host and searchable, read
  from the agents' timelines. Upstream reads Claude Code's transcripts; this reads every
  provider's through Paseo.
- **Weekly prompt report.** The week's prompts against the prompt helper's rules, worked out on
  the host with no model.

## 0.2.7

Upstream does these with Claude Code hooks. Paseo gives a plugin its own events (a permission
asked, a turn ended, a session opened) and the timelines, which cover most of them for every
provider.

From Paseo's events and timelines:

- A stuck loop is found (the same call and the same error three times) and gets a card in the
  team chat with Stop and Send a hint.
- Two sessions about to edit one file, and a port another session's server holds, are said in
  the chat and to the agent.
- A call auto mode refused gets a card with the command and the reason.
- "Fix it" when a workspace's checks go red.
- Pinned notes, said again to a conversation after it is compacted.

Only with real Claude Code hooks, written into `~/.claude/settings.json` on the host:

- Blocking the fourth identical failing call before it runs.
- Undo last turn, which copies a file before each edit.

These two are off until the owner turns them on, since the plugin then changes Claude Code's own
settings, and they work for Claude only.

## 0.2.8

- **What eats your plan**, from the cost and tokens Paseo reports per agent. Less detailed than
  upstream's, which reads Claude Code's own telemetry.
- **Forgotten work**: worktrees and checkouts with uncommitted files, unpushed commits or a
  stash.
- **Models for sub-agents**: the coordinator's model and the one its sub-agents run on.
- **The cache clock**: the cup whose steam fades as a resting session's prompt cache cools,
  estimated from the end of its last turn.
- **Accounts.** Each account's limits show beside the plan pill. Switching accounts stays with
  the `account-switcher` plugin, which the office links to; the office handles no sign-in.

## Left out

- **The Mac menu bar app** and **the editor's side-bar panel**: both are installed on the machine
  Claude Code runs on, and a daemon in a container has neither.
- **Phones**: the PIN, the tunnel, push notifications, giving work and cutting in. Paseo's own
  app does these.
