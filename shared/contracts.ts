import { BrandingSchema } from "./branding.js";
import { AppearanceSchema } from "./appearance.js";
import { WORDS_LANGUAGES } from "./scene-language.js";
import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { PlanUsageSchema } from "./plan-usage.js";
import { TimelineSchema } from "./timeline.js";
import { AlertSchema } from "./alerts.js";
import { ForgottenSchema } from "./forgotten.js";
import { PromptReportSchema, VaultHitSchema, VaultTalkSchema } from "./vault.js";
import { z } from "zod";
// In their own file, so code that needs only a name does not load the schemas.
import { ACTIVITY_KINDS, TEST_RESULTS } from "./names.js";

export { ACTIVITY_KINDS, DUTY, LOBBY, USER_AUTHOR } from "./names.js";
export type { ActivityKind, ActivityStep, TestResult } from "./names.js";
export const POST_TEXT_MAX = 2000;
/** The checks of one pull request the office carries. */
export const CHECK_RUNS_MAX = 40;
export const BOARD_POST_MAX = 200;
export const DONE_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const READ_POST_MAX = 30;
export const WAKES_PER_HOUR = 6;

export const AgentStatusSchema = z.enum(["initializing", "idle", "running", "error", "closed"]);
export type AgentStatus = z.output<typeof AgentStatusSchema>;

export const PermissionKindSchema = z.enum(["tool", "plan", "question", "mode", "other"]);
export type PermissionKind = z.output<typeof PermissionKindSchema>;

export const OfficePermissionSchema = z.object({
  id: z.string(),
  kind: PermissionKindSchema,
  title: z.string(),
  /** What is asked beyond the title (the command, the file); absent when there is nothing more. */
  detail: z.string().optional(),
});
export type OfficePermission = z.output<typeof OfficePermissionSchema>;

/** How full an agent's context window is, as its provider last said. */
export const AgentContextSchema = z.object({
  usedTokens: z.number().nonnegative(),
  maxTokens: z.number().positive(),
});
export type AgentContext = z.output<typeof AgentContextSchema>;

export const OfficeAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  status: AgentStatusSchema,
  /** Null for an agent without a workspace; it sits in the lobby. */
  workspaceId: z.string().nullable(),
  parentAgentId: z.string().nullable(),
  permissions: z.array(OfficePermissionSchema),
  createdAt: z.string(),
  /** Absent for a provider that reports no context window, and before an agent's first turn. */
  context: AgentContextSchema.optional(),
  appearance: AppearanceSchema.optional(),
  /** A sub-agent's number among its parent's, as the office stored it on the agent. */
  number: z.number().int().positive().optional(),
  /** On a parent: the number its next sub-agent gets. */
  next: z.number().int().positive().optional(),
  /** The roster teammate it holds, by id, or the edition it was passed over at; absent before either. */
  roster: z.union([z.string(), z.number()]).optional(),
  /** The roster team its teammate is of; absent where the workspace has a team name typed by hand. */
  team: z.string().optional(),
  /** The office's name for a numbered sub-agent: `<parent's name>-<number>`. */
  name: z.string().optional(),
  /**
   * For an idle agent: when anything about it last changed on the host, its turn's end at the
   * earliest. Absent for any other status: a running agent's time moves with every step.
   */
  idleSince: z.string().optional(),
  /** When the host flagged the currently pending permission. */
  permissionSince: z.string().optional(),
  /** What the agent's turns have cost so far; absent when its provider says no cost. */
  costUsd: z.number().nonnegative().optional(),
  /** When the agent was last prompted; on a running or starting agent only. */
  promptedAt: z.string().optional(),
});
export type OfficeAgent = z.output<typeof OfficeAgentSchema>;

/** The ticket a workspace was started on, read from its `tasks.key` and `tasks.url` metadata. */
export const WorkspaceTicketSchema = z.object({ key: z.string(), url: z.string().nullable() });
export type WorkspaceTicket = z.output<typeof WorkspaceTicketSchema>;

/** One check of a pull request: a job of its pipeline. */
export const WorkspaceCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["success", "failure", "pending", "skipped", "cancelled"]),
  /** The run's page on the forge, where its log is. */
  url: z.string().nullable(),
  workflow: z.string().optional(),
  duration: z.string().optional(),
});
export type WorkspaceCheck = z.output<typeof WorkspaceCheckSchema>;

/** A script or a service of a workspace, from the project's own configuration. */
export const WorkspaceScriptSchema = z.object({
  name: z.string(),
  kind: z.enum(["script", "service"]),
  running: z.boolean(),
  /** A service's health check; null for a script and for a service without one. */
  health: z.enum(["healthy", "unhealthy"]).nullable(),
  /** How its last run ended; null while it runs and before its first run. */
  exitCode: z.number().nullable(),
  port: z.number().nullable(),
  /** The terminal it runs in, or ran in; null before its first run. */
  terminalId: z.string().nullable(),
});
export type WorkspaceScript = z.output<typeof WorkspaceScriptSchema>;

