# Office 3D

See your Paseo sessions as people at work in a shared office. Each workspace has a room, so you can spot an agent waiting for approval, walk over to its desk and open the conversation without leaving the floor.

## Working in the office

Open **Office 3D** from the sidebar and choose **Full screen**. **Sessions** groups agents by status and shows their current activity. When a provider reports checklist progress, the row shows completed items. A bar labeled **Context** measures context-window usage.

Select a row to read the conversation, reply (on the web with up to four images) or answer a permission request. On desktop and web, the **↗** beside the row opens the agent’s Paseo workspace over the floor, including files, diffs and terminals. In **Walk in**, press **E** next to the agent for the same workspace. Minimize it to keep your place, or hide the Sessions and Details sidebars for a wider view.

Use **Team chat** to talk to the group or address one session. Use the **Lobby board** for work that an available agent can claim. With **Agent tools** and **Wake agents** enabled, idle agents pick up unassigned tasks. Completing a linked workspace task also checks it off in the lobby. The pantry **Duty board** schedules recurring assignments on the days you choose.

## Setup and compatibility

Office 3D requires Paseo 0.16.0 or newer and plugins enabled on the host. Desktop and web support the 3D floor with WebGL 2. The store mobile app offers the 2D floor and List. Mobile builds with a script-capable frame can also show 3D.

The settings gear controls the floor plan, backdrop, lighting and sound. Under **Appearance → Branding**, the host can set a shared office name, logo and mark color. The 3D scene supports English, Vietnamese, Thai and Indonesian. The surrounding Office controls follow the same choice: Indonesian when Bahasa Indonesia is chosen, English otherwise.

**Archive idle sessions** is off by default. Enable it under **Office settings → Automation** if you want an open 3D floor to archive a session when its worker goes home. Workers can go home after resting for at least 30 minutes at night or after evening drinks. The session must still be idle, with no pending approval or working subagent. Archiving removes it from the active list and keeps its conversation history.

**Keep watching** is off by default. Without it Office reads sessions only while it is open on a device, so the Timeline and the weekly figures have gaps for the hours it was closed. Turn it on under **Office settings** to keep reading every 15 seconds with no office open. It reads what an open office reads and stores nothing more. It also reads each provider’s plan limits every 5 minutes and, on Linux, the host’s memory every minute; with a webhook set, a message goes out when a limit passes 80%, 95% or 100% or memory runs out.

**Webhook address**, under **Office settings → Services → Notifications**, is empty by default. With an address set, the host posts a short JSON message there when Office raises an alert, opens an incident, a plan limit reaches 80%, 95% or 100%, or the host’s memory runs out: the kind of problem, the agent’s or provider’s name and a line of detail, never a prompt or a reply, and no file or command while Streamer mode is on. The address is stored as typed in the host settings.

**Gen-UI cards** is off by default. Turn it on under **Office settings** when the Generative UI plugin is installed: where a reply holds one of that plugin’s `ui` or `app` blocks, a session’s chat in the office shows a card with the block’s title instead of the block’s source. A `ui` block’s live card is drawn in the workspace chat. An `app` block is an HTML page the agent wrote: in a browser or the desktop app it runs in the card, in a sandboxed frame that has its own empty origin, no network and no way to reach the office’s page or storage; on a phone it stays the title card. The setting reads and stores nothing more.

Stand-up notes need a host folder. Jira and Sentry alerts need project settings and a connection: a Jira address, email and API token, and a Sentry auth token, entered in the settings or set in the host environment. Entered tokens are stored unencrypted on the host in a file only its user can read. CloudWatch alerts need no token in Office: with an AWS profile and region in the settings, Office runs the host’s `aws` CLI with that profile. It lists the alarms in ALARM and, for the log groups you name, counts the lines that match your error pattern. It copies no log line and writes nothing to AWS, and the profile needs only `cloudwatch:DescribeAlarms` and `logs:FilterLogEvents`. Weather from a service needs a configured URL. Linux and macOS hosts can also show CPU, memory and processes; a Mac does not break them down by agent.

## Data access

Office reads session status, activity and provider-reported usage. It stores team chat, tasks and duty records on the Paseo host. An agent’s configured provider processes messages, assignments and tool results. A whole-group message can include up to six recent group or scene messages when Office asks an available agent to reply.

**History vault** is off by default. When it is on, Office copies the prompts and replies from each session’s timeline, not the tool calls, into a searchable folder on the Paseo host, `office/vault/`, one file per conversation, which only the host’s user can read. It keeps up to 2,000 characters of a message, the newest 300 messages of a conversation and the 200 most recent conversations. The copies outlive the agent: a conversation stays readable after its agent is archived. Turning the vault off stops new reads and hides what is kept, but leaves the folder in place; deleting the folder empties it.

Configured issue trackers and weather services receive requests from the host. Clients fetch a custom logo from its configured URL. A session’s available actions depend on its provider and the host SDK.
