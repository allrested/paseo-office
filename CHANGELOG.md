# Changelog

Versions are the npm package `paseo-office`. Dates are the day the version was published.

## Unreleased

- **Keep watching** now covers the plan limits and the host's memory for the webhook. The plan
  limits are read every 5 minutes with no office open, and a provider's closest limit sends one
  message as it reaches 80%, 95% and 100%, once until it resets; a provider switched off in the Host
  card stays out. The host is read every minute with no office open (Linux), so the Host card's
  30-minute RAM and CPU history has no gap, and memory at 90%, the Host card's red, sends one
  message until it is back under 80%. **Notify for** keeps its two choices: a plan limit used up and
  memory nearly full are danger, the 80% and 95% messages are warnings. The weather and the
  street's checks still run only while an office is open.
- A session's reply box can attach images on the web, with the team chat's own button and limit of
  four. They go with the reply, a running turn included, and are kept with the typed text until it
  is sent or the tab is closed. Other files still go through **Open in workspace**.
- With **Gen-UI cards** on, an `app` block of the Generative UI plugin is drawn live in a
  session's chat in a browser or the desktop app: the agent's HTML page runs in a frame that can
  run script and nothing else, with no network, under the block's title. A `ui` block, an `app`
  block still being written, and any block on a phone stay a title card.
- The Host card works on **macOS**: memory, CPU, swap, disk, load and the largest process groups
  are read from the Mac's own commands. A Mac cannot say which process an agent started, so the
  card lists no agent, marks nothing as left running and offers no clean-up there. Linux is
  unchanged, and Windows still has no local reading.
- Stand-up notes: a daemon that restarts after 08:00 on a stand-up day, with no entry for the day
  in the notes yet, now writes it when the office starts, as soon as the Paseo API is there. A
  run due on one day that could only start on the next is still dropped. Before, the day's entry
  was never written.
- **Undo last turn**, a host setting, off by default: with it on, a session whose last turn
  edited or wrote files has **Undo last turn**, which puts those files back as they were when the
  turn began (a file the turn made is deleted) after asking, and says how many it restored and
  why it left any. It uses git and Paseo's turn hooks, so it works for every provider. A file
  changed since the turn, a path git ignores or one outside the repository is left alone; a
  change a shell command made is not undone. One turn is kept, in memory. The office writes git
  objects into the repositories agents work in while it is on.
- The team chat has **Jump to latest**: scroll up and a button in the corner of the list goes to
  the newest message, with the count of what arrived since. Sending a message also goes to the
  newest one, wherever you were reading.
- **Clear chat**, under the team chat's More actions, removes every message and the pin for
  everyone, after asking. It cannot be undone.
- The History vault is a folder, `office/vault/`, with a file per conversation, and the timeline
  is `office/timeline.jsonl`, a line per mark. A change writes one conversation, or adds lines to
  the timeline, where 0.2.14 wrote the whole file again. The `vault.json` and `timeline.json` of
  an earlier version are taken over when the office first starts, and then removed.
- **Keep watching**, a host setting, off by default: the office goes on reading the agents with
  no office open, every 15 seconds, so the Timeline, This week, the History vault and what the
  office notices have no gaps for the hours nobody looked.
- **Webhook address**, a host setting under Services: the office posts a JSON message there
  when it raises an alert (a loop, a refused call, two agents in one file, a taken port, failing
  checks) or opens an incident, so the owner hears of it with no office open. **Send a test**
  tries the address. By default only a loop and an incident are sent; **Notify for** adds the
  warnings.
- A room's board opened from the lobby's board has **Back to Lobby board**, so the lobby's is one
  press away and the dialog need not be closed first.
- Incidents: each one on the card has **Analyze**, which opens the New agent form with the
  incident as its first prompt, and **Add to lobby**, which posts it as a lobby task for an idle
  agent to pick up.
- Incidents: one resolved in Jira or Sentry closes at the next check. **Jira issue types** names
  the types that ring (Bug when empty). A Jira project key that does not exist, or that the token
  cannot see, is now a problem on the card and no longer silent.
- A session whose runtime Paseo closed, and that is not archived, stays in the office as an agent
  **At home**: the Sessions list keeps it, a reply brings it back, and a lobby task or a duty
  goes to it when no idle agent is free. Before, such sessions were not shown at all, and a task
  waited for a working agent to finish.
- A plan and a question are answered in the office's session panel: the plan's text with its
  actions and a line of what to change, the question as its form. Before, both sent you to the
  workspace.
- The 2D floor: an open incident shows as a banner over the floor that opens the Incidents card,
  roster teams sit together as on the 3D floor, and a desk says when its agent has the
  provider's own sub-agents at work.
