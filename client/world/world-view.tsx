import { useOfficeBrand } from "../office-brand-context.js";
import { RegisterWorkspaceDock } from "./workspace-dock.js";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { WeatherScene, IncidentsState, Machine } from "../../shared/contracts.js";
import type { FocusRequest } from "../focus-request.js";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import type { SoundSwitch } from "../use-sound.js";
import { worldBrand, type WorldPlan } from "./adapter.js";
import { StreetEvents } from "./street-events.js";
import { useLife } from "./use-life.js";
import { useStreetStart } from "./use-street-kit.js";
import { useSceneWords } from "./use-scene-words.js";
import { useWorldFeed } from "./use-world-feed.js";
import type { WorldApi, WorldStartOptions } from "./world-api.js";

import { focusApp, openWorldFrame } from "./world-frame.web.js";
import { WorldLoading } from "./world-loading.js";
import type { GroupPhotoCapture } from "../use-group-photo.js";
import { messageOf } from "./world-loader.js";
import {
  useStandupBell,
  useWorldScript,
  worldStartOptions,
  type WorldLatest,
} from "./world-view-shared.js";

export interface WorldViewProps {
  onPhotoReady?: ((capture: GroupPhotoCapture | null) => void) | undefined;
  scene?: WorldStartOptions["scene"];
  night?: boolean | undefined;
  streetOn?: boolean | null;
  fullscreen?: { active: boolean; toggle(): void };
  model: OfficeModel;
  theme: PluginTheme;
  styles: OfficeStyles;
  /**
   * The floor plan to draw; null until the host has said, and then nothing starts. A new plan is a
   * new scene.
   */
  plan: WorldPlan | null;
  /** The workspace tab's room; the view starts on its team's desks. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /** Whose card is open; the scene marks that person and looks at them. */
  selectedAgentId: string | null;
  /** A tap on a person, or null when the same person is tapped again. */
  onSelectAgent(agentId: string | null): void;
  /** A tap on a team's chip or on the whiteboard: opens that room's board. */
  onSelectBoard(roomId: string): void;
  /** The host's readings; null when the host has none, and then the server room is furniture. */
  machine: Machine | null;
  /**
   * A tap on the server room: its chip, the racks or a server box, and the wall screen while
   * `onOpenResources` is absent.
   */
  onOpenMachine(): void;
  /**
   * A tap on the server room's wall screen where Paseo can show Resources beside the floor;
   * absent where it cannot. Read when the office starts.
   */
  onOpenResources: (() => void) | undefined;
  /**
   * E by a person while walking in: the agent card's "Open session". The surface always supplies
   * it, and it opens the session in the office's column, as the card does. Read when the office
   * starts.
   */
  onOpenSession: ((agentId: string) => void) | undefined;
  /** A tap on the library: its chip or the bookshelf. */
  onOpenLibrary(): void;
  /** A tap on the label over the meeting room's screen. */
  onOpenNotes(): void;
  /** The stand-up is open: the bell on the meeting table rings once. */
  meeting: boolean;
  /** The host's incidents: the banner while any is open, and the alarm for one not rung for here. */
  weather?: WeatherScene | undefined;
  incidents: IncidentsState | undefined;
  /** A tap on the incidents' banner. */
  onOpenIncidents(): void;
  /** A tap on the pantry's duty board: the duty board's editor. */
  onOpenDuties?: () => void;
  /** A figure acted out a pretend duty: the host records it done by that agent. */
  onDutyActed?: (id: string, agentId: string) => void;
  /** The script could not load, the office could not start, or the WebGL context was lost. */
  onProblem(message: string): void;
  /**
   * The device's Sound switch, the surface's: the scene follows `on`, and a press on its button
   * calls `set`. The surface shows a save the device refused.
   */
  sound: SoundSwitch;
}

type WorldSceneProps = Omit<WorldViewProps, "plan"> & {
  plan: WorldPlan;
  street: { kit: string | null } | null;
};

/**
 * The office in 3D on one plan. Web only: office-surface.tsx renders it in a browser with WebGL2
 * where 3D is the chosen view. The plugin bundle is evaluated on every platform, so the container
 * and the frame are reached in effects and nothing here touches the DOM when the module loads.
 *
 * Reporting a problem makes the surface take this view away, and that removes the frame: on
 * unmount, on another view chosen, on another plan and after a lost context alike.
 */