/** The pull or merge request of a workspace's branch, as the host's forge reports it. */
export const WorkspacePullRequestSchema = z.object({
  number: z.number().nullable(),
  url: z.string(),
  title: z.string(),
  /** The branch it would be merged into; null when the forge did not say. */
  base: z.string().nullable(),
  state: z.enum(["open", "draft", "merged", "closed"]),
  /** Its checks taken together. */
  checks: z.enum(["none", "pending", "success", "failure"]),
  /** Its checks one by one, the failing and the running first; at most CHECK_RUNS_MAX of them. */
  runs: z.array(WorkspaceCheckSchema),
  review: z.enum(["approved", "changes_requested", "pending"]).nullable(),
  /** It cannot be merged as it is. */
  conflicts: z.boolean(),
});
export type WorkspacePullRequest = z.output<typeof WorkspacePullRequestSchema>;

/**
 * A sub-agent a provider runs inside an agent's own session, as the tool call that started it.
 * It is no Paseo agent: it has no session of its own. `type` is the kind of sub-agent the
 * provider names ("Explore"), never its task.
 */
export const SubagentCallSchema = z.object({ id: z.string(), type: z.string() });
export type SubagentCall = z.output<typeof SubagentCallSchema>;
export const SubagentCallsSchema = z.record(z.string(), z.array(SubagentCallSchema));
export type SubagentCalls = z.output<typeof SubagentCallsSchema>;

export const OfficeWorkspaceSchema = z.object({
  id: z.string(),
  /** The name its team goes by: the office's own when the owner gave one, else the workspace's. */
  name: z.string(),
  /** The workspace's own name in Paseo; present only while the team goes by another. */
  workspaceName: z.string().optional(),
  /** When it was made; absent on a host that does not say. */
  createdAt: z.string().optional(),
  projectName: z.string(),
  branch: z.string().optional(),
  ticket: WorkspaceTicketSchema.optional(),
  /** The lines its checkout adds and removes, as the sidebar counts them; absent when none. */
  changes: z.object({ additions: z.number(), deletions: z.number() }).optional(),
  /** Its scripts and services; absent when the project has none. */
  scripts: z.array(WorkspaceScriptSchema).optional(),
  pullRequest: WorkspacePullRequestSchema.optional(),
});
export type OfficeWorkspace = z.output<typeof OfficeWorkspaceSchema>;

export const PostKindSchema = z.enum(["task", "note"]);
export type PostKind = z.output<typeof PostKindSchema>;

export const TaskStateSchema = z.enum(["open", "claimed", "done"]);
export type TaskState = z.output<typeof TaskStateSchema>;

export const UpdateActionSchema = z.enum(["claim", "done", "reopen"]);
export type UpdateAction = z.output<typeof UpdateActionSchema>;

export const PostSchema = z.object({
  /** `p` and the post's seq at creation. */
  id: z.string(),
  /** Raised on every change; office_read's cursor. */
  seq: z.number().int().nonnegative(),
  /** A workspace id, or "lobby". */
  board: z.string(),
  kind: PostKindSchema,
  text: z.string(),
  /** An agent id, or "user". */
  author: z.string(),
  to: z.string().optional(),
  /** Tasks only. */
  state: TaskStateSchema.optional(),
  claimedBy: z.string().optional(),
  /** Named lobby tasks created with tracked pickup. Older named posts may already have woken their agent. */
  namedPickup: z.literal(true).optional(),
  /** Persisted until Paseo acknowledges an automatic lobby assignment. */
  pickupMessageId: z.string().optional(),
  /** On the duty board: the duty of the list it was posted for, and its day (YYYY-MM-DD). */
  duty: z.object({ id: z.string(), day: z.string() }).optional(),
  /** A claimed lobby task's copy on the claimer's board, and the copy's lobby task: each other's id. */
  link: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Post = z.output<typeof PostSchema>;

/** The scene's four pantry chores, which a duty of the starting list is acted out as. */
export const DUTY_CHORES = ["cups", "trash", "plants", "table"] as const;
export type DutyChore = (typeof DUTY_CHORES)[number];

/** A duty of the owner's list. Without instructions it is pretend: the 3D office acts it out. */
export const DutySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** What an agent handed the duty is asked to do; empty for a pretend duty. */
  instructions: z.string(),
  /** The weekdays it comes due, 0 for Sunday to 6 for Saturday. */
  days: z.array(z.number().int().min(0).max(6)),
  /** The chore the 3D office acts it out as; absent for a duty the owner added. */
  chore: z.enum(DUTY_CHORES).optional(),
});
export type Duty = z.output<typeof DutySchema>;

/** The duty list, and the day the duty board was last brought up to (null before the first). */
export const DutyBoardSchema = z.object({
  duties: z.array(DutySchema),
  day: z.string().nullable(),
});
export type DutyBoard = z.output<typeof DutyBoardSchema>;

export const WakeStateSchema = z.object({
  paused: z.boolean(),
  /** Deliveries waiting, per agent id; agents with none are absent. */
  queued: z.record(z.string(), z.number().int().nonnegative()),
});
export type WakeState = z.output<typeof WakeStateSchema>;