- The office's own interface speaks Indonesian when the 3D office language is Bahasa Indonesia,
  and English when it is English: buttons, fields with their hints and placeholders, switches,
  dialogs, cards, the settings page, and the lines built from data (ages, counts, an agent's
  activity, a failure up to the host's own reason).
- Timeline: **Replay on the floor** replays the chosen range on the 3D floor. Its bar says the
  day and the time shown and who is on the floor, and has a track to jump along, ten minutes
  back or on, the speed (10× to 600×), Pause and Back to now. Before, a replay moved only inside
  the card.
- **Stop repeated failing calls**, a host setting, off by default: a request for the very call
  that just failed three times running is refused, and the agent is told why. Only where the
  provider asks permission for the call. Where it asks nothing, the office sends the agent a hint
  into its turn, and stops the turn if the same call fails again, on a host that can stop a turn;
  the webhook says when it did. A loop is seen within 5 seconds (15 with Keep watching and no
  office open).
- The session panel: open session tabs come back after a reload; typing `/` lists the session's
  slash commands; and **Options** shows what the session's provider lets a client change (a
  model or a mode, where it offers one) and changes it.

## 0.2.14 (2026-11-26)

- Team roster: a team is its teammates, whatever workspace each agent works in. Agents fill the
  first team, then the next, and the 3D floor shows one desk area per roster team: with PR-DEV
  (four teammates) and QA-PR (two), the first four agents sit as Team PR-DEV and the next two as
  Team QA-PR. An agent the roster has nobody left for keeps its own name and its workspace's
  team. Workspaces are no longer renamed, and a team no longer repeats across workspaces as in
  0.2.13. A closed agent is handed no teammate.
- A person on the 3D floor whose team changes while the office is open moves to that team's
  desks; before, the area kept its old name until the page was loaded again.

## 0.2.13 (2026-11-25)

- Team roster: once every team is held, the teams are shared. A workspace takes the team the
  fewest workspaces hold, so with two teams and ten workspaces every workspace shows a team name
  and none keeps Paseo's. Workspaces that 0.2.12 passed over take a team when the office is next
  open. Agents are named as before, per workspace.
- **Gen-UI cards**, a host setting, off by default: where a reply holds a `ui` or `app` block
  of the Generative UI plugin, a session's chat in the office shows a card with the block's
  title, not the block's source. The live card is drawn in Paseo's workspace chat.

## 0.2.12 (2026-11-24)

- The plugin overview says what the History vault keeps on the host and for how long, and which
  AWS CLI profile the CloudWatch alerts use and what they read. No change in behaviour.

## 0.2.11 (2026-11-24)

