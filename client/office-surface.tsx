import { useChatKeyboard } from "./office-keyboard.js";
import { OfficeBrandContext } from "./office-brand-context.js";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./text.js";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  useRpc,
  useSettings,
  type PluginScreenProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import {
  LOBBY,
  notesReadRpc,
  type ChatMessage,
  type WeatherScene,
  type IncidentsState,
  type Machine,
} from "../shared/contracts.js";
import {
  OFFICE_VIEWS,
  officeDeviceSettings,
  officeHostSettings,
  type OfficeViewChoice,
} from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { ActivityPanel, loadProblem } from "./activity-panel.js";
import { AgentCard } from "./agent-card.js";
import { sheetLeavesFirstOn } from "./agent-picker-text.js";
import { AttentionStrip, type StripCard } from "./attention-strip.js";
import { resourcesOpener } from "./beside.js";
import { BoardSheet } from "./board-sheet.js";
import { DutySheet } from "./duty-sheet.js";
import { useDutyActions } from "./use-duty-actions.js";
import { authorName } from "./board-text.js";
import { useChatSeen } from "./chat-seen.js";
import { TeamChatPreview } from "./team-chat-preview.js";
import { useGroupPhoto } from "./use-group-photo.js";
import { ChatPanel, FloatingTeamChat } from "./chat-panel.js";
import { unreadCount, unreadLabel } from "./chat-text.js";
import {
  COLUMN_MIN,
  FLOOR_MIN,
  countLabel,
  type ColumnTab,
  type ColumnView,
} from "./column-model.js";
import { IncidentsCard } from "./incidents-card.js";
import { weatherEntry } from "./weather-text.js";
import { incidentLine, incidentsEntry } from "./incidents-text.js";
import { UiLanguage, useT } from "./ui-language.js";
import { FloorReplayBar, useFloorReplay } from "./use-floor-replay.js";
import { janitorNote, janitorRows } from "./context-text.js";
import { JanitorCard } from "./janitor-card.js";
import { TimelineCard } from "./timeline-card.js";
import { OpenHistoryContext, OpenTimelineContext } from "./timeline-open.js";
import { VaultCard } from "./vault-card.js";
import { AlertCard } from "./alert-card.js";
import { useAlerts } from "./use-alerts.js";
import { useSshServers } from "./ssh-hosts.js";
import { MachineCard } from "./machine-card.js";
import { hostNote, memoryPercent, namedMachine, type HostNote } from "../shared/machine-text.js";
import {
  buildOfficeModel,
  orderRoomsForFocus,
  type OfficeModel,
  type OfficeRoom,
} from "../shared/model.js";
import type { FocusRequest } from "./focus-request.js";
import { ColumnBar, ColumnDialog, ColumnSheet } from "./column-sheet.js";
import {
  SessionPane,
  sessionChildren,
  sessionOf,
  sessionTabsOf,
  type SessionContext,
} from "./session-pane.js";
import { useReplyDrafts } from "./use-reply-drafts.js";
import { OfficeWorkspace, type WorkspaceSelection } from "./workspace-office-tools.js";
import { OfficeCardsDialog, type OfficeCard } from "./office-cards.js";
import { OfficeDialogs } from "./office-modal.js";
import { FullscreenSettings, useOfficeSettingsDialog } from "./office-settings.js";
import { OfficeColumn, type ColumnBadges, type ColumnSession } from "./office-column.js";
import { EMPTY_CHOICE, type NewAgentChoice } from "./new-agent-model.js";
import type { ChatDraft, ColumnPanelProps, NewAgentDraft, OfficeLink } from "./office-link.js";
import type { SidebarLauncher } from "./sidebar-launcher.js";
import { SessionsPanel } from "./sessions-panel.js";
import { PixelOffice } from "./pixel/pixel-office.js";
import { StructureView } from "./structure-view.js";
import { SESSION_RAIL_MIN, useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useBoardActions } from "./use-board-actions.js";
import { useDeviceSwitch } from "./use-device-switch.js";
import { fullscreenTheme } from "./fullscreen-theme.js";
import { FullscreenHeader, type SidebarControls } from "./fullscreen-header.js";
import { useColumn, type ColumnState } from "./use-column.js";
import { LibraryCard } from "./library-card.js";
import { NotesCard } from "./notes-card.js";
import { leaveFullscreenAfter, lockEscape, pageUsesEscape, unlockEscape } from "./world/escape.js";
import { todayZone } from "./notes-text.js";
import { QaCard } from "./qa-card.js";
import { ReviewCard } from "./review-card.js";
import { settingsEntry, settingsProblems } from "./settings-text.js";
import { StandupCard } from "./standup-card.js";
import { useIncidents } from "./use-incidents.js";
import { useJanitor } from "./use-janitor.js";
import { useLibrary } from "./use-library.js";
import { useQa } from "./use-qa.js";
import { useReviews } from "./use-reviews.js";
import { useScriptLog } from "./use-script-log.js";
import { useStandup } from "./use-standup.js";
import { useMachine } from "./use-machine.js";
import {
  PlanPickerContext,
  PlanUsageContext,
  usePlanUsage,
  type PlanState,
} from "./use-plan-usage.js";
import { planNote } from "../shared/plan-usage.js";
import { useOffice, type OfficeState } from "./use-office.js";
import { UNSAVED_SOUND, useSoundSwitch, type SoundSwitch } from "./use-sound.js";
import { ViewSwitch } from "./view-switch.js";
import { hasWebGL2 } from "./web-env.web.js";
import { hasScriptFrame } from "./world/script-frame-kit.js";
import { useFloorPlan } from "./world/use-floor-plan.js";
import { useOfficeScene } from "./use-street.js";
import { WorldView } from "./world/world-view.js";
import { WorldViewNative } from "./world/world-view-native.js";

export type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

type Platform = OfficeSurfaceProps["layout"]["platform"];

/** What a browser says about its pointers. */
export interface PointerFacts {
  /** Any pointer of the device is coarse: `(any-pointer: coarse)`. */
  anyCoarse: boolean;
  touchPoints: number;
}

/**
 * The app's hasTouchScreen (packages/app/src/hooks/pointer-capabilities.ts), which a plugin cannot
 * import: native is always a touch screen, a browser answers for itself, and where there is no
 * browser to ask the answer is no.
 */
export function hasTouchScreen(platform: Platform, pointer: PointerFacts | null): boolean {
  if (platform !== "web") return true;
  return pointer !== null && (pointer.anyCoarse || pointer.touchPoints > 0);
}

// Web only: the surface asks when layout.platform is "web", and nothing asks at module top level.
export function readPointer(): PointerFacts | null {
  if (typeof window === "undefined") return null;
  return {
    anyCoarse:
      typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches,
    touchPoints: window.navigator.maxTouchPoints,
  };
}

// A word with a sentence's capital ("Unexpected", "Failed"), not a name such as WebGL or Paseo.
const SENTENCE_START = /^(?!Paseo\b)[A-Z][a-z]+(?=\s|$)/;

/**
 * A failure and its reason as one sentence. The reason comes from outside (three.js, the
 * browser, the host), so it may start with a capital and end with a full stop.
 */
export function problemText(failure: string, reason: string): string {
  // A reason that is already a failure sentence is shown as it is, as failureText does.
  if (reason.trim().startsWith("Unable to")) return reason.trim();
  const text = reason.trim().replace(/[.\s]+$/, "");
  if (text === "") return failure;
  const first = SENTENCE_START.test(text) ? text.charAt(0).toLowerCase() : text.charAt(0);
  return `${failure}: ${first}${text.slice(1)}`;
}

/** The selection to keep: none once its agent has left the model or the data stopped being live. */
export function keptSelection(
  selectedId: string | null,
  agents: ReadonlyMap<string, unknown>,
  live: boolean,
): string | null {
  if (selectedId === null || !live || !agents.has(selectedId)) return null;
  return selectedId;
}

/** The device's view setting, as far as the surface reads it. */
export type ViewSetting =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready"; values: { threeD: boolean; view?: OfficeViewChoice | undefined } };

/** What a device holds: the view somebody chose there, or "auto" where nobody did. */
export type SavedView = OfficeViewChoice | "auto";

/**
 * The view somebody chose in a stored setting; null where nobody did. A setting from before
 * there were three views has the 3D switch alone: off was the list, on chose nothing.
 */
export function chosenView(values: {
  threeD: boolean;
  view?: OfficeViewChoice | undefined;
}): OfficeViewChoice | null {
  return values.view ?? (values.threeD ? null : "list");
}

/** The saved view: not known while it is read, and "auto" when it cannot be read. */
export function savedView(setting: ViewSetting): SavedView | null {
  if (setting.status === "loading") return null;
  if (setting.status !== "ready") return "auto";
  return chosenView(setting.values) ?? "auto";
}

/**
 * The view a saved choice means on this device. Only a device that can draw the 3D office shows
 * it; anywhere else that choice, and no choice, is the 2D one.
 */
export function viewOnDevice(saved: SavedView, can3d: boolean): OfficeViewChoice {
  if (saved === "2d" || saved === "list") return saved;
  return can3d ? "3d" : "2d";
}

/** The views a device offers, in the switch's order. */
export function viewOptions(can3d: boolean): readonly OfficeViewChoice[] {
  return can3d ? OFFICE_VIEWS : OFFICE_VIEWS.filter((view) => view !== "3d");
}

/**
 * Whether this device can draw the 3D office: a browser with WebGL2, or an app whose kit has
 * ScriptFrame. The other is not asked. On an app the page finds out whether the phone has WebGL2
 * (the scene reports a problem if not), and the surface gives way to 2D.
 */
export function canDraw3D(
  platform: Platform,
  webgl2: () => boolean,
  scriptFrame: () => boolean,
): boolean {
  return platform === "web" ? webgl2() : scriptFrame();
}

/** The view that draws the 3D office: its frame in a browser, ScriptFrame in an app. */
export function worldViewFor(platform: Platform): typeof WorldView | typeof WorldViewNative {
  return platform === "web" ? WorldView : WorldViewNative;
}