/** A running agent's newest tool call: what it is for, and a key that changes with each call. */
/** The most characters of what a step is at. */
export const STEP_LABEL_MAX = 80;

export const ActivityStepSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  key: z.string(),
  result: z.enum(TEST_RESULTS).optional(),
  label: z.string().max(STEP_LABEL_MAX).optional(),
});

/** The most steps of one agent's checklist the office sends. */
export const CHECKLIST_STEP_MAX = 50;
/** The most characters of a step's text; longer text is cut to one line this long. */
export const CHECKLIST_TEXT_MAX = 200;

/** An unfinished step of an agent's own checklist; finished steps are not sent. */
export const ChecklistStepSchema = z.object({
  text: z.string(),
  status: z.enum(["pending", "in_progress"]),
});
export type ChecklistStep = z.output<typeof ChecklistStepSchema>;

/** Each agent's unfinished steps, by agent id; an agent with none is absent. */
export const ChecklistsSchema = z.record(z.string(), z.array(ChecklistStepSchema));
export type Checklists = z.output<typeof ChecklistsSchema>;

/** Full step counts, independently of the cap on unfinished step text. */
const ChecklistProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type ChecklistProgress = z.output<typeof ChecklistProgressSchema>;
const ChecklistCountsSchema = z.record(z.string(), ChecklistProgressSchema);
export type ChecklistCounts = z.output<typeof ChecklistCountsSchema>;

/** The stand-up notes writer, and the 8:00 schedule that starts it. */
export const NotesStateSchema = z.object({
  /** A notes folder is set in the office's settings. */
  folderSet: z.boolean(),
  /** A writer is at work. */
  writing: z.boolean(),
  /** Epoch ms of the last finished write; null before the first. */
  writtenAt: z.number().nullable(),
  /** The writer that stopped on an error, left for the owner. */
  failedAgentId: z.string().nullable(),
  /** Why the last write could not start or stopped; null when it went well. */
  problem: z.string().nullable(),
  /** Why the 8:00 schedule could not follow the settings; null once it does. */
  scheduleError: z.string().nullable(),
});
export type NotesState = z.output<typeof NotesStateSchema>;

export const INCIDENT_SOURCES = ["jira", "sentry", "cloudwatch"] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

/** A new bug in Jira, a new issue in Sentry or an alarm in CloudWatch, open until dismissed or a day after it was found. */
export const IncidentSchema = z.object({
  id: z.string(),
  source: z.enum(INCIDENT_SOURCES),
  key: z.string(),
  title: z.string(),
  url: z.string(),
  /** Epoch ms the tracker says the issue was created. */
  createdAt: z.number(),
  /** Epoch ms the office's check found it. */
  foundAt: z.number(),
});
export type Incident = z.output<typeof IncidentSchema>;

/** Where a tracker's sign-in is: saved from the settings, in the daemon's environment, or nowhere. */
export const TRACKER_SOURCES = ["saved", "env", "none"] as const;
export type TrackerSource = (typeof TRACKER_SOURCES)[number];

/** The open incidents, and what keeps a tracker from being checked. */
export const IncidentsStateSchema = z.object({
  open: z.array(IncidentSchema),
  /** Why a tracker's last check failed; absent once one succeeds. */
  problems: z.object({
    jira: z.string().optional(),
    sentry: z.string().optional(),
    cloudwatch: z.string().optional(),
  }),
  /** The tracker has a sign-in on the host, saved or in its environment. Never the values. */
  jiraReady: z.boolean(),
  sentryReady: z.boolean(),
  /**
   * Where each tracker's sign-in comes from, and Jira's address and email. Never a token. Absent
   * from a server older than the settings' connections.
   */
  connections: z
    .object({
      jira: z.object({
        source: z.enum(TRACKER_SOURCES),
        baseUrl: z.string(),
        email: z.string(),
      }),
      sentry: z.object({ source: z.enum(TRACKER_SOURCES) }),
    })
    .optional(),
  /** Why the check's schedule could not follow the settings; null once it does. */
  scheduleError: z.string().nullable(),
});
export type IncidentsState = z.output<typeof IncidentsStateSchema>;

/** What the 3D scene is told of the weather. `season` leaves the weather to the scene's own season. */
export const WeatherSceneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("season") }),
  z.object({
    kind: z.literal("reading"),
    /** A WMO weather code. */
    code: z.number().int().min(0).max(99),
    /** Degrees Celsius; null when not known. */
    temp: z.number().nullable(),
    /** Cloud as a share, 0 to 1. */
    cloud: z.number().min(0).max(1),
  }),
]);
export type WeatherScene = z.output<typeof WeatherSceneSchema>;

/** The weather the host holds: what the scene draws, why a service could not be read, and when it last was. */
export const WeatherStateSchema = z.object({
  scene: WeatherSceneSchema,
  /** Why the service's last read failed, one sentence that never holds the address; null once one succeeds. */
  problem: z.string().nullable(),
  /** Epoch ms of the answer the scene is drawing; null when it draws no service's answer. */
  readAt: z.number().nullable(),
});
export type WeatherState = z.output<typeof WeatherStateSchema>;

