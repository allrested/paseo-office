# Office 3D

A community port of [my-office](https://github.com/khanh020905/my-office) for
[Paseo](https://github.com/getpaseo/paseo): your agents at their desks, in 3D.

It is based on my-office by [khanh020905](https://github.com/khanh020905), with the author's
permission, and is not an official version of it. Report issues with this Paseo plugin in
[this repository's issue tracker](https://github.com/allrested/paseo-office/issues), not in
my-office's.

## What it does

- Shows every agent on the host as a floor: in 3D, in 2D pixel art, or as a list. Each workspace
  is a room, and each agent sits at a desk and walks to the kind of work it is doing. The 3D floor
  has two plans, a company floor and a cozy room, chosen in Settings.
- Puts a column beside the floor: Attention (who needs you, and the office's cards), Sessions,
  Activity, and a team Chat where an `@` prompts an agent. An agent's session opens as a tab of
  the column, with its conversation, a reply box, permission answers and Stop. The Sessions tab
  starts an agent: a workspace, a provider and model, and a first prompt.
- Gives each room a board of tasks and notes. Agents read and post with three tools, and a post
  that names an idle agent wakes it.
- Writes the day's stand-up entry at 8:00 on the days you choose, Monday to Friday by default: an
  agent on the host gets the office's stand-up report and writes a `## DD Month YYYY` entry into
  `daily-standup-YYYYMM.md` in a folder of notes you choose, following the stand-up notes
  instructions for that folder, which may sit in its own or a parent folder's `AGENTS.md` or
  `CLAUDE.md`.
- Rings an incident alarm for a new Jira bug or Sentry issue in the projects you name.
- Plays my-office's sounds in the 3D floor: off until you turn on Sound in the settings or with the
  speaker button on the floor's toolbar.
- Plays my-office's staff and daily life on the 3D floor's company plan: reception, HR, the
  cleaner and the courier, lunch at the microwaves, the duty roster, the midday nap, the fire
  drill, a team's farewell and its interns. What they say comes into the team chat.
- Takes a photo of the 3D floor, in the app's light or held to day or night for the photo, and on
  a desktop or in a browser records a 15-second clip of it; a tour of the floor's things shows
  once on a desktop.
- Reads the host (on Linux): memory, CPU, and what each agent left running, with a way to clean it
  up.

[docs/office.md](docs/office.md) says how each part works.

## Install

You need Paseo 0.16.0 or newer; the plugin is tested on 0.16.2. Installed plugins must be turned on
in `config.json` under the host's Paseo home (`$PASEO_HOME/config.json`, by default
`~/.paseo/config.json`):

```json
{ "pluginsEnabled": true }
```

The daemon reads that key when it starts. On a running daemon, apply the change with
`paseo daemon reload` or restart the daemon.

Then install it on the host:

```
paseo plugin install git:allrested/paseo-office
```

The host supplies the plugin SDK and `zod`, so installing runs no build and needs no
`node_modules`.

The settings are in Settings > Plugins > Office 3D. The gear over the floor opens them too.

## What works where

| Where                             | What you get                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop app and browsers          | The 3D floor, the 2D floor and the list; Photo mode, clips and the tour                                                                                                                |
| The phone app with a script frame | The 3D floor without Photo mode, clips and the tour                                                                                                                                    |
| The store phone app               | The 2D floor and the list: its plugin frame runs no script                                                                                                                             |
| Sound                             | A browser and the desktop app, where the frame lets audio start; the phone's script frame: see [docs/verified.md](docs/verified.md)                                                    |
| Stock Paseo 0.16                  | A session opens in the office in every app. Its SDK has no `cancel()` or `closeRuntime()` for an agent: no Stop on a session, and the Host card does not close an idle agent's runtime |

[docs/verified.md](docs/verified.md) says what was seen on a stock Paseo 0.16.2, and what was not.

The stand-up notes and the incidents check run on the plugin's own timers. After a daemon
restart, a run waits until the office is opened or an agent opens or ends a turn. A run missed
while the daemon was down is not made up.

## What it reads and where it sends it

- It reads the host's agents and workspaces, their status, what each agent has cost so far, and
  the kind of thing each agent does (a read, an edit, a command, a test run). The kind is worked
  out on the host.
- On the host it runs `git log` once in each workspace's folder, to learn the day of the
  repository's first commit. It runs no other command for the scene.
- The 3D scene is told who is there, what kind of thing each does, what each agent has cost, the
  day each team's repository began, and how long each team has been in the office (when it last
  worked, on how many days and turns, a farewell or a promotion held); a team is a workspace,
  known by its name. For the lift's servicing it is told two things about the plugin itself: how
  long ago its server started, as the time the servicing has left, and a short id of the scene's
  build with the time the lift was first serviced for it. It is never told a folder, a file name,
  a command or a prompt. The scene makes no network call.
- The scene tells the plugin two things: a moment for the team chat (a birthday, the fire drill)
  as a kind and a few words such as a name or a count, which the plugin turns into a staff
  member's line; and a farewell or a promotion it held.
- A clip is recorded inside the page and saved as a download on the device; nothing is sent. The
  scene keeps on the device, under keys that start with `office-`, which team sits where, the
  plants, the graphics level, the Sound switch, that the tour was seen, the clip's shape and
  music choice, and the staff scenes' own: which teams had their farewell or came back, the duty
  roster with the names on it, and the fire drill's day. The column keeps when this device last
  had the chat open (`office-chat-seen`).
- It calls Jira and Sentry only when their settings are filled in, with tokens from the host's
  environment (`ATLASSIAN_*`, `SENTRY_AUTH_TOKEN`). The settings never hold a token.
- The stand-up notes writer, a wake and a chat `@` send the board's text, the chat message and the
  notes' prompt to the host's own agents, and so to whichever provider runs them.
- It stores boards, the chat, the stand-up notes' state, incidents, the tenure list
  (`tenure.json`) and the lift's last build (`lift.json`) under the host's Paseo home, in
  `office/`.

## Based on

The 3D scene is my-office at commit
[`b68228871fe30cd2c759a2c919337a9a9d1f5644`](https://github.com/khanh020905/my-office/tree/b68228871fe30cd2c759a2c919337a9a9d1f5644)
(v0.6.0), with three.js 0.160.0. [vendor/SOURCES.md](vendor/SOURCES.md) says what is taken, what
stands in for the rest, and how to take a newer my-office.

## Develop

```
npm install
npm run typecheck
npm test
npm run test:scripts   # the scripts under scripts/
npm run lint
npm run build:world    # after any change under vendor/
```

## Licence

MIT. my-office and three.js keep their own MIT licences; see [LICENSE](LICENSE).