/** A device setting as a switch's saves see it; null while it is read or unreadable. */
export interface StoredSwitch<Value> {
  /** Null when the store holds no choice or no valid setting: any tap overwrites it. */
  value: Value | null;
  revision: string;
}

/** A save of the switch the surface started, and how far it got. */
export interface SwitchSave<Value> {
  value: Value;
  /** The revision it was saved against. */
  against: string;
  /**
   * saving: not back yet. saved: stored, the store's new revision not yet read. failed: refused,
   * the store is read again. checked: refused, and the store was read again. given-up: refused for
   * good; `against` is then the revision the store held, and a change from elsewhere wins.
   */
  phase: "saving" | "saved" | "failed" | "checked" | "given-up";
}

/** A switch's taps against the device store: at most one save in flight. */
export interface SwitchSync<Value> {
  /** The last tap while it is not known to be stored; null shows the stored value. */
  wanted: Value | null;
  save: SwitchSave<Value> | null;
  /** Saves retried after a conflict since the last tap. */
  retries: number;
}

export type SwitchEvent<Value> =
  | { type: "tap"; value: Value }
  | { type: "start"; value: Value; against: string; retry: boolean }
  | { type: "returned"; stored: boolean }
  | { type: "checked" }
  | { type: "give-up"; revision: string }
  | { type: "settle" };

/**
 * idle: no tap waits. wait: a save or a read is on its way. save: store the last tap. settle: the
 * store holds the last tap, or another writer changed it after a give-up, so stop holding it here.
 * give-up: the store refused it; the switch keeps showing the tap until the next tap, a change
 * from elsewhere or the surface closes.
 */
export type SwitchStep<Value> =
  | { kind: "idle" | "wait" | "settle" | "give-up" }
  | { kind: "save"; value: Value; against: string; retry: boolean };

export const IDLE_SWITCH: SwitchSync<never> = { wanted: null, save: null, retries: 0 };

/** One retry per conflict; a second conflict for the same tap gives up. */
const CONFLICT_RETRIES = 1;

export function switchSync<Value>(
  sync: SwitchSync<Value>,
  event: SwitchEvent<Value>,
): SwitchSync<Value> {
  switch (event.type) {
    case "tap": {
      // A save still on its way stays in flight; a refused one is forgotten, so the tap tries anew.
      const busy = sync.save?.phase === "saving" || sync.save?.phase === "saved";
      return { wanted: event.value, save: busy ? sync.save : null, retries: 0 };
    }
    case "start":
      return {
        ...sync,
        save: { value: event.value, against: event.against, phase: "saving" },
        retries: sync.retries + (event.retry ? 1 : 0),
      };
    case "returned":
      if (sync.save === null) return sync;
      return { ...sync, save: { ...sync.save, phase: event.stored ? "saved" : "failed" } };
    case "checked":
      if (sync.save?.phase !== "failed") return sync;
      return { ...sync, save: { ...sync.save, phase: "checked" } };
    case "give-up": {
      const { save } = sync;
      if (save === null) return sync;
      if (save.phase === "given-up" && save.against === event.revision) return sync;
      return { ...sync, save: { ...save, phase: "given-up", against: event.revision } };
    }
    case "settle":
      return IDLE_SWITCH;
  }
}

/**
 * What the switch does next, given the last tap, what the device holds and the save in flight.
 * Every save goes against the revision the store holds now, so taps are stored in their order.
 * A refused save is judged once the store was read again: a revision that moved is a conflict
 * and is retried once; one that did not move is a refusal for another reason, never retried.
 */
export function nextSwitchStep<Value>(
  sync: SwitchSync<Value>,
  stored: StoredSwitch<Value> | null,
): SwitchStep<Value> {
  if (sync.wanted === null) return { kind: "idle" };
  if (stored === null) return { kind: "wait" };
  const { save } = sync;
  let conflict = false;
  if (save !== null) {
    if (save.phase === "saving") return { kind: "wait" };
    // Given up: nothing is saved again, and a revision that moved was written elsewhere.
    if (save.phase === "given-up") {
      return stored.revision === save.against ? { kind: "give-up" } : { kind: "settle" };
    }
    if (stored.revision === save.against) {
      if (save.phase !== "checked") return { kind: "wait" };
      // Refused, but the store already holds the last tap: nothing is left to keep here.
      return stored.value === sync.wanted ? { kind: "settle" } : { kind: "give-up" };
    }
    conflict = save.phase !== "saved";
  }
  if (stored.value === sync.wanted) return { kind: "settle" };
  if (conflict && sync.retries >= CONFLICT_RETRIES) return { kind: "give-up" };
  return { kind: "save", value: sync.wanted, against: stored.revision, retry: conflict };
}

/**
 * The switch shows a tap the device refused to store: the view follows it until the surface
 * closes, and after a reload the stored value is back.
 */
export function switchUnsaved(sync: SwitchSync<unknown>): boolean {
  return sync.save?.phase === "given-up";
}

const NOTHING_WAITS = "Nothing needs you.";

export const UNSAVED_VIEW =
  "Unable to save the view on this device. It holds until the office is closed.";

/** The line under the device's switches: the view's refusal first, then the Sound switch's. */
export function deviceProblemOf(viewUnsaved: boolean, soundUnsaved: boolean): string | null {
  if (viewUnsaved) return UNSAVED_VIEW;
  return soundUnsaved ? UNSAVED_SOUND : null;
}

/** The view's next request for an agent. Nonces start at 1: the scene counts 0 as handled. */
export function nextFocusRequest(previous: FocusRequest | null, agentId: string): FocusRequest {
  return { agentId, nonce: (previous?.nonce ?? 0) + 1 };
}

/** What the surface shows; "pending" while the device's choice is being read. */
export type OfficeView = "pending" | OfficeViewChoice;

export interface OfficeViewInput {
  /** The view chosen on this device; null while the device's setting is being read. */
  choice: OfficeViewChoice | null;
  /** Why 3D failed on this surface, if it did. */
  problem: string | null;
}

/**
 * What the surface shows. It waits for the choice, so no other view flashes before the chosen
 * one. A 3D office that failed gives way to the 2D one, under a banner with a way to try again.
 */
export function officeView({ choice, problem }: OfficeViewInput): OfficeView {
  if (choice === null) return "pending";
  return choice === "3d" && problem !== null ? "2d" : choice;
}

export interface ViewChoiceState {
  /** The views this device offers. */
  options: readonly OfficeViewChoice[];
  /** The chosen view; null while the device's setting is being read. */
  choice: OfficeViewChoice | null;
  /** The device refused to store the last tap. */
  unsaved: boolean;
  choose(next: OfficeViewChoice): void;
}

function viewSync(
  sync: SwitchSync<OfficeViewChoice>,
  event: SwitchEvent<OfficeViewChoice>,
): SwitchSync<OfficeViewChoice> {
  return switchSync(sync, event);
}

/** What a view's save keeps while the device's document is unreadable: its defaults. */
const DEVICE_DEFAULTS = officeDeviceSettings.schema.parse({});

/** The per-device view. The 3D office is loaded only where it is the chosen view. */
export function useViewChoice(platform: Platform): ViewChoiceState {
  const settings = useSettings(officeDeviceSettings);
  const can3d = useMemo(() => canDraw3D(platform, hasWebGL2, hasScriptFrame), [platform]);
  // The view follows the tap at once. A choice the device could not store stays here, so the
  // switch still does what it says until the surface closes.
  const [sync, dispatch] = useReducer(viewSync, IDLE_SWITCH);
  // A save or a read that comes back after the surface closed sets nothing and saves nothing.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const storedValue = settings.status === "ready" ? chosenView(settings.values) : null;
  // A view's save carries the rest of the device's document as read (the incidents rung, the last
  // agent, the Sound switch, whatever a later field holds), so no key is passed without a value.
  const kept = settings.status === "ready" ? settings.values : DEVICE_DEFAULTS;
  const { save, reload } = settings;
  useEffect(() => {
    const stored = revision === null ? null : { value: storedValue, revision };
    const step = nextSwitchStep(sync, stored);
    if (step.kind === "settle") dispatch({ type: "settle" });
    if (step.kind === "give-up" && stored !== null) {
      dispatch({ type: "give-up", revision: stored.revision });
    }
    if (step.kind !== "save") return;
    dispatch({ type: "start", value: step.value, against: step.against, retry: step.retry });
    async function store(value: OfficeViewChoice, against: string): Promise<void> {
      const ok = await save({ ...kept, threeD: value !== "list", view: value }, against);
      if (!mounted.current) return;
      dispatch({ type: "returned", stored: ok });
      if (ok) return;
      // Read the store again: its revision tells a conflict from a refusal.
      await reload().catch(() => undefined);
      if (mounted.current) dispatch({ type: "checked" });
    }
    void store(step.value, step.against);
  }, [sync, revision, storedValue, kept, save, reload]);
  const choose = useCallback(
    (next: OfficeViewChoice) => dispatch({ type: "tap", value: next }),
    [],
  );
  const options = useMemo(() => viewOptions(can3d), [can3d]);
  const saved = sync.wanted ?? savedView(settings);
  return {
    options,
    choice: saved === null ? null : viewOnDevice(saved, can3d),
    unsaved: switchUnsaved(sync),
    choose,
  };
}

/** The zone the stand-up notes' "today" is judged in, from the host's notes time zone. */
function useNotesTimeZone(): string {
  const settings = useSettings(officeHostSettings);
  const setting = settings.status === "ready" ? settings.values.notesTimeZone : "";
  return useMemo(() => todayZone(setting), [setting]);
}

interface SceneProblemProps {
  message: string;
  onRetry(): void;
  styles: OfficeStyles;
}

interface ProblemBannerProps {
  text: string;
  styles: OfficeStyles;
  children?: ReactNode;
}

/** A failure in the app's bordered banner, with room for a way out under the sentence. */
function ProblemBanner({ text, styles, children }: ProblemBannerProps) {
  return (
    <View style={styles.bannerSlot}>
      <View style={styles.banner}>
        <Text accessibilityRole="alert" style={styles.bannerText}>
          {text}
        </Text>
        {children}
      </View>
    </View>
  );
}