/** The most characters of one chat message the office takes. */
export const CHAT_TEXT_MAX = 600;
export const CHAT_IMAGE_LIMIT = 4;
export const CHAT_IMAGE_CHARS = 1_000_000;
// The group picture is the renderer's 480 × 360 JPEG. Six fit in a single office snapshot.
export const GROUP_PHOTO_MAX = 96_000;
export const GROUP_PHOTO_COUNT = 6;
export const GroupPhotoSchema = z
  .string()
  .max(GROUP_PHOTO_MAX)
  .regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/);
const ChatImageSchema = z.object({
  mimeType: z.literal("image/jpeg"),
  data: z
    .string()
    .min(4)
    .max(CHAT_IMAGE_CHARS)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type ChatImage = z.output<typeof ChatImageSchema>;
/** The most chat messages kept, as upstream's engine keeps them. */
export const CHAT_MESSAGE_MAX = 300;

/** The message a chat message answers, as it was when the answer was sent. */
export const ChatReplySchema = z.object({ id: z.string(), name: z.string(), text: z.string() });

/** A poll's question, and each option with who voted for it. */
export const ChatPollSchema = z.object({
  q: z.string(),
  opts: z.array(z.object({ t: z.string(), by: z.array(z.string()) })),
});

/** A reminder: its title, its time, how it repeats, and who is going and who is not. */
export const ChatRemindSchema = z.object({
  title: z.string(),
  at: z.number(),
  repeat: z.string(),
  yes: z.array(z.string()),
  no: z.array(z.string()),
  done: z.boolean().optional(),
});

/**
 * A message of the team chat, as upstream's engine keeps it. Older photos may have no picture.
 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  at: z.number(),
  /**
   * "text", "sticker", "poll", "remind" and "sys" show; the engine has more kinds, which the
   * office never shows.
   */
  kind: z.string(),
  /** An agent id, "me", or a staff key like "__director"; absent on a system line. */
  from: z.string().optional(),
  name: z.string().optional(),
  text: z.string(),
  sticker: z.number().int().nullable().optional(),
  photo: GroupPhotoSchema.nullable().optional().catch(null),
  poll: ChatPollSchema.nullable().optional(),
  remind: ChatRemindSchema.nullable().optional(),
  reply: ChatReplySchema.nullable().optional(),
  /** Routing of a plain group exchange or delivery notice. Older messages have no tag. */
  tag: z.string().optional().catch(undefined),
  /** Emoji → who reacted with it. */
  reacts: z.record(z.string(), z.array(z.string())),
  recalled: z.boolean().optional(),
});
export type ChatMessage = z.output<typeof ChatMessageSchema>;

/** The conversation, and the names typing now. */
export const ChatSnapshotSchema = z.object({
  messages: z.array(ChatMessageSchema),
  typing: z.array(z.string()),
  pinned: z.string().nullable().optional(),
});
export type ChatSnapshot = z.output<typeof ChatSnapshotSchema>;

/**
 * One change of the chat, as the engine emits it. "act" asks the open scenes to gather at the
 * bell; a client drops an act it already saw by its id.
 */
export const ChatChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), message: ChatMessageSchema }),
  z.object({ op: z.literal("update"), message: ChatMessageSchema }),
  z.object({ op: z.literal("typing"), names: z.array(z.string()) }),
  z.object({
    op: z.literal("all"),
    messages: z.array(ChatMessageSchema),
    pinned: z.string().nullable().optional(),
  }),
  z.object({ op: z.literal("act"), what: z.literal("meeting"), id: z.string() }),
]);
export type ChatChange = z.output<typeof ChatChangeSchema>;

/** What the owner does in the chat; each op goes to the engine's function of that name. */
export const ChatRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("photo"),
    requestId: z.string().min(1).max(80),
    data: GroupPhotoSchema,
  }),
  z.object({
    op: z.literal("life"),
    kind: z.string().min(1).max(40),
    vars: z.record(z.string().max(40), z.string().max(200)).default({}),
  }),
  z.object({
    op: z.literal("send"),
    text: z.string().max(CHAT_TEXT_MAX).optional(),
    sticker: z.number().int().min(0).optional(),
    replyTo: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    images: z.array(ChatImageSchema).min(1).max(CHAT_IMAGE_LIMIT).optional(),
  }),
  z.object({
    op: z.literal("poll"),
    question: z.string().trim().min(1).max(120),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(6),
  }),
  z.object({ op: z.literal("pin"), id: z.string().min(1) }),
  z.object({ op: z.literal("react"), id: z.string().min(1), emoji: z.string().min(1) }),
  z.object({ op: z.literal("vote"), id: z.string().min(1), index: z.number().int().min(0) }),
  z.object({ op: z.literal("rsvp"), id: z.string().min(1), yes: z.boolean() }),
  z.object({ op: z.literal("recall"), id: z.string().min(1) }),
]);
export type ChatRequest = z.output<typeof ChatRequestSchema>;

