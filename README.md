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
  offers Company floor, Cozy room and Headquarters in Settings. Headquarters seats 44 agents. Its four department rooms fill as teams outgrow the six desk areas on the main floor.
- The indoor staff deliver parcels, make rounds and tally reported spending. The teams have duty rosters, promotions and farewells.
- The optional street outside has walk-in shops, traffic and six staff scenes. Shops and vehicles carry made-up names and locally drawn signs. The cafés, pharmacy and phone shop share the generic store fittings.
- Dresses the 3D floor for Halloween, Christmas and Lunar New Year by the date. Weather can follow a hand-picked sky, the season or a service you choose.
- Shows 3D signs, labels and speech in English, Vietnamese, Thai or Indonesian. Choose a language
  on the settings page. Automatic follows the app’s language when supported. Paseo 0.16.2 offers
  none of the three non-English scene languages, so select one explicitly to use it.
- Puts a column beside the floor: Attention (who needs you, and the office's cards), Sessions,
  Activity, and a team Chat where an `@` prompts an agent. An agent's session opens as a tab of
  the column, with its conversation, a reply box, permission answers and Stop. The Sessions tab
  starts an agent: a workspace, a provider and model, and a first prompt.
- Select **Full screen** beside the view switch to work inside the office. On a wide screen,
  Sessions sits on the left, the floor in the center, and activity or the open conversation
  on the right. You can reply and answer permission requests while the floor stays open.
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
| The street outside                | Available in 3D. Enabled by default on wide web layouts and disabled by default on phones.                                                                                             |
| Stock Paseo 0.16                  | A session opens in the office in every app. Its SDK has no `cancel()` or `closeRuntime()` for an agent: no Stop on a session, and the Host card does not close an idle agent's runtime |

[docs/verified.md](docs/verified.md) says what was seen on a stock Paseo 0.16.2, and what was not.

The stand-up notes and the incidents check run on the plugin's own timers. After a daemon
restart, a run waits until the office is opened or an agent opens or ends a turn. A run missed
while the daemon was down is not made up.

The column, agent cards, settings, team chat (including @Director), whiteboard rows and host
notifications stay in English. Thai and Indonesian use the English karaoke songs. Vietnamese
and Thai also use English for the port’s custom lines.

## What it reads and where it sends it

- It reads agents, workspaces, status, spending when the provider reports it, and each agent’s kind
  of activity. On the host it runs Git once per workspace folder to read the first commit date.
- The 3D scene receives people, kinds of activity, spending, repository birthdays, team tenure,
  and the lift’s servicing time. It receives no file names, commands or prompts and makes no
  network calls. It sends chat moments with a name or count, and reports farewells and promotions.
- With the street enabled, the device receives the bundled Kenney Car Kit (CC0). While a street
  is open, the host checks local Git tags and the installed Claude CLI version. New tags can
  trigger the photo booth. The pickleball scene uses check results already available to Paseo.
- English travels with the scene. For each other language the host sends one dictionary on request
  to the device that chose it. The device keeps those words for the life of the page.
- A clip is recorded inside the page and saved as a download on the device; nothing is sent. The
  scene keeps on the device, under keys that start with `office-`, which team sits where, the
  plants, the graphics level, the Sound switch, that the tour was seen, and the clip's shape and
  music choice, the duty roster, drill and farewell history. The column keeps when this device last had the chat open (`office-chat-seen`).
- With Settings > Weather > From a service and an address set, the host reads that address while an
  office is open, at most once in 15 minutes. The request sets only the `Accept` header. The
  scene receives a weather code, temperature and cloud share. The host stores the address,
  including any key in its query, in `<PASEO_HOME>/plugin-settings/office/office.json`.
  Anyone who can open the settings page can see it there.
- It calls Jira and Sentry only when their settings are filled in, with tokens from the host's
  environment (`ATLASSIAN_*`, `SENTRY_AUTH_TOKEN`). The tracker settings never hold a token.
- The stand-up notes writer, a wake and a chat `@` send the board's text, the chat message and the
  notes' prompt to the host's own agents, and so to whichever provider runs them.
- It stores boards, the chat, the stand-up notes' state and incidents under the host's Paseo home,
  in `office/`, alongside the team ledger (`tenure.json`) and lift build (`lift.json`).

## Based on

The 3D scene is my-office at commit
[`b68228871fe30cd2c759a2c919337a9a9d1f5644`](https://github.com/khanh020905/my-office/tree/b68228871fe30cd2c759a2c919337a9a9d1f5644)
(v0.6.0), with three.js 0.160.0. [vendor/SOURCES.md](vendor/SOURCES.md) says what is taken, what
stands in for the rest, and how to take a newer my-office.

Upstream supplies the Vietnamese and Thai text, with real brand names replaced. The Indonesian
text was written for this port in my-office’s locale format.

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
