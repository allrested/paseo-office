import type { OfficeScene } from "../../shared/settings.js";
import type { WordsLanguage } from "../../shared/scene-language.js";
import type { DutyChore, LifeEvent } from "../../shared/contracts.js";
import type { PluginTheme } from "@getpaseo/plugin";

/**
 * The plugin's side of the page that draws the 3D office. The page's side is
 * vendor/my-office/src/office/paseo-entry.js, which sets `PaseoOfficeWorld` on its window.
 */

/** The host can send a resolved sky or let the scene follow its own seasonal decorations. */
export type WorldWeather = import("../../shared/contracts.js").WeatherScene;

/** A person in the office, in the shape the vendored scene reads. */
export interface WorldSession {
  id: string;
  name: string;
  title: string;
  /** The project's folder; the scene seats a project's people together. */
  dir: string;
  git: { repo: string; ci?: "red" | "green"; born?: string };
  /** At work, waiting for the user's answer, or resting. */
  status: "work" | "wait" | "rest";
  /** Which mark the scene puts on the person's screen. */
  agent: "claude" | "codex" | "gemini";
  lastPrompt: string;
  /**
   * When a resting agent came to rest, in milliseconds since the epoch: the host's time of its
   * last change, or when the 3D view saw it come to rest if that is earlier. The scene sends home
   * whoever has rested 30 minutes after 21:00, and says how long someone has rested. Absent while
   * it works, waits or is stopped on an error.
   */
  doneAt?: number;
  /** A red name tag: the agent ended in an error. */
  stuck: boolean;
  /**
   * How many sub-agents the agent waits on, set when its own turn has ended and they are still
   * at work: `status` is `work` then. Paseo's own: upstream's scene does not read it;
   * Paseo's `paseo-entry.js` does, for the `subwait` bubble.
   */
  waitingOn?: number;
  subs: never[];
  /**
   * The context window, in tokens: the paper on the desk grows with it, and a flag stands in it
   * from 85%. Absent when the provider has not said.
   */
  usage?: { ctx: number; ctxMax: number; cost?: number };
}

/**
 * Something a person did; `type` is a key of the scene's action table. No text goes with it:
 * the scene says "a file" and "a command", never which.
 */
export interface WorldEvent {
  sess: string;
  type: WorldEventType;
  /** On a `fail` that is not the agent's own: what failed. The scene words the bubble by it. */
  of?: "deploy";
}

export type WorldEventType =
  | "prompt"
  | "stop"
  | "fail"
  | "read"
  | "grep"
  /** A skill was opened, read or written: upstream's action for it is at the library. */
  | "skill"
  | "edit"
  | "write"
  | "bash"
  | "web"
  | "mcp"
  | "agent"
  | "plan"
  | "test"
  | "commit"
  | "push"
  | "deploy"
  | "testok"
  | "testfail"
  | "testend"
  /** The conversation was compacted or started over: the person takes the paper to the shredder. */
  | "compact"
  /** Paseo's own: the agent's turn has ended and it waits at its desk on its sub-agents. */
  | "subwait";

export interface WorldBoardRow {
  id: string;
  name: string;
  text: string;
  state: "doing" | "wait" | "done";
}

/**
 * A duty of the day's duty board, as the pantry's board shows it. Never its instructions: only
 * its name, who has it and its state.
 */
export interface WorldDuty {
  /** The duty's post: a pretend duty acted out is reported by it (`onDutyDone`). */
  id: string;
  name: string;
  /** The chore it is acted out as; null: its figure walks to the board and back. */
  chore: DutyChore | null;
  /** No agent is asked: the scene picks a free figure to act it out, and reports it done. */
  pretend: boolean;
  /** Who has it: the agent and its name cut short; null while open, or when ticked by hand. */
  holder: { id: string; name: string } | null;
  state: "open" | "claimed" | "done";
  /** Not done on its day: still on the board. */
  owed: boolean;
}

/** Something an agent left listening, as the scene draws it: a small server box. */
export interface WorldDevServer {
  /** Whose it is. Not alive: forgotten, so the box stands in the server room with a red light. */
  owner: { alive: boolean; sid: string };
  /** The box's tooltip starts with it. */
  label: string;
  ports: number[];
  cpu: number;
}

/** The host's readings, in the shape the scene's wall screen, racks and boxes read. */
export interface WorldMachine {
  mem: { used: number; total: number; pressure: "normal" | "critical" } | null;
  cpu: { percent: number };
  devServers: WorldDevServer[];
}

/** An open incident, as the scene's banner and alarm read it. */
export interface WorldIncident {
  id: string;
  key: string;
  title: string;
  /** This device has not rung for it: the scene rings its alarm. */
  ring: boolean;
}

export type WorldColors = PluginTheme["colors"];

/** What the lobby's sign and the reception's plaque show. */
export interface WorldBrand {
  name: string;
  /** The logo's address in full; null draws the scene's own mark. */
  logoUrl: string | null;
}

export type WorldTenure = LifeEvent["tenure"];
export type WorldTenureProject = WorldTenure["projects"][number];
export type WorldLiftService = LifeEvent["lift"];

export interface WorldStartOptions {
  /** Something the office's people would say in the team chat: a kind of moment and a few words. */
  onLife?(kind: string, vars: Record<string, string>): void;
  /** The tenure list's two writes: a farewell was held, an intern was made permanent. */
  onTenure?(op: { op: "farewell" | "official"; name: string }): void;