/** Whether the chat took the call; `error` says why not. */
export const ChatResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ChatResult = z.output<typeof ChatResultSchema>;

export const OfficeSnapshotSchema = z.object({
  brand: BrandingSchema.optional(),
  agents: z.array(OfficeAgentSchema),
  workspaces: z.array(OfficeWorkspaceSchema),
  /** The "doing now" line of each running agent that has one. */
  activity: z.record(z.string(), z.string()),
  /** The step of each running agent: the tool call it is at, or made since the read before. */
  doing: z.record(z.string(), ActivityStepSchema).optional(),
  /** The provider's own sub-agents each running agent has at work now; absent from an older server. */
  subagents: SubagentCallsSchema.optional(),
  /** Each agent's own checklist, kept after the agent stops. */
  checklists: ChecklistsSchema.optional(),
  checklistProgress: ChecklistCountsSchema.optional(),
  boards: z.record(z.string(), z.array(PostSchema)),
  wake: WakeStateSchema,
  /** Absent until the office's server has read the writer's state. */
  notes: NotesStateSchema.optional(),
  /** Absent until the office's server has read the incidents. */
  incidents: IncidentsStateSchema.optional(),
  weather: WeatherStateSchema.optional(),
  /** Absent until the office's server has loaded the chat. */
  chat: ChatSnapshotSchema.optional(),
  /** The duty list; absent until the office's server has read it. Its posts are `boards.duty`. */
  duties: DutyBoardSchema.optional(),
});
export type OfficeSnapshot = z.output<typeof OfficeSnapshotSchema>;

export const OfficeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), state: OfficeSnapshotSchema }),
  z.object({ type: z.literal("agents"), agents: z.array(OfficeAgentSchema) }),
  z.object({ type: z.literal("workspaces"), workspaces: z.array(OfficeWorkspaceSchema) }),
  z.object({
    type: z.literal("activity"),
    activity: z.record(z.string(), z.string()),
    doing: z.record(z.string(), ActivityStepSchema).optional(),
    subagents: SubagentCallsSchema.optional(),
    checklists: ChecklistsSchema.optional(),
    checklistProgress: ChecklistCountsSchema.optional(),
  }),
  z.object({ type: z.literal("board"), board: z.string(), posts: z.array(PostSchema) }),
  z.object({ type: z.literal("board-removed"), board: z.string() }),
  z.object({ type: z.literal("wake"), wake: WakeStateSchema }),
  z.object({ type: z.literal("chat"), change: ChatChangeSchema }),
]);
export type OfficeEvent = z.output<typeof OfficeEventSchema>;

export const PostResultSchema = z.union([
  z.object({ ok: z.literal(true), post: PostSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type PostResult = z.output<typeof PostResultSchema>;

export const DeleteResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type DeleteResult = z.output<typeof DeleteResultSchema>;

/** An idle agent that has had a port open this long has forgotten its server. */
export const FORGOTTEN_AFTER_MS = 30 * 60 * 1000;

/** What one agent's processes hold on the host. */
export const MachineAgentSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  /** "closed" for an agent whose runtime ended and left processes behind. */
  status: AgentStatusSchema,
  rssBytes: z.number(),
  processCount: z.number().int(),
  /** The TCP ports its processes listen on, lowest first. */
  ports: z.array(z.number().int()),
  /** Since when an idle agent has been idle; null in any other state. */
  idleSince: z.string().nullable(),
  /** Idle for FORGOTTEN_AFTER_MS with a port open, or closed with processes left. */
  forgotten: z.boolean(),
});
export type MachineAgent = z.output<typeof MachineAgentSchema>;

export const MachineSchema = z.object({
  readAt: z.string(),
  /** The daemon's cgroup when it has a cap, else the host; null when neither can be read. */
  memory: z.object({ usedBytes: z.number(), totalBytes: z.number() }).nullable(),
  /** 0 to 100 over every core since the reading before; null on the first. */
  cpuPercent: z.number().nullable(),
  /** The agents with a process on the host: the forgotten first, then by memory. */
  agents: z.array(MachineAgentSchema),
  /**
   * Whether this host can close an agent's runtime, which the clean-up of an idle agent needs.
   * Absent from an older version of this server, which ran only on hosts that can: read it as true.
   */
  canCloseRuntime: z.boolean().optional(),
});
export type Machine = z.output<typeof MachineSchema>;

export const MachineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reading"), machine: MachineSchema }),
  /** The host has no /proc to read (macOS, Windows). */
  z.object({ type: z.literal("unavailable") }),
]);
export type MachineEvent = z.output<typeof MachineEventSchema>;

/** A reading now, then one every MACHINE_INTERVAL_MS while someone listens. */
export const machineSubscription = defineSubscription({
  name: "office.machine",
  input: z.object({}),
  event: MachineEventSchema,
});