function SceneProblem({ message, onRetry, styles }: SceneProblemProps) {
  return (
    <ProblemBanner text={problemText("Unable to show the 3D view", message)} styles={styles}>
      <View style={styles.actions}>
        <ActionButton
          label="Try 3D again"
          pendingLabel="Trying..."
          onPress={onRetry}
          styles={styles}
        />
      </View>
    </ProblemBanner>
  );
}

function SurfaceNotices({
  fullscreenError,
  choice,
  sceneProblem,
  retryScene,
  styles,
}: {
  fullscreenError: boolean;
  choice: OfficeViewChoice | null;
  sceneProblem: string | null;
  retryScene(): void;
  styles: OfficeStyles;
}) {
  return (
    <>
      {fullscreenError ? (
        <ProblemBanner text="The browser could not switch full screen." styles={styles} />
      ) : null}
      {choice === "3d" && sceneProblem !== null ? (
        <SceneProblem message={sceneProblem} onRetry={retryScene} styles={styles} />
      ) : null}
    </>
  );
}

interface PanelButtonProps {
  /** What it opens, and what a screen reader calls it. */
  label: string;
  caption?: string | undefined;
  /** A Lucide name. */
  icon: string;
  screenId: string;
  size: number;
  /** The theme's foreground: an icon-only control's glyph, not a label's muted one. */
  color: string;
  /** What is new behind it, shown over the icon; null when nothing is. */
  count?: string | null;
  onOpen(screenId: string): void;
  styles: OfficeStyles;
}

/**
 * A panel's button in the header: a segment's pill with the kit's icon in it. It shows a screen
 * beside the floor, so it has no chosen state: the side area's header says what is shown.
 */
