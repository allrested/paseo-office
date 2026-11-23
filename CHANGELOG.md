# Changelog

Versions are the npm package `paseo-office`. Dates are the day the version was published.

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