- Team roster: a **Teams** section in the settings holds teams and their teammates, and the
  office names workspaces and agents from it by itself: a workspace takes the first free team,
  and each agent in it one of the team's free teammates by chance. Paseo's own names are not
  changed (#44).

## 0.2.10 (2026-11-23)

- A room's board lists the room's agents under its form, each with what it is at and the
  unfinished steps of its checklist, so a room at work with nothing posted is no empty board. The
  lobby's board lists the same for every room under Agent tasks. A press on an agent opens it,
  and a room's name on the lobby's board opens that room's board (#40).
- Team chat, a host setting, picks whose words the team chat's people write: International, the
  default, is English worded for any office; Indonesia is Indonesian, with Indonesia's food,
  prices and places; Vietnam is upstream's lines as before. Lines already in the chat stay (#41).
- 0.2.9 was tagged and never published to npm: this version carries its changes too.

## 0.2.9 (2026-11-23)

- CloudWatch incidents: with an AWS profile and region in the settings, alarms in ALARM and error
  lines in chosen log groups ring the incident alarm, read through the host's own `aws` CLI.
- The Host card is wider and in four sections (Overview, Plan, Agents, System); Plan has a switch
  for each provider, so a plan nobody pays for no longer reads as "Out of".
- "Rename team" is at the top of a room's board in every view, not only the List view.
- The Attention count leaves out cards that only inform. In the full screen layout Attention and
  Activity are header icons, and Janitor, Stand-up, Reviews, QA and Library are toolbar icons.

## 0.2.8 (2026-11-23)

- What eats your plan: under This week, the five agents that used the most, by cost where
  reported and by time at work otherwise (#36).
- Forgotten work: the Host card checks each workspace's folder and its repository's other
  worktrees for files not committed, commits no remote has, and stashes (#36).
- Models: the Host card lists each agent that has sub-agents with the models they run on (#36).
- The cache clock: a resting desk's cup steams while the session's prompt cache is taken to be
  warm, estimated from the end of its last turn. An hour by default; five minutes or no cup in
  the settings (#36).

## 0.2.7 (2026-11-23)

- The office notices, as cards in the Attention strip: the same call failing three times running
  (Stop, Send a hint), a call auto mode refused, two agents changing one file (Tell both), a
  command whose port is taken (Tell the agent), and failing checks (Fix it) (#35).
- Pinned notes, a setting, are said again to an agent whose conversation is compacted during a
  turn (#35).
- These are noticed a few seconds after the fact and only while an office is open. Blocking a
  call before it runs and undoing a turn's edits are not in this version: both need real Claude
  Code hooks on the host.

## 0.2.6 (2026-11-23)

- History vault, off by default: turned on, the office keeps the prompts and the replies of each
  conversation in `office/vault.json` on the host, read through Paseo for every provider (#34).
- History searches what was said and opens a conversation, also after its agent is archived
  (#34).
- Prompt report: the last seven days' prompts against the prompt helper's rules, worked out on
  the host with no model (#34).

## 0.2.5 (2026-11-23)

- Timeline: a lane per agent over the last hour, 6 hours or 24 hours, replayed at 30, 60 or 120
  times the clock. Each lane says what its agent was at then. The replay is in the card; the 3D
  floor keeps showing the present (#33).
- This week: the last seven days added up, with time at work, turns, edits, commands, cost and
  the busiest team (#33).
- The office keeps the log itself, in `office/timeline.json`, for eight days. It holds what was
  seen while an office was open; the time between is a gap.

## 0.2.4 (2026-11-23)

- Plan limits: the Host card lists each provider's limits with how much is used and when each
  resets. From 80% used the toolbar's Host button names the closest limit, from 95% in the
  danger colour, and at 100% it reads "Out of" the provider (#31).
- Out of Claude: on the 3D floor a plan at 100% puts up the countdown board and sends that
  plan's resting people on a break until it resets (#31).
- Streamer mode is a setting, on by default as before. Off, the bubble over a person names the
  file, command or site they are at (#32).
- Graphics is a per-device choice of Auto, Low, Medium or High (#32).
- Sticky notes: up to four notes of the owner's on the 3D whiteboard, typed in the settings
  (#32).

## 0.2.3 (2026-11-23)

- The stand-up writer's mode is a setting: the modes its provider offers, Codex's Full Access
  among them. A mode that asks leaves the note unwritten, since nobody answers at 8:00 (#28).
- A team can go by a name of the office's own, set under its room's title. The workspace keeps
  its name in Paseo (#29).
- A provider's own sub-agents (Claude's Agent tool) come in through the door on the 3D floor and
  leave when their call ends (#30).

## 0.2.2 (2026-11-23)

- Jira and Sentry connections are set in the office's settings, under Services: Jira address,
  email and API token, and a Sentry auth token, each with Test connection, Save connection and
  Remove (#26).
- Saved connections live in `office/trackers.json` in Paseo's home on the host, readable by the
  daemon's user only. A token is never sent back to the app.
- A host with nothing saved still reads `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`,
  `ATLASSIAN_API_TOKEN` and `SENTRY_AUTH_TOKEN` from the daemon's environment.
- A saved connection holds from the next incidents check, with no daemon restart.

## 0.2.1 (2026-11-22)

- Fixed: Office 3D failed to load on Android with "undefined cannot be used as a constructor".
  The app's side no longer needs `Intl.PluralRules`, which Android's engine lacks (#21).
- Phones: session chat and team chat open in native dialogs (#24), Activity, Sessions and
  Attention use the native Office sheet (#25), the team chat composer stays above the keyboard
  (#23), and the conversation sheet gives messages more room (#20).
- Fullscreen Office 3D is a workspace, and idle agents pick up lobby tasks (#3).
- An idle person takes an open duty at once, at any hour (#15).
- Host details show live diagnostics (#19), and configured SSH hosts show memory, load and disk
  use (#12).
- Team chat sits beside the Details sidebar (#18), and Sessions is on the left of the fullscreen
  header (#17).
- A resting session collects manually brewed coffee (#16). Elevator crossings are recorded, and
  coffee and lobby branding are back (#13).
- Changed: archiving an idle session when its worker goes home is now opt-in, under Automation
  (#22).

## 0.2.0 (2026-11-20)

- The fullscreen office has collapsible sidebars (#2).
- Staff and daily-life scenes on the floor, fed with agent cost, repository ages, team tenure and
  the lift's servicing. The staff scenes speak in the team chat (#1).
- Floor plans: company floor or cozy room, a host setting the camera bar follows.
- Camera extras: photo mode's Auto, Day and Night, a first-visit tour, a 15-second clip, and a
  glide to a person who asks for a permission.
- Sound: a device setting, off by default, with a button on the floor's toolbar.
- Fixed: a team already in the directory is no longer seated as an intern when the tenure list is
  first seeded.

## 0.1.0 (2026-11-19, Git tag only)

- First release: a community port of my-office for Paseo, with agents at their desks in 3D.
- The stand-up notes' days are a setting.
- Fixed: the app's side uses no array method a phone's engine lacks.
