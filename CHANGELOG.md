# Changelog

Versions are the npm package `paseo-office`. Dates are the day the version was published.

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