export const CleanupResultSchema = z.object({
  agentId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type CleanupResult = z.output<typeof CleanupResultSchema>;

/**
 * Frees what the named agents hold: closes an idle agent's runtime, which its next prompt
 * resumes, and stops the processes a closed agent left behind.
 */
export const cleanupRpc = defineRpc({
  name: "office.machine.cleanup.request",
  input: z.object({ agentIds: z.array(z.string().min(1)).min(1).max(50) }),
  output: z.object({ results: z.array(CleanupResultSchema) }),
});

export const JANITOR_ACTIONS = ["clean", "reset"] as const;
export type JanitorAction = (typeof JANITOR_ACTIONS)[number];

export const JanitorResultSchema = z.object({ ok: z.boolean(), error: z.string().nullable() });
export type JanitorResult = z.output<typeof JanitorResultSchema>;

/**
 * Tidies an idle agent's conversation with its provider's own command: "clean" compacts it, so
 * the agent keeps a summary, and "reset" starts a new one, so the agent keeps nothing.
 */
export const janitorRpc = defineRpc({
  name: "office.janitor.request",
  input: z.object({ agentId: z.string().min(1), action: z.enum(JANITOR_ACTIONS) }),
  output: JanitorResultSchema,
});

export const ScriptLogResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    /** The newest lines of the script's output, colour codes removed. */
    lines: z.array(z.string()),
    /** Rows of output above these that the terminal still holds. */
    earlier: z.number().int().nonnegative(),
    readAt: z.string(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ScriptLogResult = z.output<typeof ScriptLogResultSchema>;

/** The end of a workspace script's output, read from the terminal the script runs in. */
export const scriptLogRpc = defineRpc({
  name: "office.script.log.request",
  input: z.object({ workspaceId: z.string().min(1), script: z.string().min(1) }),
  output: ScriptLogResultSchema,
});

/** A skill as the library lists it: one per name, with the folders it is in. */
export const SkillInfoSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  /** ".claude", ".agents", ".codex": where it was found. */
  folders: z.array(z.string()),
});
export type SkillInfo = z.output<typeof SkillInfoSchema>;

export const SkillsResultSchema = z.object({
  /** The host's own skills: every agent of the tool that reads the folder has them. */
  host: z.array(SkillInfoSchema),
  /** Each workspace's skills, by workspace id; a workspace without a folder is absent. */
  workspaces: z.record(z.string(), z.array(SkillInfoSchema)),
  readAt: z.string(),
});
export type SkillsResult = z.output<typeof SkillsResultSchema>;

/** The skills in the host's skills folders and in every workspace's. */
export const skillsRpc = defineRpc({
  name: "office.skills.request",
  input: z.object({}),
  output: SkillsResultSchema,
});

/**
 * A month of the stand-up notes, `YYYYMM`, read from the notes folder; this month in the notes
 * time zone when none is asked for. Only six digits are taken, so a month cannot name a path.
 */
export const notesReadRpc = defineRpc({
  name: "office.notes.read.request",
  input: z.object({
    month: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  }),
  output: z.object({
    folderSet: z.boolean(),
    month: z.string(),
    /** The file's text; null when the month has no file. */
    text: z.string().nullable(),
    /** The nearest earlier and later months that have a file; null where none. */
    previous: z.string().nullable(),
    next: z.string().nullable(),
  }),
});

/** A snapshot, then changes. */
export const officeStateSubscription = defineSubscription({
  name: "office.state",
  input: z.object({}),
  event: OfficeEventSchema,
});

export const postRpc = defineRpc({
  name: "office.post.request",
  input: z.object({
    board: z.string().min(1),
    kind: PostKindSchema,
    text: z.string().min(1).max(POST_TEXT_MAX),
    to: z.string().min(1).optional(),
  }),
  output: PostResultSchema,
});

export const updateRpc = defineRpc({
  name: "office.update.request",
  input: z.object({ id: z.string().min(1), action: UpdateActionSchema }),
  output: PostResultSchema,
});

export const deleteRpc = defineRpc({
  name: "office.delete.request",
  input: z.object({ id: z.string().min(1) }),
  output: DeleteResultSchema,
});

/** Deletes every done task of a board. */
export const clearDoneRpc = defineRpc({
  name: "office.board.clear_done.request",
  input: z.object({ board: z.string().min(1) }),
  output: DeleteResultSchema,
});

export const setWakesPausedRpc = defineRpc({
  name: "office.set_wakes_paused.request",
  input: z.object({ paused: z.boolean() }),
  output: WakeStateSchema,
});

/** The duty list as the editor saves it: a duty already listed keeps its id. */
export const DutyDraftSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().max(400),
  instructions: z.string().max(20_000),
  days: z.array(z.number()).max(14),
});

export const DutiesResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type DutiesResult = z.output<typeof DutiesResultSchema>;

/** Saves the whole duty list; a duty due today that has no post yet is posted at once. */
export const dutiesSaveRpc = defineRpc({
  name: "office.duties.save.request",
  input: z.object({ duties: z.array(DutyDraftSchema).max(50) }),
  output: DutiesResultSchema,
});