function WorldScene({
  model,
  fullscreen,
  onPhotoReady,
  theme,
  styles,
  plan,
  scene,
  night,
  street,
  focusRoomId,
  focusRequest,
  selectedAgentId,
  onSelectAgent,
  onSelectBoard,
  machine,
  onOpenMachine,
  onOpenResources,
  onOpenSession,
  onOpenLibrary,
  onOpenNotes,
  meeting,
  weather,
  incidents,
  onOpenIncidents,
  onOpenDuties,
  onDutyActed,
  onProblem,
  sound,
}: WorldSceneProps) {
  const registerDock = useContext(RegisterWorkspaceDock);
  const containerId = useId();
  const onToggleFullscreen = fullscreen?.toggle;
  const onBell = useStandupBell();
  const { life, say: onLife, tell: onTenure } = useLife();
  const words = useSceneWords();
  const brand = useOfficeBrand();
  const [sized, setSized] = useState(false);
  const [api, setApi] = useState<WorldApi | null>(null);
  // What the frame's callbacks and its start read: always the last render's.
  const latest = useRef<WorldLatest>({
    model,
    theme,
    focusRoomId,
    selectedAgentId,
    onSelectAgent,
    onSelectBoard,
    onOpenMachine,
    onOpenResources,
    onOpenSession,
    onOpenLibrary,
    onOpenNotes,
    onOpenIncidents,
    onOpenDuties,
    onDutyActed,
    onBell,
    onLife,
    onTenure,
    scene,
    night,
    street,
    onSound: sound.set,
    onProblem,
  });
  useEffect(() => {
    latest.current = {
      model,
      theme,
      focusRoomId,
      selectedAgentId,
      onSelectAgent,
      onSelectBoard,
      onOpenMachine,
      onOpenResources,
      onOpenSession,
      onOpenLibrary,
      onOpenNotes,
      onOpenIncidents,
      onOpenDuties,
      onDutyActed,
      onBell,
      onLife,
      onTenure,
      scene,
      night,
      street,
      onSound: sound.set,
      onProblem,
    };
  }, [
    model,
    theme,
    focusRoomId,
    selectedAgentId,
    onSelectAgent,
    onSelectBoard,
    onOpenMachine,
    onOpenResources,
    onOpenSession,
    onOpenLibrary,
    onOpenNotes,
    onOpenIncidents,
    onOpenDuties,
    onDutyActed,
    onBell,
    onLife,
    onTenure,
    scene,
    night,
    street,
    sound.set,
    onProblem,
  ]);

  // A tab that was never shown has no size: it loads nothing and starts nothing.
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    const measure = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) setSized(true);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, [containerId]);

  const script = useWorldScript(sized, onProblem);
  useEffect(() => {
    if (words.status !== "ready" || script === null || !sized) return undefined;
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    let live = true;
    const frame = openWorldFrame({ container, script, title: "Office in 3D" });
    function start(world: WorldApi): void {
      if (!live) return;
      try {
        world.start(
          worldStartOptions(latest, {
            focus: focusApp,
            onToggleFullscreen,
            brand: worldBrand(brand),
            language: words.language,
            words: words.words,
            plan,
          }),
        );
      } catch (error) {
        latest.current.onProblem(messageOf(error));
        return;
      }
      registerDock?.(
        container
          ?.querySelector("iframe")
          ?.contentDocument?.querySelector<HTMLButtonElement>("#btn-workspace") ?? null,
      );
      setApi(world);
    }
    frame.api.then(start, (error: unknown) => {
      if (live) latest.current.onProblem(messageOf(error));
    });
    return () => {
      live = false;
      setApi(null);
      registerDock?.(null);
      frame.dispose();
    };
  }, [
    registerDock,
    script,
    sized,
    containerId,
    brand,
    plan,
    words.status,
    words.language,
    words.words,
    onToggleFullscreen,
  ]);

  useEffect(() => {
    if (!api?.captureGroupPhoto || !onPhotoReady) return undefined;
    onPhotoReady(() => api.captureGroupPhoto?.() ?? null);
    return () => onPhotoReady(null);
  }, [api, onPhotoReady]);

  const fullscreenActive = fullscreen?.active ?? false;
  useEffect(() => {
    api?.setFullscreen?.(fullscreenActive);
  }, [api, fullscreenActive]);

  const { note: feedNote } = useWorldFeed(api, {
    model,
    theme,
    focusRoomId,
    focusRequest,
    selectedAgentId,
    life,
    machine,
    meeting,
    weather,
    incidents,
    streetNote: street?.kit === null,
    night,
    sound: sound.on,
    plan,
  });
  const note = feedNote ?? words.note;
  return (
    <View id={containerId} style={styles.scene}>
      {api && street ? <StreetEvents api={api} /> : null}
      {api === null ? <Text style={styles.sceneStatus}>Loading the 3D view...</Text> : null}
      {api !== null && note !== null ? (
        <View style={styles.sceneNote}>
          <Text style={styles.sceneNoteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The office in 3D, on the host's plan. A scene page starts once, so each plan is a scene of its
 * own: a changed plan takes the frame out and opens a new one.
 */
export function WorldView({ plan, streetOn = false, scene, ...rest }: WorldViewProps) {
  const { street, loading } = useStreetStart(scene ? scene === "city" : streetOn);
  if (loading || plan === null) return <WorldLoading styles={rest.styles} />;
  return (
    <WorldScene
      key={plan + (scene ?? String(street !== null))}
      scene={scene}
      street={street}
      plan={plan}
      {...rest}
    />
  );
}