  scene?: OfficeScene;
  street?: { kit: string | null };
  language?: WordsLanguage;
  words?: string;
  /**
   * The floor plan: "pro" is the company floor, "cozy" one open room, and "hq" headquarters. A page starts once, so a new
   * plan is a new page.
   */
  plan: "pro" | "cozy" | "hq";
  dark: boolean;
  colors: WorldColors;
  /** The lobby's sign. Absent: the scene's own. */
  brand?: WorldBrand;
  onSelect(agentId: string | null): void;
  /** A team's chip was chosen, or the whiteboard (null). */
  onBoard(project: string | null): void;
  onProblem(message: string): void;
  /**
   * The server room was chosen: its chip, the racks or a server box, and the wall screen while
   * `onResources` is absent.
   */
  onMachine?(): void;
  /** The library was chosen: its chip or the bookshelf. Absent: the scene's own card opens. */
  onLibrary?(): void;
  /**
   * The server room's wall screen was chosen. Absent while Paseo has nothing to show for it. The
   * screen can be chosen only while `onMachine` is given and the host has a reading (`setMachine`).
   */
  onResources?(): void;
  /** The bell on the meeting table was clicked. `meet()` rings it without telling. */
  onBell?(): void;
  /** The label over the meeting room's screen was chosen. Absent: the scene shows no label. */
  onNotes?(): void;
  /**
   * A person's session was asked for: E by them while walking in. The surface always supplies it
   * and it opens the session in the office's column, as the card's "Open session" does. Absent
   * only in a caller with no session to open; the scene then chooses the person, as a click does.
   */
  onOpen?(agentId: string): void;
  /** The incidents' banner was chosen. */
  onIncidents?(): void;
  /** The pantry's duty board was chosen. Absent: a click says the day's duties in a note. */
  onDuties?(): void;
  /** A figure acted out a pretend duty (`WorldDuty.id`): the host records it done by that agent. */
  onDutyDone?(id: string, agentId: string): void;
  /** A short line the office says once. */
  onToast?(text: string): void;
  /**
   * A press on the scene's Sound button: the switch is to be on or off. The host stores it and
   * answers with `setSound`; the scene has already applied it, since audio starts only inside a press.
   */
  onSound?(on: boolean): void;
  /** Fullscreen belongs to the surface containing the floor and both sidebars. */
  onToggleFullscreen?(): void;
  /** False hides Photo mode: a WebView cannot keep a download. Absent: Photo mode is offered. */
  photo?: boolean;
}

export interface WorldApi {
  /** A small JPEG of the current floor, where this renderer supports capture. */
  captureGroupPhoto?(): string | null;
  version: number;
  start(options: WorldStartOptions): void;
  /** Gives the graphics context back; the page is thrown away after it. */
  stop(): void;
  setTheme(theme: { dark: boolean; colors: WorldColors }): void;
  setSessions(sessions: readonly WorldSession[]): void;
  event(event: WorldEvent): void;
  select(agentId: string | null): void;
  focusProject(project: string): void;
  setBoardRows(rows: readonly WorldBoardRow[]): void;
  /**
   * The day's duties for the pantry's board. Once given, the scene no longer keeps a rota of its
   * own. Absent on a page built from before the duty board.
   */
  setDuties?(duties: readonly WorldDuty[]): void;
  /**
   * The host's readings. With null the server room is furniture: no chip, no hand, no tap, and
   * the wall screen shows no memory.
   */
  photoRelease?(tag: string): void;
  setClaudeVersion?(reading: { version: string; at: number } | null): void;
  setTenure?(data: WorldTenure): void;
  setLiftService?(info: WorldLiftService): void;
  setMachine(machine: WorldMachine | null): void;
  /**
   * Rings the bell on the meeting table for a stand-up: everyone free walks there and says what
   * they are on. Nothing happens while another gathering is on, or when nobody is free.
   */
  meet?(): void;
  /**
   * A chat that calls a meeting: rings the same bell without telling Paseo (`onBell`), so the
   * stand-up notes writer does not start. Upstream's own opening line, not the stand-up's. Nothing
   * happens while another gathering is on, or when nobody is free.
   */
  gather?(): void;
  /**
   * The open incidents, newest first. The banner names the newest while any is open. One that
   * rings starts the alarm: 25 s of red, a fail bubble over everyone at work and the siren. Several
   * that ring at once ring once.
   */
  setIncidents?(incidents: readonly WorldIncident[]): void;
  /** The weather outside. Older scene versions omit this method. */
  setWeather?(weather: WorldWeather): void;
  /**
   * The device's Sound switch. On plays the scene's sounds once a press has started audio; off, and
   * where the frame never lets audio start, plays none. The scene starts off. Absent on a page built
   * from before sounds.
   */
  setSound?(on: boolean): void;
  setFullscreen?(active: boolean): void;
}

/** The version of the contract above; the page says which it speaks. */
export const WORLD_API_VERSION = 1;

export function isWorldApi(value: unknown): value is WorldApi {
  if (typeof value !== "object" || value === null) return false;
  const api = value as Partial<Record<keyof WorldApi, unknown>>;
  return (
    api.version === WORLD_API_VERSION &&
    typeof api.start === "function" &&
    typeof api.stop === "function" &&
    typeof api.setSessions === "function" &&
    typeof api.event === "function" &&
    typeof api.select === "function" &&
    typeof api.setMachine === "function"
  );
}