/**
 * The 3D office acted out a pretend duty with this agent's figure: it is done by that agent. The
 * first report wins; one for a duty an agent is handed is refused.
 */
export const dutyActedRpc = defineRpc({
  name: "office.duty.acted.request",
  input: z.object({ id: z.string().min(1), agentId: z.string().min(1).max(80) }),
  output: PostResultSchema,
});

/**
 * Starts the stand-up notes writer, as the bell does. `started` is false when none started: one
 * is at work, no folder is set, or it could not start (the snapshot's `notes.problem` says why).
 */
export const notesWriteRpc = defineRpc({
  name: "office.notes.write.request",
  input: z.object({}),
  output: z.object({ started: z.boolean() }),
});

/**
 * Gives a workspace's team a name of the office's own, kept on the workspace; an empty name goes
 * back to the workspace's. The team's tenure follows the name.
 */
export const teamRenameRpc = defineRpc({
  name: "office.team.rename.request",
  input: z.object({ workspaceId: z.string().min(1), name: z.string().max(200) }),
  output: z.union([
    z.object({ ok: z.literal(true), name: z.string() }),
    z.object({ ok: z.literal(false), problem: z.string() }),
  ]),
});

/**
 * The plans of the providers Paseo can read, with their limits. Read when asked, from Paseo's own
 * usage sources: the office keeps none of it.
 */
export const planUsageRpc = defineRpc({
  name: "office.plan.usage.request",
  input: z.object({}),
  output: z.union([
    z.object({ ok: z.literal(true), providers: z.array(PlanUsageSchema) }),
    z.object({ ok: z.literal(false), problem: z.string() }),
  ]),
});

/**
 * What the office saw each agent do between two times (epoch ms), a lane per agent. It holds
 * what was seen while an office was open, for the last eight days.
 */
export const timelineRpc = defineRpc({
  name: "office.timeline.request",
  input: z.object({ from: z.number(), to: z.number() }),
  output: z.union([
    z.object({ ok: z.literal(true), timeline: TimelineSchema }),
    z.object({ ok: z.literal(false), problem: z.string() }),
  ]),
});

/**
 * The history vault. `on` false means the owner has it off: nothing is kept and nothing found.
 * A search answers with the newest messages that hold every word of the query.
 */
export const vaultSearchRpc = defineRpc({
  name: "office.vault.search.request",
  input: z.object({ query: z.string().max(200) }),
  output: z.object({ on: z.boolean(), hits: z.array(VaultHitSchema) }),
});

/** One kept conversation; null when the vault has none for this agent. */
export const vaultTalkRpc = defineRpc({
  name: "office.vault.talk.request",
  input: z.object({ agentId: z.string() }),
  output: z.object({ talk: VaultTalkSchema.nullable() }),
});

/** The last seven days' prompts against the prompt helper's rules, worked out on the host. */
export const vaultReportRpc = defineRpc({
  name: "office.vault.report.request",
  input: z.object({}),
  output: z.object({ on: z.boolean(), report: PromptReportSchema }),
});

/**
 * The checkouts with unfinished work, by their counts. It runs git in each workspace's folder, so
 * it is read when the owner asks.
 */
export const forgottenRpc = defineRpc({
  name: "office.forgotten.request",
  input: z.object({}),
  output: z.object({ items: z.array(ForgottenSchema) }),
});

/** What the office noticed and nobody dismissed, newest first. */
export const alertsRpc = defineRpc({
  name: "office.alerts.request",
  input: z.object({}),
  output: z.object({ alerts: z.array(AlertSchema) }),
});

/** Dismisses an alert; the same thing is not raised again while it lasts. */
export const alertDismissRpc = defineRpc({
  name: "office.alerts.dismiss.request",
  input: z.object({ id: z.string() }),
  output: z.object({ alerts: z.array(AlertSchema) }),
});

export const WriterModesSchema = z.object({
  /** The provider the writer would start on now, by its label. */
  provider: z.string(),
  /** Its modes the writer can start in, by the provider's own names. */
  modes: z.array(z.object({ id: z.string(), label: z.string() })),
  /** The mode the settings come to; null where the provider names none. */
  modeId: z.string().nullable(),
  /** The settings name a mode this provider does not offer. */
  fellBack: z.boolean(),
});
export type WriterModes = z.output<typeof WriterModesSchema>;

/**
 * The modes the stand-up writer can start in, for the settings. `problem` when no provider is
 * ready or the settings cannot be read.
 */
export const notesModesRpc = defineRpc({
  name: "office.notes.modes.request",
  input: z.object({}),
  output: z.union([
    WriterModesSchema.extend({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), problem: z.string() }),
  ]),
});

const JiraConnectionSchema = z.object({
  baseUrl: z.string().max(500),
  email: z.string().max(320),
  /** Empty for the token already saved. */
  token: z.string().max(4000),
});
const SentryConnectionSchema = z.object({ token: z.string().max(4000) });