function PanelButton({
  caption,
  icon,
  screenId,
  size,
  color,
  count,
  onOpen,
  styles,
  ...given
}: PanelButtonProps) {
  const label = useT()(given.label);
  const press = useCallback(() => onOpen(screenId), [onOpen, screenId]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={caption ? styles.sidebarButton : styles.segment}
    >
      {hovered || pressed ? <View style={styles.segmentHoverFill} /> : null}
      {/* The count sits on the icon's corner, inside the pill that clips. */}
      <View>
        <Icon name={icon} size={size} color={color} />
        {count ? (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {caption && (
        <Text numberOfLines={1} style={styles.sidebarButtonText}>
          {caption}
        </Text>
      )}
    </Pressable>
  );
}

interface SettingsButtonProps {
  onOpen(): void;
  compact: boolean;
  touchScreen: boolean;
  color: string;
  styles: OfficeStyles;
}

/**
 * The way to the office's settings screen, drawn like the panels' buttons. `PanelButton` presses
 * with a screen id; the settings press takes none, so the id here is unused.
 */
function SettingsButton({ onOpen, compact, touchScreen, color, styles }: SettingsButtonProps) {
  return (
    <PanelButton
      label="Office settings"
      icon="Settings"
      screenId="settings"
      size={compact || touchScreen ? 20 : 16}
      color={color}
      onOpen={onOpen}
      styles={styles}
    />
  );
}

interface SurfaceBodyProps {
  onPhotoReady: ReturnType<typeof useGroupPhoto>["onPhotoReady"];
  fullscreen?: { active: boolean; toggle(): void } | undefined;
  office: OfficeState;
  model: OfficeModel;
  rooms: readonly OfficeRoom[];
  view: OfficeView;
  theme: PluginTheme;
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /** Whose card is open. */
  selectedAgentId: string | null;
  styles: OfficeStyles;
  compact: boolean;
  actions: AgentActions;
  name(author: string): string;
  /** Null from the 3D office, when the chosen person is tapped again. */
  onSelectAgent(agentId: string | null): void;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenAgentWorkspace(agentId: string): void;
  onOpenBoard(roomId: string): void;
  /**
   * The duty board's editor: the 3D pantry's board and the List's lobby card open it. Absent while
   * the host has sent no duty list.
   */
  onOpenDuties: (() => void) | undefined;
  /** The 3D office acted out a pretend duty with this agent's figure. */
  onDutyActed(id: string, agentId: string): void;
  machine: Machine | null;
  onOpenMachine(): void;
  /** The 3D wall screen's: absent on an app that cannot show Resources beside the floor. */
  onOpenResources: (() => void) | undefined;
  onOpenLibrary(): void;
  /** The 3D office's label over the meeting room's screen. */
  onOpenNotes(): void;
  janitor: HostNote | null;
  onOpenJanitor(): void;
  /** The stand-up is open. */
  meeting: boolean;
  weather?: WeatherScene | undefined;
  incidents: IncidentsState | undefined;
  /** The 3D office's incidents banner. */
  onOpenIncidents(): void;
  onSceneProblem(message: string): void;
  platform: Platform;
  /** The device's Sound switch, which the 3D office follows and its button sets. */
  sound: SoundSwitch;
  street: ReturnType<typeof useOfficeScene>;
}

function SurfaceBody({
  onPhotoReady,
  fullscreen,
  office,
  model,
  rooms,
  view,
  theme,
  focusRoomId,
  focusRequest,
  selectedAgentId,
  styles,
  compact,
  actions,
  name,
  onSelectAgent,
  onOpenSession,
  onOpenAgentWorkspace,
  onOpenBoard,
  onOpenDuties,
  onDutyActed,
  machine,
  onOpenMachine,
  onOpenResources,
  onOpenLibrary,
  onOpenNotes,
  janitor,
  onOpenJanitor,
  meeting,
  weather,
  incidents,
  onOpenIncidents,
  onSceneProblem,
  platform,
  sound,
  street,
}: SurfaceBodyProps) {
  const plan = useFloorPlan();
  if (office.subscription.status === "error") {
    const { message } = office.subscription.error;
    return (
      <ProblemBanner text={problemText("Unable to load the office", message)} styles={styles} />
    );
  }
  // Closed means the plugin's handler finished, and the hook does not subscribe again: without
  // this the rows would stay on screen and never change.
  if (office.subscription.status === "closed") {
    return (
      <ProblemBanner
        text="Unable to show live agents: the host closed the office. Reopen it."
        styles={styles}
      />
    );
  }
  if (!office.loaded || view === "pending") {
    return <Text style={styles.sceneStatus}>Loading...</Text>;
  }
  if (view === "3d") {
    const World = worldViewFor(platform);
    return (
      <World
        onPhotoReady={onPhotoReady}
        fullscreen={fullscreen}
        model={model}
        theme={theme}
        styles={styles}
        plan={plan}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
        onSelectBoard={onOpenBoard}
        onOpenDuties={onOpenDuties}
        onDutyActed={onDutyActed}
        machine={machine}
        onOpenMachine={onOpenMachine}
        onOpenResources={onOpenResources}
        onOpenAgentWorkspace={onOpenAgentWorkspace}
        onOpenLibrary={onOpenLibrary}
        onOpenNotes={onOpenNotes}
        meeting={meeting}
        weather={weather}
        incidents={incidents}
        onOpenIncidents={onOpenIncidents}
        onProblem={onSceneProblem}
        sound={sound}
        streetOn={street.scene.on === null ? null : street.scene.on === "city"}
        scene={street.scene.on ?? undefined}
        night={
          street.lighting.on === "auto" || street.lighting.on === null
            ? undefined
            : street.lighting.on === "night"
        }
      />
    );
  }
  if (view === "2d") {
    return (
      <PixelOffice
        model={model}
        rooms={rooms}
        theme={theme}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        onSelectAgent={onSelectAgent}
        onSelectBoard={onOpenBoard}
        machine={machine}
        onOpenMachine={onOpenMachine}
        janitor={janitor}
        onOpenJanitor={onOpenJanitor}
        meeting={meeting}
        incident={incidentLine(incidents)}
        onOpenIncidents={onOpenIncidents}
      />
    );
  }
  return (
    <StructureView
      rooms={rooms}
      styles={styles}
      compact={compact}
      actions={actions}
      name={name}
      onSelectAgent={onSelectAgent}
      onOpenSession={onOpenSession}
      onOpenBoard={onOpenBoard}
      onOpenDuties={onOpenDuties}
    />
  );
}

interface BoardSheetState {
  /** The room whose board sheet is open. */
  room: OfficeRoom | null;
  open(roomId: string): void;
  /** A room chosen on the board that is open, the lobby's: Back returns to that board. */
  openFromBoard(roomId: string): void;
  /** Back to the board this one was opened from; absent when it was opened from elsewhere. */
  back: (() => void) | undefined;
  close(): void;
}

interface OpenBoard {
  roomId: string | null;
  /** The board this one was opened from. */
  backTo: string | null;
}

const NO_BOARD: OpenBoard = { roomId: null, backTo: null };

/** Which room's board sheet is open: none once its room has left or the data stopped being live. */
function useBoardSheet(model: OfficeModel, live: boolean): BoardSheetState {
  const [{ roomId, backTo }, setBoard] = useState(NO_BOARD);
  const open = useCallback((next: string) => setBoard({ roomId: next, backTo: null }), []);
  const openFromBoard = useCallback(
    (next: string) => setBoard((current) => ({ roomId: next, backTo: current.roomId })),
    [],
  );
  const goBack = useCallback(
    () => setBoard((current) => ({ roomId: current.backTo, backTo: null })),
    [],
  );
  const close = useCallback(() => setBoard(NO_BOARD), []);
  const room =
    roomId === null || !live
      ? null
      : (model.rooms.find((candidate) => candidate.id === roomId) ?? null);
  return { room, open, openFromBoard, back: backTo === null ? undefined : goBack, close };
}

/** An agent chosen on a board: the board leaves, and the agent opens as it does from its desk. */
function useBoardSelect(close: () => void, select: (agentId: string) => void) {
  return useCallback(
    (agentId: string) => {
      close();
      select(agentId);
    },
    [close, select],
  );
}

interface CardOpening {
  open: boolean;
  /** When the card last opened: the notes line's "today", the incidents' ages. */
  openedAt: number;
  show(): void;
  close(): void;
}

/** Whether a card is open, and when it last opened: never open while the data is frozen. */
function useCardOpening(live: boolean): CardOpening {
  const [opened, setOpened] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const show = useCallback(() => {
    setOpenedAt(Date.now());
    setOpened(true);
  }, []);
  const close = useCallback(() => setOpened(false), []);
  return { open: opened && live, openedAt, show, close };
}

interface ViewControlsProps {
  keyboardVisible: boolean;
  badges: ColumnBadges;
  sidebars?: SidebarControls;
  full: ReturnType<typeof useFullscreen>;
  /** True once a floor is drawn under them: they take its corner, else a row of the page. */
  floorDrawn: boolean;
  viewChoice: ViewChoiceState;
  /** The device refused to store a press on the 3D floor's Sound button. */
  soundUnsaved: boolean;
  toolbarLabels: boolean;
  onTeam(): void;
  machine: Machine | null;
  onMachine?: () => void;
  shortcuts?: readonly Shortcut[];
  onChange(next: OfficeViewChoice): void;
  compact: boolean;
  touchScreen: boolean;
  color: string;
  onOpenSettings: (() => void) | undefined;
  styles: OfficeStyles;
}

function HostResourceButton({
  machine,
  onOpen,
  styles,
}: {
  machine: Machine | null;
  onOpen(): void;
  styles: OfficeStyles;
}) {
  const percent = machine ? memoryPercent(machine) : null;
  // A plan close to its limit takes the button's words: that is what stops the work first.
  const plan = planNote(useContext(PlanUsageContext));
  const planText = useMemo(
    () => [styles.sidebarButtonText, plan && styles.stripNote[plan.tone]],
    [styles, plan],
  );
  if (plan !== null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Host resources. Plan limit: ${plan.text}`}
        onPress={onOpen}
        style={styles.sidebarButton}
      >
        <Icon name="Gauge" size={15} color={String(styles.stripNote[plan.tone].color)} />
        <Text style={planText}>{plan.text}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Host resources"
      onPress={onOpen}
      style={styles.sidebarButton}
    >
      <Icon name="Cpu" size={15} color={String(styles.sidebarButtonText.color)} />
      <Text style={styles.sidebarButtonText}>{percent === null ? "Host" : `RAM ${percent}%`}</Text>
    </Pressable>
  );
}

/** A card of the office, listed behind the toolbar's Office button. */
type Shortcut = OfficeCard;

function shortcutsOf(entries: readonly (readonly [StripCard | null, string])[]): Shortcut[] {
  return entries.flatMap(([entry, icon]) => (entry === null ? [] : [{ ...entry, icon }]));
}

/** A card that asks for a look: its note is a warning or worse. One that only informs does not. */
function needsLook(card: StripCard): boolean {
  return card.note.tone !== "muted";
}

/**
 * The Attention strip's cards. A docked office has the informing ones as toolbar icons, so its
 * strip holds only what needs a look; elsewhere (a phone) the strip is the only way to them.
 */
function stripCards(
  first: readonly (StripCard | null)[],
  shortcuts: readonly Shortcut[],
  docked: boolean,
): StripCard[] {
  const all = [...first, ...shortcuts].filter((card) => card !== null);
  return docked ? all.filter(needsLook) : all;
}

const NO_SHORTCUTS: readonly Shortcut[] = [];

/**
 * One button for the office's own cards: it opens their names, each with what it says. Its count
 * is the cards that ask for a look.
 */
function ShortcutButtons({
  shortcuts = NO_SHORTCUTS,
  caption,
  size,
  color,
  styles,
}: {
  shortcuts?: readonly Shortcut[] | undefined;
  /** The button's name beside its icon, where the toolbar has room for names. */
  caption: boolean;
  size: number;
  color: string;
  styles: OfficeStyles;
}) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  if (shortcuts.length === 0) return null;
  return (
    <>
      <PanelButton
        label="Office cards"
        caption={caption ? "Office" : undefined}
        icon="LayoutGrid"
        screenId="office-cards"
        size={size}
        count={countLabel(shortcuts.filter(needsLook).length)}
        color={color}
        onOpen={show}
        styles={styles}
      />
      <OfficeCardsDialog
        cards={shortcuts}
        open={open}
        color={color}
        onClose={close}
        styles={styles}
      />
    </>
  );
}

/** The view switch and the settings button. */
function ViewControls({
  keyboardVisible,
  badges,
  sidebars,
  full,
  floorDrawn,
  viewChoice,
  soundUnsaved,
  toolbarLabels,
  onTeam,
  machine,
  onMachine,
  shortcuts,
  onChange,
  compact,
  touchScreen,
  color,
  onOpenSettings,
  styles,
}: ViewControlsProps) {
  const problem = deviceProblemOf(viewChoice.unsaved, soundUnsaved);
  const modes = useMemo(
    () => (
      <ViewSwitch
        options={viewChoice.options}
        value={viewChoice.choice}
        onChange={onChange}
        styles={styles}
      />
    ),
    [viewChoice.options, viewChoice.choice, onChange, styles],
  );
  const showOffice = useCallback(() => {
    onChange(viewChoice.options.includes("3d") ? "3d" : "2d");
    sidebars?.column.show("activity");
  }, [onChange, viewChoice.options, sidebars]);
  if (compact && keyboardVisible) return null;
  const actions = (
    <>
      {sidebars && onMachine && (
        <HostResourceButton machine={machine} onOpen={onMachine} styles={styles} />
      )}
      {sidebars && (
        <PanelButton
          label="Team chat"
          caption={toolbarLabels ? "Team chat" : undefined}
          icon="MessageCircle"
          screenId="team"
          size={18}
          count={badges.chat}
          color={color}
          onOpen={onTeam}
          styles={styles}
        />
      )}
      {sidebars ? (
        <ShortcutButtons
          shortcuts={shortcuts}
          caption={toolbarLabels}
          size={touchScreen ? 20 : 16}
          color={color}
          styles={styles}
        />
      ) : null}
      {full.available ? (
        <PanelButton
          label={full.active ? "Exit full screen" : "Full screen"}
          icon={full.active ? "Minimize" : "Maximize"}
          screenId="fullscreen"
          size={touchScreen ? 20 : 16}
          color={color}
          onOpen={full.toggle}
          styles={styles}
        />
      ) : null}
      {onOpenSettings ? (
        <SettingsButton
          onOpen={onOpenSettings}
          compact={compact}
          touchScreen={touchScreen}
          color={color}
          styles={styles}
        />
      ) : null}
    </>
  );
  const notice =
    problem === null ? null : (
      <Text accessibilityRole="alert" style={styles.actionError}>
        {problem}
      </Text>
    );
  if (sidebars) {
    return (
      <>
        <FullscreenHeader
          sidebars={sidebars}
          badges={badges}
          modes={modes}
          onOffice={showOffice}
          color={color}
          styles={styles}
        >
          {actions}
        </FullscreenHeader>
        {notice}
      </>
    );
  }
  const floating = floorDrawn && !compact;
  return (
    <View
      testID={floating ? "office-view-corner" : "office-view-row"}
      style={floating ? styles.viewCorner : styles.viewRow}
    >
      <View style={styles.viewControls}>
        {modes}
        {actions}
      </View>
      {notice}
    </View>
  );
}

/** The Chat tab's count: the chat's messages since it was last open on this device. */
function useUnread(chat: OfficeState["chat"]): string | null {
  const seenAt = useChatSeen();
  return unreadLabel(unreadCount(chat?.messages ?? [], seenAt));
}

function SessionsSidebar({
  open,
  size,
  styles,
  ...panel
}: ColumnPanelProps & { open: boolean; size: { width: number } }) {
  return (
    <View style={open ? size : styles.hidden} testID="office-sessions-sidebar">
      <View style={styles.sessionRail}>
        <View style={styles.sessionRailHeading}>
          <Text accessibilityRole="header" style={styles.sessionRailTitle}>
            Sessions
          </Text>
          {panel.office.loaded && panel.office.subscription.status === "live" ? (
            <View style={styles.liveLabel}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : null}
        </View>
        <SessionsPanel {...panel} styles={styles} />
      </View>
    </View>
  );
}

interface ColumnPanelSwitchProps extends ColumnPanelProps {
  onCloseChat?: (() => void) | undefined;
  tab: ColumnTab;
  /** The Attention tab's content. */
  attention: ReactNode;
  /** The Chat tab's box, kept here while another tab is shown. */
  draft: ChatDraft;
}

/** The chosen tab's panel. Only that one is mounted: Chat counts as seen while it is. */
function ColumnPanel({ tab, attention, draft, onCloseChat, ...panel }: ColumnPanelSwitchProps) {
  if (tab === "attention") {
    return (
      <ScrollView contentContainerStyle={panel.styles.columnAttention}>{attention}</ScrollView>
    );
  }
  if (tab === "sessions") return <SessionsPanel {...panel} />;
  if (tab === "activity") return <ActivityPanel {...panel} />;
  return <ChatPanel {...panel} draft={draft} onClose={onCloseChat} />;
}

interface ColumnViewPanelProps extends Omit<ColumnPanelSwitchProps, "tab"> {
  view: ColumnView;
  session: SessionContext;
}

/** The chosen view's panel: a tab's, or an open session's. */
function ColumnViewPanel({ view, session, ...panel }: ColumnViewPanelProps) {
  if (view.kind === "session") {
    const { model, replies, ...context } = session;
    const { agent, room } = sessionOf(model, view.agentId);
    return (
      <SessionPane
        agentId={view.agentId}
        inSheet={panel.layout.compact}
        subagents={sessionChildren(model, view.agentId)}
        onOpenSubagent={panel.link.openSession}
        agent={agent}
        room={room}
        reply={replies.texts.get(view.agentId) ?? ""}
        setReply={replies.setText}
        context={context}
        styles={panel.styles}
        layout={panel.layout}
      />
    );
  }
  return <ColumnPanel tab={view.tab} {...panel} />;
}

/** What is typed in the Chat tab's box: the surface's, so a tab switch or a closed sheet keeps it. */
function useChatDraft(): ChatDraft {
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [images, setImages] = useState<ChatDraft["images"]>([]);
  return useMemo(
    () => ({ text, setText, replyTo, setReplyTo, recipient, setRecipient, images, setImages }),
    [text, replyTo, recipient, images],
  );
}

/** What is chosen and typed in the Sessions tab's New agent form: the surface's, as the chat's is. */
function useNewAgentDraft(): NewAgentDraft {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<NewAgentChoice>(EMPTY_CHOICE);
  const change = useCallback((patch: Partial<NewAgentChoice>) => {
    const entries = Object.entries(patch) as [keyof NewAgentChoice, string | null][];
    setChoice((current) =>
      entries.every(([key, value]) => current[key] === value) ? current : { ...current, ...patch },
    );
  }, []);
  return useMemo(() => ({ open, setOpen, choice, change }), [open, choice, change]);
}

interface ColumnContentInput {
  live: boolean;
  /** Why the office is not live, while it is in error or closed. */
  problem: string | null;
  model: OfficeModel;
  cards: readonly StripCard[];
  chat: OfficeState["chat"];
  onSelect(agentId: string): void;
  /** Called first when the Attention tab opens a card of the office: the phone's sheet leaves. */
  onLeave(): void;
  styles: OfficeStyles;
}

/** What the column shows of the strip: the tabs' counts, and the Attention tab's content. */
function useColumnContent({
  live,
  problem,
  model,
  cards,
  chat,
  onSelect,
  onLeave,
  styles,
}: ColumnContentInput) {
  const unread = useUnread(chat);
  const waiting = model.attention.length;
  const badges = useMemo(
    (): ColumnBadges => ({
      // Only what needs a look is counted: a card that says all is well is no notification.
      attention: live ? countLabel(waiting + cards.filter(needsLook).length) : null,
      chat: unread,
    }),
    [live, waiting, cards, unread],
  );
  const select = useCallback(
    (agentId: string) => {
      onLeave();
      onSelect(agentId);
    },
    [onLeave, onSelect],
  );
  const leaving = useMemo(
    () =>
      cards.map((card) => ({
        ...card,
        onOpen: () => {
          onLeave();
          card.onOpen();
        },
      })),
    [cards, onLeave],
  );
  const attention = useMemo(() => {
    // Frozen data waits for nothing: say why, as the other tabs do.
    if (problem !== null) return <ProblemBanner text={problem} styles={styles} />;
    return live && (waiting > 0 || cards.length > 0) ? (
      <AttentionStrip
        entries={model.attention}
        cards={leaving}
        styles={styles}
        wrap
        onSelect={select}
      />
    ) : (
      <Text style={styles.sceneStatus}>{NOTHING_WAITS}</Text>
    );
  }, [problem, live, waiting, cards.length, model.attention, leaving, styles, select]);
  return { badges, attention };
}

/**
 * The phone's sheet. Whether it is open is its own: the column's view says what it shows, so
 * dismissing the sheet leaves an open session open. A row press must not leave the agent's card
 * under the sheet, so the sheet closes first; a session opens in the sheet.
 */
function useOfficeColumn(compact: boolean, integrated: boolean, openChat: () => void): ColumnState {
  const column = useColumn(compact);
  const { show, view } = column;
  return useMemo(
    () => ({
      ...column,
      view:
        integrated && view.kind === "tab" && view.tab === "chat"
          ? { kind: "tab", tab: "activity" }
          : view,
      show(tab) {
        if (integrated && tab === "chat") openChat();
        else show(tab);
      },
    }),
    [column, view, show, integrated, openChat],
  );
}

function useColumnSheet(
  column: ColumnState,
  compact: boolean,
  floatingChat: boolean,
  select: (agentId: string) => void,
) {
  const [open, setOpen] = useState(false);
  const closeSheet = useCallback(() => setOpen(false), []);
  const { show, openSession: openInColumn } = column;
  const openTab = useCallback(
    (tab: ColumnTab) => {
      show(tab);
      setOpen(!(floatingChat && tab === "chat"));
    },
    [show, floatingChat],
  );
  const openSession = useCallback(
    (agentId: string) => {
      openInColumn(agentId);
      if (compact) setOpen(true);
    },
    [openInColumn, compact],
  );
  const link = useMemo((): OfficeLink => ({ select, openSession }), [select, openSession]);
  const sheetLink = useMemo(
    (): OfficeLink => ({
      select: (agentId) => {
        setOpen(false);
        select(agentId);
      },
      openSession,
    }),
    [select, openSession],
  );
  const sheetView = open ? column.view : null;
  return { sheetView, openTab, closeSheet, openSession, link, sheetLink };
}

function sceneSelection(
  compact: boolean,
  platform: Platform,
  view: ColumnView | null,
  card: string | null,
) {
  if (compact && platform !== "web" && view?.kind === "session") return view.agentId;
  return card;
}

function usesOfficeKeyboard(
  platform: Platform,
  floating: boolean,
  compact: boolean,
  sheet: ColumnView | null,
  column: ColumnView,
) {
  if (compact && platform !== "web") return false; // The native conversation dialog owns its keyboard.
  const visible = compact ? sheet : column;
  return floating || (visible?.kind === "tab" && visible.tab === "chat");
}

type ColumnSheetState = ReturnType<typeof useColumnSheet>;

interface PhoneSheetProps extends Omit<ColumnPanelProps, "link"> {
  compact: boolean;
  draft: ChatDraft;
  sheet: ColumnSheetState;
  column: ColumnState;
  sessions: readonly ColumnSession[];
  session: SessionContext;
  color: string;
  attention: ReactNode;
}

/** On a compact surface, the open view's sheet over the floor; nothing on a wide one. */
function PhoneSheet({
  compact,
  sheet,
  column,
  sessions,
  session,
  color,
  attention,
  ...panel
}: PhoneSheetProps) {
  const view = sheet.sheetView;
  const { show, closeSession } = column;
  const shown = view?.kind === "session" ? view.agentId : null;
  const back = useCallback(() => show("sessions"), [show]);
  const closeShown = useCallback(() => {
    if (shown !== null) closeSession(shown);
  }, [shown, closeSession]);
  if (!compact || !view) return null;
  const title = sessions.find((each) => each.agentId === shown)?.title ?? null;
  const identity = shown ? sessionOf(session.model, shown) : null;
  const nativeDialog = panel.layout.platform !== "web";
  const content = (
    <ColumnViewPanel
      view={view}
      onCloseChat={nativeDialog ? undefined : sheet.closeSheet}
      session={session}
      attention={attention}
      {...panel}
      link={sheet.sheetLink}
    />
  );
  if (nativeDialog) {
    return (
      <ColumnDialog
        view={view}
        sessionTitle={title}
        identity={identity}
        color={color}
        styles={panel.styles}
        onBack={back}
        onDismiss={sheet.closeSheet}
      >
        <OfficeBrandContext.Provider value={panel.office.state.brand}>
          {content}
        </OfficeBrandContext.Provider>
      </ColumnDialog>
    );
  }
  return (
    <ColumnSheet
      open={view}
      sessionTitle={title}
      sessionAgent={identity?.agent}
      sessionRoom={identity?.room}
      color={color}
      iconSize={20}
      platform={panel.layout.platform}
      onClose={sheet.closeSheet}
      onBack={back}
      onCloseSession={closeShown}
      styles={panel.styles}
    >
      {content}
    </ColumnSheet>
  );
}

interface PhoneBarProps {
  keyboardVisible: boolean;
  compact: boolean;
  sheet: ColumnSheetState;
  sessions: readonly ColumnSession[];
  badges: ColumnBadges;
  color: string;
  styles: OfficeStyles;
}

/** On a compact surface, the column's tabs as a bar under the floor; nothing on a wide one. */
function PhoneBar({
  keyboardVisible,
  compact,
  sheet,
  sessions,
  badges,
  color,
  styles,
}: PhoneBarProps) {
  if (!compact || keyboardVisible) return null;
  return (
    <ColumnBar
      open={sheet.sheetView}
      sessions={sessions}
      badges={badges}
      color={color}
      iconSize={20}
      onOpen={sheet.openTab}
      onClose={sheet.closeSheet}
      styles={styles}
    />
  );
}

interface WideColumnProps extends ColumnPanelProps {
  hideSessions: boolean;
  sessions: readonly ColumnSession[];
  session: SessionContext;
  compact: boolean;
  draft: ChatDraft;
  onDragging(dragging: boolean): void;
  column: ColumnState;
  surfaceWidth: number;
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  touch: boolean;
  attention: ReactNode;
}

/** On a wide surface, the column beside the floor; nothing on a compact one. */
function WideColumn({
  hideSessions,
  sessions,
  session,
  compact,
  column,
  surfaceWidth,
  badges,
  color,
  iconSize,
  touch,
  onDragging,
  attention,
  ...panel
}: WideColumnProps) {
  if (compact || (hideSessions && column.collapsed)) return null;
  return (
    <OfficeColumn
      hideSessions={hideSessions}
      column={column}
      sessions={sessions}
      touch={touch}
      surfaceWidth={surfaceWidth}
      badges={badges}
      color={color}
      iconSize={iconSize}
      onDragging={onDragging}
      styles={panel.styles}
    >
      <ColumnViewPanel view={column.view} session={session} attention={attention} {...panel} />
    </OfficeColumn>
  );
}

/** The strip's Settings card, while a schedule could not follow the settings and there is a way in. */
function useSettingsEntry(state: OfficeState["state"], onOpenSettings: (() => void) | undefined) {
  const notesError = state.notes?.scheduleError ?? null;
  const incidentsError = state.incidents?.scheduleError ?? null;
  return useMemo(
    () =>
      onOpenSettings
        ? settingsEntry(settingsProblems(notesError, incidentsError), onOpenSettings)
        : null,
    [notesError, incidentsError, onOpenSettings],
  );
}

/**
 * The surface's width and the layout it gets. A surface too narrow for the column and the floor
 * is compact on any device: a desktop's split pane gets the bar and the sheet. Until it is
 * measured the device decides.
 */
function useSurfaceLayout(deviceCompact: boolean, styles: OfficeStyles, fullscreen: boolean) {
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setSurfaceWidth(event.nativeEvent.layout.width),
    [],
  );
  const minimum = COLUMN_MIN + FLOOR_MIN + (fullscreen ? SESSION_RAIL_MIN : 0);
  const compact = (deviceCompact && !fullscreen) || (surfaceWidth > 0 && surfaceWidth < minimum);
  // While the column's handle is dragged over it, the floor takes no pointer: the web's 3D floor
  // is a frame, which would keep the moves and the release from the handle. A compact surface
  // has no handle, so a drag cut short by a flip to compact does not leave the floor dead.
  const [dragging, setDragging] = useState(false);
  const floorStyle = dragging && !compact ? styles.floorDragging : styles.floor;
  return { surfaceWidth, measure, compact, floorStyle, setDragging };
}

/**
 * The surface as the app mounts it, with its way to the office's settings screen. Call it once,
 * at `contribute`: each call returns a new component type, so calling it while rendering would
 * remount the office.
 */
export function createOfficeSurface(openSettings: () => void, launcher: SidebarLauncher) {
  return function Surface(props: OfficeSurfaceProps) {
    return (
      <UiLanguage>
        <OfficeSurface {...props} onOpenSettings={openSettings} launcher={launcher} />
      </UiLanguage>
    );
  };
}

function useFullscreen(props: OfficeSurfaceProps, launcher: SidebarLauncher | undefined) {
  const { platform } = props.layout;
  const startExpanded =
    platform === "web" && !("workspaceId" in props) && props.params?.layout === "fullscreen";
  const root = useRef<View>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedInPage, setExpandedInPage] = useState(startExpanded);
  const [fullscreenError, setFullscreenError] = useState(false);
  const canFullscreen =
    platform === "web" && typeof document !== "undefined" && document.fullscreenEnabled;
  useEffect(() => {
    if (!canFullscreen) return;
    const changed = () => {
      const active = Object.is(document.fullscreenElement, root.current);
      if (active) setExpandedInPage(false);
      setFullscreen(active);
      // The scene's Escape (getting up from an activity, leaving walk-in) is the browser's own
      // while fullscreen: hold it for the page, and give it back with fullscreen.
      if (active) lockEscape(navigator);
      else unlockEscape(navigator);
    };
    // With Escape held, a press nothing used leaves fullscreen as it did before.
    const pressed = (event: KeyboardEvent) => {
      if (!Object.is(document.fullscreenElement, root.current)) return;
      leaveFullscreenAfter(event, pageUsesEscape(document), document);
    };
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("keydown", pressed, true);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("keydown", pressed, true);
      unlockEscape(navigator);
    };
  }, [canFullscreen]);
  // A sidebar press on a retained screen must not activate a hidden floor.
  const launch = useCallback(() => {
    const element = root.current as unknown as HTMLElement | null;
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth ||
      rect.top >= window.innerHeight ||
      element.checkVisibility?.({ visibilityProperty: true }) === false
    )
      return false;
    setFullscreenError(false);
    if (document.fullscreenElement !== element) {
      if (
        canFullscreen &&
        typeof element.requestFullscreen === "function" &&
        navigator.userActivation?.isActive !== false
      ) {
        void element.requestFullscreen().catch(() => setExpandedInPage(true));
      } else {
        setExpandedInPage(true);
      }
    }
    return true;
  }, [canFullscreen]);
  useEffect(() => {
    if (platform === "web") return launcher?.register(launch);
  }, [platform, launcher, launch]);
  // The cold launch can mount after browser user activation has expired. Its
  // one-page layout still opens, with the toolbar available to enter fullscreen.
  useEffect(() => {
    if (startExpanded && launcher?.takeScreenLaunch()) launch();
  }, [startExpanded, launcher, launch]);
  const toggleFullscreen = useCallback(async () => {
    const element = root.current as unknown as HTMLElement | null;
    if (!element) return;
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }, []);
  return {
    root,
    active: fullscreen,
    integrated: fullscreen || expandedInPage,
    error: fullscreenError,
    available: canFullscreen,
    toggle: toggleFullscreen,
  };
}

function useFullscreenPanels(
  active: boolean,
  fullscreen: boolean,
  platform: Platform,
  compact: boolean,
  surfaceWidth: number,
  column: ColumnState,
  sheet: ColumnSheetState,
  select: (id: string | null) => void,
  selectFromStrip: (id: string) => void,
  openWorkspace: (agentId: string) => void,
) {
  const directSessions = active || (compact && platform !== "web");
  const docked = active && !compact && surfaceWidth > 0;
  const sessionsAvailable = docked && fullscreen;
  const { on: sessionsHidden, set: hideSessions } = useDeviceSwitch("sessionsHidden", false);
  const sessionsOpen = sessionsHidden !== true;
  const sidebarWidth = Math.max(SESSION_RAIL_MIN, Math.min(312, Math.round(surfaceWidth * 0.24)));
  const railSize = useMemo(() => ({ width: sidebarWidth }), [sidebarWidth]);
  // Docked, Sessions has its own rail: the column's Sessions tab shows as Activity, in the header too.
  const shownColumn = useMemo(
    () =>
      docked && column.view.kind === "tab" && column.view.tab === "sessions"
        ? { ...column, view: { kind: "tab", tab: "activity" } as const }
        : column,
    [column, docked],
  );
  const sidebars: SidebarControls | undefined = docked
    ? {
        sessionsOpen,
        sessionsAvailable,
        column: shownColumn,
        hideSessions,
      }
    : undefined;
  const { openSession } = sheet;
  // A Sessions row's own button goes straight to the agent's workspace, past its details.
  const link = useMemo(
    (): OfficeLink => ({
      ...(directSessions ? { select: openSession, openSession } : sheet.link),
      openWorkspace,
    }),
    [directSessions, openSession, sheet.link, openWorkspace],
  );
  const selectAgent = useCallback(
    (id: string | null) => {
      if (directSessions && id !== null) openSession(id);
      else select(id);
    },
    [directSessions, openSession, select],
  );
  return {
    docked,
    controlsAboveFloor: docked || compact,
    sessionsAvailable,
    sidebars,
    sessionsOpen,
    railSize,
    link,
    selectAgent,
    selectFromStrip: directSessions ? openSession : selectFromStrip,
    width: sessionsAvailable && sessionsOpen ? surfaceWidth - sidebarWidth : surfaceWidth,
    column: shownColumn,
    sheet: useMemo(
      () => (directSessions ? { ...sheet, sheetLink: link } : sheet),
      [sheet, link, directSessions],
    ),
  };
}

function selectAgentDetail(
  id: string | null,
  model: OfficeModel,
  activities: OfficeState["state"]["activity"],
) {
  if (!id) return { agent: null, activity: null };
  return { agent: model.agents.get(id) ?? null, activity: activities[id] ?? null };
}

function OfficeMessenger({
  open,
  link,
  onOpen,
  onClose,
  ...panel
}: Omit<Parameters<typeof FloatingTeamChat>[0], "onClose"> & {
  open: boolean;
  onOpen(): void;
  onClose(): void;
}) {
  const sessionLink = useMemo(
    (): OfficeLink => ({
      select(id) {
        onClose();
        link.select(id);
      },
      openSession(id) {
        onClose();
        link.openSession(id);
      },
    }),
    [link, onClose],
  );
  const { messenger } = panel.styles;
  return (
    <View
      pointerEvents="box-none"
      style={panel.layout.compact ? messenger.compactAnchor : messenger.floorAnchor}
    >
      {open ? (
        <FloatingTeamChat {...panel} link={sessionLink} onClose={onClose} />
      ) : (
        <TeamChatPreview chat={panel.office.chat} onOpen={onOpen} compact={panel.layout.compact} />
      )}
    </View>
  );
}

function useMessengerTasks(
  board: BoardSheetState,
  sidebars: SidebarControls | undefined,
  sheet: ColumnSheetState,
  column: ColumnState,
  compact: boolean,
  newAgent: NewAgentDraft,
  closeChat: () => void,
) {
  const { open } = board;
  const onBoard = useCallback(() => open(LOBBY), [open]);
  const { openTab } = sheet;
  const { show } = column;
  const { setOpen } = newAgent;
  const onNewAgent = useCallback(() => {
    closeChat();
    if (sidebars) sidebars.hideSessions(false);
    else if (compact) openTab("sessions");
    else show("sessions");
    setOpen(true);
  }, [sidebars, compact, openTab, show, setOpen, closeChat]);
  return { onBoard, onNewAgent };
}
function workspaceNavigation({ layout, navigation }: OfficeSurfaceProps) {
  return layout.compact || layout.platform !== "web" ? navigation : undefined;
}

function useWorkspaceOverlay(
  model: OfficeModel,
  openBoard: (id: string) => void,
  mobileNavigation: PluginScreenProps["navigation"],
) {
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null);
  const closeWorkspace = useCallback(() => setWorkspace(null), []);
  const showWorkspace = useCallback(
    (workspaceId: string) => {
      if (mobileNavigation) mobileNavigation.openWorkspace({ workspaceId });
      else setWorkspace({ workspaceId, agentId: null });
    },
    [mobileNavigation],
  );
  const showAgentWorkspace = useCallback(
    (agentId: string) => {
      if (mobileNavigation) mobileNavigation.openAgent({ agentId });
      else setWorkspace({ workspaceId: model.agents.get(agentId)?.workspaceId ?? null, agentId });
    },
    [model.agents, mobileNavigation],
  );
  const openWorkspaceBoard = useCallback(
    (id: string) => {
      closeWorkspace();
      openBoard(id);
    },
    [closeWorkspace, openBoard],
  );
  return { workspace, closeWorkspace, showWorkspace, showAgentWorkspace, openWorkspaceBoard };
}

/** What the surface's parts read without it being handed down: the brand, the plans' limits, the timeline's opener. */
function OfficeContexts({
  brand,
  planUsage,
  onTimeline,
  onHistory,
  children,
}: {
  brand: OfficeState["state"]["brand"];
  planUsage: PlanState;
  onTimeline: (() => void) | undefined;
  onHistory: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <OfficeBrandContext.Provider value={brand}>
      <PlanUsageContext.Provider value={planUsage.counted}>
        <PlanPickerContext.Provider value={planUsage.picker}>
          <OpenTimelineContext.Provider value={onTimeline}>
            <OpenHistoryContext.Provider value={onHistory}>{children}</OpenHistoryContext.Provider>
          </OpenTimelineContext.Provider>
        </PlanPickerContext.Provider>
      </PlanUsageContext.Provider>
    </OfficeBrandContext.Provider>
  );
}

/** A card of the toolbar's, the timeline's or the history's: offered and shown only while the office's data is live. */
function useTimelineCard(live: boolean) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return { open: open && live, onOpen: live ? show : undefined, close };
}

function useHostResources(machine: Machine | null, live: boolean) {
  const [machineOpen, setMachineOpen] = useState(false);
  const openMachine = useCallback(() => setMachineOpen(true), []);
  const closeMachine = useCallback(() => setMachineOpen(false), []);
  const ssh = useSshServers(live && (machineOpen || machine === null));
  const hasSsh = ssh.servers.length > 0;
  const hostEntry = useMemo((): StripCard | null => {
    if (machine) return { title: "Host", note: hostNote(machine), onOpen: openMachine };
    if (hasSsh)
      return { title: "Host", note: { text: "SSH hosts", tone: "muted" }, onOpen: openMachine };
    return null;
  }, [machine, hasSsh, openMachine]);
  return { machineOpen: machineOpen && live, openMachine, closeMachine, hostEntry, ssh };
}

/** One surface for both places: the sidebar screen and a workspace tab. */
export function OfficeSurface(
  props: OfficeSurfaceProps & {
    /** Absent only in tests and on a host that gives no way to its settings. */
    onOpenSettings?: () => void;
    launcher?: SidebarLauncher;
  },
) {
  const { layout, navigation, onOpenSettings } = props;
  const focusRoomId = "workspaceId" in props ? props.workspaceId : null;
  // Asked once for the surface's life, like the app: a mouse plugged into a tablet does not
  // shrink its controls.
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const full = useFullscreen(props, props.launcher);
  const theme = fullscreenTheme(props.theme, full.integrated);
  const styles = useOfficeStyles(theme, layout.compact, touchScreen);

  const office = useOffice();
  const actions = useAgentActions();
  const boardActions = useBoardActions();
  const { machine: reading, cleanUp } = useMachine();
  const tidy = useJanitor();
  const dismissIncidents = useIncidents();
  const [janitorOpen, setJanitorOpen] = useState(false);
  const openJanitor = useCallback(() => setJanitorOpen(true), []);
  const closeJanitor = useCallback(() => setJanitorOpen(false), []);
  const readNotes = useRpc(notesReadRpc);
  const notesTimeZone = useNotesTimeZone();
  const viewChoice = useViewChoice(layout.platform);
  const settings = useOfficeSettingsDialog(
    full.integrated || viewChoice.choice === "3d",
    onOpenSettings,
  );
  const [teamOpen, setTeamOpen] = useState(false);
  const openTeam = useCallback(() => setTeamOpen((value) => !value), []);
  const closeTeam = useCallback(() => setTeamOpen(false), []);
  // One Sound switch for the floor: the 3D office follows it, and the corner shows a refused save.
  const street = useOfficeScene(layout);
  const sound = useSoundSwitch();
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const { surfaceWidth, measure, compact, floorStyle, setDragging } = useSurfaceLayout(
    layout.compact,
    styles,
    full.active,
  );
  const column = useOfficeColumn(compact, full.integrated, openTeam);
  const machine = useMemo(() => namedMachine(reading, model.agents), [reading, model.agents]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  const name = useCallback((author: string) => authorName(author, model.agents), [model.agents]);
  // In error or closed the data is frozen: no strip, no card and no board sheet to act on it.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  const { machineOpen, openMachine, closeMachine, hostEntry, ssh } = useHostResources(
    machine,
    live,
  );
  const planUsage = usePlanUsage(live);
  const timeline = useTimelineCard(live);

  const history = useTimelineCard(live);
  const alerts = useAlerts(live);
  const board = useBoardSheet(model, live);
  const dutyCard = useCardOpening(live);
  // Until the host sends its duty list (an older host has none) nothing offers the duty board.
  const openDuties = model.dutyList === null ? undefined : dutyCard.show;
  const dutyActions = useDutyActions();
  const { acted } = dutyActions;
  // A report the host refuses changes nothing: its duty board is what the scene is told next.
  const dutyActed = useCallback(
    (id: string, agentId: string) => void acted(id, agentId).catch(() => undefined),
    [acted],
  );
  const notesCard = useCardOpening(live);
  const { show: openNotes, close: closeNotes } = notesCard;
  const incidentsCard = useCardOpening(live);
  const { show: openIncidents } = incidentsCard;
  const standup = useStandup(model, boardActions.post, live);
  const { close: closeStandup } = standup;
  // One card at a time: the Stand-up card leaves for the notes, and either leaves for the writer.
  const notesFromStandup = useCallback(() => {
    closeStandup();
    openNotes();
  }, [closeStandup, openNotes]);
  const { workspace, closeWorkspace, showWorkspace, showAgentWorkspace, openWorkspaceBoard } =
    useWorkspaceOverlay(model, board.open, workspaceNavigation(props));
  const qa = useQa(model, live);
  const readLog = useScriptLog();
  const reviews = useReviews({
    model,
    post: boardActions.post,
    live,
    showWorkspace,
    showBoard: board.open,
  });
  const library = useLibrary({ model, post: boardActions.post, live, showBoard: board.open });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sceneProblem, setSceneProblem] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
  // The strip is the phone's fast path: it opens the card and brings the agent's desk into view.
  const selectFromStrip = useCallback((agentId: string) => {
    setSelectedId(agentId);
    setFocusRequest((previous) => nextFocusRequest(previous, agentId));
  }, []);
  // Every way in to a session ends in the column: its tab, or the phone's sheet.
  const sheet = useColumnSheet(column, compact, full.integrated, setSelectedId);
  const {
    spaceStyle,
    measureKeyboard,
    visible: chatKeyboardVisible,
  } = useChatKeyboard(
    full.root,
    layout.platform,
    usesOfficeKeyboard(layout.platform, teamOpen, compact, sheet.sheetView, column.view),
  );
  const onSurfaceLayout = useCallback(
    (event: LayoutChangeEvent) => {
      measure(event);
      measureKeyboard();
    },
    [measure, measureKeyboard],
  );
  const { openSession } = sheet;
  const panels = useFullscreenPanels(
    full.integrated,
    full.active,
    layout.platform,
    compact,
    surfaceWidth,
    column,
    sheet,
    setSelectedId,
    selectFromStrip,
    showAgentWorkspace,
  );
  const selectFromBoard = useBoardSelect(board.close, panels.selectAgent);
  // The writer opens in the column like any session; the office is left only by "Open in workspace".
  const openWriter = useCallback(
    (agentId: string) => {
      closeStandup();
      closeNotes();
      openSession(agentId);
    },
    [closeStandup, closeNotes, openSession],
  );
  const openResources = useMemo(
    () => (full.integrated ? openMachine : resourcesOpener(navigation, openMachine)),
    [full.integrated, navigation, openMachine],
  );
  // The panels of the column reach this surface through the link: a row press opens the card, as
  // a List row does, and "Open session" shows the session.
  const retryScene = useCallback(() => setSceneProblem(null), []);
  // Choosing a view asks for 3D anew, so an old failure does not stand in its way.
  const { choose } = viewChoice;
  const changeView = useCallback(
    (next: OfficeViewChoice) => {
      setSceneProblem(null);
      choose(next);
    },
    [choose],
  );
  const view = officeView({ choice: viewChoice.choice, problem: sceneProblem });
  const floorDrawn = office.loaded && live && (view === "3d" || view === "2d");
  // The 3D floor alone shows a replay: the lists, the boards and the cards stay today's.
  const floorReplay = useFloorReplay(office.state, live, view === "3d");
  const kept = keptSelection(selectedId, model.agents, live);
  // A selection whose agent left is dropped, so the card does not reopen if that agent returns.
  useEffect(() => {
    if (kept !== selectedId) setSelectedId(kept);
  }, [kept, selectedId]);
  const contexts = useMemo(
    () => janitorRows(model.agents.values(), model.waitingOn),
    [model.agents, model.waitingOn],
  );
  const janitorEntry = useMemo((): StripCard | null => {
    const note = janitorNote(contexts);
    return note === null ? null : { title: "Janitor", note, onOpen: openJanitor };
  }, [contexts, openJanitor]);
  const incidents = office.state.incidents;
  const incidentsStripEntry = useMemo(
    () => incidentsEntry(incidents, openIncidents),
    [incidents, openIncidents],
  );
  const settingsStripEntry = useSettingsEntry(office.state, settings.show);
  const weatherStripEntry = useMemo(
    () => weatherEntry(office.state.weather, settings.show),
    [office.state.weather, settings.show],
  );
  // The strip's cards, each only while it has something to say. An incident comes first. The
  // office's own cards with nothing to report (the janitor, the stand-up, QA, the library) are
  // icons in the toolbar of a docked office, so the strip there holds only what needs a look.
  const shortcuts = useMemo(
    () =>
      shortcutsOf([
        [janitorEntry, "Brush"],
        [standup.entry, "NotebookPen"],
        [reviews.entry, "GitPullRequest"],
        [qa.entry, "FlaskConical"],
        [library.entry, "BookOpen"],
      ]),
    [janitorEntry, standup.entry, reviews.entry, qa.entry, library.entry],
  );
  const cards = useMemo(
    () =>
      stripCards(
        [incidentsStripEntry, ...alerts.cards, settingsStripEntry, weatherStripEntry, hostEntry],
        shortcuts,
        panels.docked,
      ),
    [
      incidentsStripEntry,
      alerts.cards,
      settingsStripEntry,
      weatherStripEntry,
      hostEntry,
      shortcuts,
      panels.docked,
    ],
  );
  const draft = useChatDraft();
  const newAgent = useNewAgentDraft();
  const { badges, attention } = useColumnContent({
    live,
    problem: loadProblem(office.subscription),
    model,
    cards,
    chat: office.chat,
    onSelect: panels.selectFromStrip,
    onLeave: sheet.closeSheet,
    styles,
  });
  const selected = selectAgentDetail(kept, model, office.state.activity);
  // The panels size their controls for the surface they are in, not only for the device.
  const panelLayout = useMemo(() => ({ ...layout, compact }), [layout, compact]);
  const { onPhotoReady, onGroupPhoto } = useGroupPhoto();
  const chatTasks = useMessengerTasks(
    board,
    panels.sidebars,
    sheet,
    column,
    compact,
    newAgent,
    closeTeam,
  );
  const incidentToLobby = useCallback(
    (text: string) => boardActions.post({ board: LOBBY, kind: "task", text }),
    [boardActions],
  );
  const { change: changeNewAgent } = newAgent;
  const { onNewAgent } = chatTasks;
  const { close: closeIncidents } = incidentsCard;
  const analyzeIncident = useCallback(
    (prompt: string) => {
      changeNewAgent({ prompt });
      closeIncidents();
      onNewAgent();
    },
    [changeNewAgent, closeIncidents, onNewAgent],
  );
  const panel = {
    office,
    styles,
    theme,
    layout: panelLayout,
    attention,
    draft,
    newAgent,
    ...chatTasks,
    onDuties: openDuties,
    onGroupPhoto,
  };
  const sessions = useMemo(
    () => sessionTabsOf(column.sessions, model.agents),
    [column.sessions, model.agents],
  );
  const { closeSession } = column;
  const replies = useReplyDrafts(column.sessions);
  const session = useMemo(
    (): SessionContext => ({
      model,
      replies,
      actions,
      showWorkspace: showAgentWorkspace,
      closeSession,
    }),
    [model, replies, actions, showAgentWorkspace, closeSession],
  );
  const color = theme.colors.foreground;
  const controls = (
    <ViewControls
      keyboardVisible={chatKeyboardVisible}
      badges={badges}
      full={full}
      sidebars={panels.sidebars}
      floorDrawn={floorDrawn}
      viewChoice={viewChoice}
      soundUnsaved={sound.unsaved}
      toolbarLabels={surfaceWidth >= 1100}
      onTeam={openTeam}
      machine={machine}
      onMachine={hostEntry?.onOpen}
      shortcuts={shortcuts}
      onChange={changeView}
      compact={compact}
      touchScreen={touchScreen}
      color={color}
      onOpenSettings={settings.show}
      styles={styles}
    />
  );
  // One tree in both layouts, so a flip between them does not draw the floor again: compact adds
  // the sheet in the floor's box and the bar under the row, wide adds the column beside the floor.
  const surface = (
    <View ref={full.root} style={styles.screen} onLayout={onSurfaceLayout}>
      <SurfaceNotices
        fullscreenError={full.error}
        choice={viewChoice.choice}
        sceneProblem={sceneProblem}
        retryScene={retryScene}
        styles={styles}
      />
      {panels.controlsAboveFloor && controls}
      <View style={styles.officeRow}>
        {panels.sessionsAvailable ? (
          <SessionsSidebar
            {...panel}
            link={panels.link}
            open={panels.sessionsOpen}
            size={panels.railSize}
          />
        ) : null}
        <View testID="office-floor-pane" style={floorStyle}>
          {!panels.controlsAboveFloor && controls}
          <FloorReplayBar replay={floorReplay} styles={styles} />
          <SurfaceBody
            onPhotoReady={onPhotoReady}
            fullscreen={full.available ? full : undefined}
            office={office}
            model={floorReplay.shown(model)}
            rooms={rooms}
            view={view}
            theme={theme}
            focusRoomId={focusRoomId}
            focusRequest={focusRequest}
            selectedAgentId={sceneSelection(compact, layout.platform, sheet.sheetView, kept)}
            styles={styles}
            compact={layout.compact}
            actions={actions}
            name={name}
            onSelectAgent={panels.selectAgent}
            onOpenSession={openSession}
            onOpenAgentWorkspace={showAgentWorkspace}
            onOpenBoard={board.open}
            onOpenDuties={openDuties}
            onDutyActed={dutyActed}
            machine={machine}
            onOpenMachine={openMachine}
            onOpenResources={openResources}
            onOpenLibrary={library.show}
            onOpenNotes={openNotes}
            janitor={janitorEntry?.note ?? null}
            onOpenJanitor={openJanitor}
            meeting={standup.open}
            weather={office.state.weather?.scene}
            incidents={incidents}
            onOpenIncidents={openIncidents}
            onSceneProblem={setSceneProblem}
            platform={layout.platform}
            sound={sound}
            street={street}
          />
          <PhoneSheet
            compact={compact}
            sheet={panels.sheet}
            column={column}
            sessions={sessions}
            session={session}
            color={color}
            {...panel}
          />
          {full.integrated && (
            <OfficeMessenger
              open={teamOpen}
              {...panel}
              link={panels.link}
              onOpen={openTeam}
              onClose={closeTeam}
            />
          )}
        </View>
        <WideColumn
          sessions={sessions}
          session={session}
          compact={compact}
          column={panels.column}
          hideSessions={panels.docked}
          surfaceWidth={panels.width}
          badges={badges}
          color={color}
          iconSize={touchScreen ? 20 : 16}
          touch={touchScreen}
          onDragging={setDragging}
          link={panels.link}
          {...panel}
        />
      </View>
      <PhoneBar
        compact={compact}
        keyboardVisible={chatKeyboardVisible}
        sheet={sheet}
        sessions={sessions}
        badges={badges}
        color={color}
        styles={styles}
      />
      <View aria-hidden testID="office-keyboard-space" style={spaceStyle} />
      <AgentCard
        agent={selected.agent}
        activity={selected.activity}
        actions={actions}
        onOpenSession={openSession}
        styles={styles}
        onClose={closeCard}
      />
      <MachineCard
        workspaces={office.state.workspaces}
        agents={office.state.agents}
        ssh={ssh}
        machine={machine}
        open={machineOpen}
        cleanUp={cleanUp}
        styles={styles}
        onClose={closeMachine}
      />
      <TimelineCard
        open={timeline.open}
        styles={styles}
        onFloorReplay={floorReplay.start}
        onClose={timeline.close}
      />
      <VaultCard open={history.open} styles={styles} onClose={history.close} />
      <AlertCard
        alert={alerts.open}
        nameOf={name}
        machine={machine}
        actions={actions}
        styles={styles}
        onClose={alerts.close}
        onDismiss={alerts.dismiss}
      />
      <JanitorCard
        rows={contexts}
        open={janitorOpen && live}
        tidy={tidy}
        styles={styles}
        onClose={closeJanitor}
      />
      <IncidentsCard
        state={incidents}
        open={incidentsCard.open}
        now={incidentsCard.openedAt}
        onDismiss={dismissIncidents}
        lobby={office.state.boards[LOBBY]}
        onLobby={incidentToLobby}
        onAnalyze={analyzeIncident}
        styles={styles}
        onClose={incidentsCard.close}
      />
      <StandupCard
        teams={standup.teams}
        open={standup.open}
        ask={standup.ask}
        wakesPaused={office.state.wake.paused}
        notes={office.state.notes}
        now={standup.at}
        timeZone={notesTimeZone}
        onOpenAgent={openWriter}
        onOpenNotes={notesFromStandup}
        styles={styles}
        onClose={standup.close}
      />
      <NotesCard
        open={notesCard.open}
        notes={office.state.notes}
        now={notesCard.openedAt}
        timeZone={notesTimeZone}
        read={readNotes}
        onOpenAgent={openWriter}
        styles={styles}
        onClose={closeNotes}
      />
      <ReviewCard
        rows={reviews.rows}
        open={reviews.open}
        ask={reviews.ask}
        wakesPaused={office.state.wake.paused}
        onOpenWorkspace={reviews.openWorkspace}
        onOpenBoard={reviews.openBoard}
        styles={styles}
        onClose={reviews.close}
      />
      <QaCard
        teams={qa.teams}
        open={qa.open}
        readLog={readLog}
        styles={styles}
        onClose={qa.close}
      />
      <LibraryCard
        teams={library.teams}
        skills={library.skills}
        readFailure={library.readFailure}
        open={library.open}
        read={library.read}
        teach={library.teach}
        wakesPaused={office.state.wake.paused}
        onOpenBoard={library.openBoard}
        styles={styles}
        onClose={library.close}
      />
      <BoardSheet
        room={board.room}
        rooms={model.rooms}
        agentTasks={model.agentTasks}
        name={name}
        actions={boardActions}
        wakesPaused={office.state.wake.paused}
        sheetLeavesFirst={sheetLeavesFirstOn(layout.compact, layout.platform)}
        styles={styles}
        onSelectAgent={selectFromBoard}
        onOpenBoard={board.openFromBoard}
        onBack={board.back}
        onClose={board.close}
      />
      <DutySheet
        open={dutyCard.open}
        list={model.dutyList}
        rows={model.duties}
        name={name}
        actions={dutyActions}
        styles={styles}
        onClose={dutyCard.close}
      />
      <OfficeWorkspace
        selection={workspace}
        hostId={props.host.id}
        session={session}
        styles={styles}
        layout={panelLayout}
        onSelect={showAgentWorkspace}
        onBoard={full.integrated ? board.open : openWorkspaceBoard}
        onClose={closeWorkspace}
      />
      <FullscreenSettings
        open={settings.open}
        onClose={settings.close}
        office={office}
        actions={boardActions}
        styles={styles}
        view={viewChoice}
        street={street}
        sound={sound}
      />
    </View>
  );
  return (
    <OfficeContexts
      brand={office.state.brand}
      planUsage={planUsage}
      onTimeline={timeline.onOpen}
      onHistory={history.onOpen}
    >
      <OfficeDialogs fullscreen={full.integrated} theme={theme} styles={styles}>
        {surface}
      </OfficeDialogs>
    </OfficeContexts>
  );
}