export const TrackersChangeSchema = z.discriminatedUnion("action", [
  JiraConnectionSchema.extend({ action: z.literal("save-jira") }),
  SentryConnectionSchema.extend({ action: z.literal("save-sentry") }),
  z.object({ action: z.literal("clear"), tracker: z.enum(["jira", "sentry"]) }),
]);
export type TrackersChange = z.output<typeof TrackersChangeSchema>;

/** `problem` is why it failed, in words safe to show: never a token. */
export const TrackersResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), problem: z.string() }),
]);
export type TrackersResult = z.output<typeof TrackersResultSchema>;

/**
 * Saves or clears a tracker's connection on the host, in a file only the daemon's user can read.
 * The token is never sent back; the office's state names where each sign-in comes from.
 */
export const trackersSaveRpc = defineRpc({
  name: "office.trackers.save.request",
  input: TrackersChangeSchema,
  output: TrackersResultSchema,
});

/** One signed-in request to the tracker with the connection as typed; nothing is saved. */
const TrackersProbeSchema = z.discriminatedUnion("tracker", [
  JiraConnectionSchema.extend({ tracker: z.literal("jira") }),
  SentryConnectionSchema.extend({ tracker: z.literal("sentry") }),
]);
export type TrackersProbe = z.output<typeof TrackersProbeSchema>;

export const trackersTestRpc = defineRpc({
  name: "office.trackers.test.request",
  input: TrackersProbeSchema,
  output: TrackersResultSchema,
});

/** Closes the named open incidents, or all of them when none are named. Their keys stay seen. */
export const incidentsDismissRpc = defineRpc({
  name: "office.incidents.dismiss.request",
  input: z.object({ ids: z.array(z.string()).optional() }),
  output: z.object({ dismissed: z.number().int().nonnegative() }),
});

/** Something the owner does in the team chat: send, react, vote, answer a reminder, recall. */
export const chatRpc = defineRpc({
  name: "office.chat.request",
  input: ChatRequestSchema,
  output: ChatResultSchema,
});

/** The daemon's copy of an image sent with a message, as a data URL; null when it cannot be read. */
export const sentImageRpc = defineRpc({
  name: "office.session.image",
  input: z.object({ url: z.string().max(600) }),
  output: z.object({ data: z.string().nullable() }),
});

export const worldLogoRpc = defineRpc({
  name: "office.world.logo",
  input: z.object({}),
  output: z.object({ url: z.string(), data: z.string().nullable() }).nullable(),
});

/**
 * The script of the page that draws the 3D office: the vendored my-office scene with three.js,
 * one self-contained file. A browser evaluates it in a frame of its own.
 */
export const worldRpc = defineRpc({
  name: "office.world.request",
  input: z.object({}),
  output: z.string(),
});

export const WorldTenureSchema = z.object({
  days: z.number(),
  choices: z.array(z.number()),
  projects: z.array(
    z.object({
      name: z.string(),
      last: z.number(),
      days: z.number(),
      turns: z.number(),
      due: z.boolean(),
      farewell: z.number(),
      back: z.number(),
      intern: z.boolean(),
      ready: z.boolean(),
      official: z.number(),
    }),
  ),
});
export const LifeEventSchema = z.object({
  type: z.literal("life"),
  born: z.record(z.string(), z.string()),
  tenure: WorldTenureSchema,
  lift: z.object({
    left: z.number(),
    total: z.number(),
    newBuild: z.boolean(),
    sticker: z.object({ version: z.string(), at: z.number(), build: z.string() }).nullable(),
  }),
});
export type LifeEvent = z.output<typeof LifeEventSchema>;
export const lifeSubscription = defineSubscription({
  name: "office.life",
  input: z.object({}),
  event: LifeEventSchema,
});
export const homeDepartureRpc = defineRpc({
  name: "office.home.departure",
  input: z.object({ agentId: z.string().min(1), idleSince: z.string().min(1) }),
  output: z.object({ archived: z.boolean() }),
});
export const tenureRpc = defineRpc({
  name: "office.tenure.request",
  input: z.object({ op: z.enum(["farewell", "official"]), name: z.string().min(1).max(200) }),
  output: z.object({ ok: z.boolean() }),
});

/** Optional car models for the street outside. */
export const streetRpc = defineRpc({
  name: "office.world.street",
  input: z.object({}),
  output: z.string(),
});

/**
 * One language's words for the 3D office, as JSON text `{ dict, ours? }`: the scene carries English and the
 * host sends the rest on request, so a device loads its own language only.
 */
export const worldWordsRpc = defineRpc({
  name: "office.world.words",
  input: z.object({ language: z.enum(WORDS_LANGUAGES) }),
  output: z.string(),
});

const StreetEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("release"), tag: z.string().min(1) }),
  z.object({
    type: z.literal("claude"),
    reading: z.object({ version: z.string(), at: z.number() }).nullable(),
  }),
]);
export type StreetEvent = z.output<typeof StreetEventSchema>;
export const streetSubscription = defineSubscription({
  name: "office.street.events",
  input: z.object({}),
  event: StreetEventSchema,
});
