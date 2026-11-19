import { useEffect, useId, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { WeatherScene, IncidentsState, Machine } from "../../shared/contracts.js";
import type { FocusRequest } from "../focus-request.js";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import type { SoundSwitch } from "../use-sound.js";
import { worldBrand, type WorldPlan } from "./adapter.js";
import { useStreetStart } from "./use-street-kit.js";
import { useSceneWords } from "./use-scene-words.js";
import { useWorldFeed } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";
import { readBrand } from "../web-env.web.js";
import { focusApp, openWorldFrame } from "./world-frame.web.js";
import { WorldLoading } from "./world-loading.js";
import { messageOf } from "./world-loader.js";
import {
  useStandupBell,
  useSceneLifeChat,
  useWorldScript,
  worldStartOptions,
  type WorldLatest,
} from "./world-view-shared.js";

export interface WorldViewProps {
  streetOn?: boolean | null;
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
  life?: import("../../shared/contracts.js").LifeEvent | null;
  onTenure?: WorldLatest["onTenure"];
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
  theme,
  styles,
  plan,
  street,
  focusRoomId,
  focusRequest,
  selectedAgentId,
  onSelectAgent,
  onSelectBoard,
  life,
  onTenure,
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
  onProblem,
  sound,
}: WorldSceneProps) {
  const containerId = useId();
  const onBell = useStandupBell();
  const onLife = useSceneLifeChat();
  const words = useSceneWords();
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
    onBell,
    onLife,
    onTenure,
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
      onBell,
      onLife,
      onTenure,
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
    onBell,
    onLife,
    onTenure,
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
    function start(scene: WorldApi): void {
      if (!live) return;
      try {
        scene.start(
          worldStartOptions(latest, {
            focus: focusApp,
            // Read when the office starts: a page's brand does not change while the page lives.
            brand: worldBrand(readBrand()),
            language: words.language,
            words: words.words,
            plan,
          }),
        );
      } catch (error) {
        latest.current.onProblem(messageOf(error));
        return;
      }
      setApi(scene);
    }
    frame.api.then(start, (error: unknown) => {
      if (live) latest.current.onProblem(messageOf(error));
    });
    return () => {
      live = false;
      setApi(null);
      frame.dispose();
    };
  }, [script, sized, containerId, plan, words.status, words.language, words.words]);

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
    sound: sound.on,
    plan,
  });
  const note = feedNote ?? words.note;
  return (
    <View id={containerId} style={styles.scene}>
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
export function WorldView({ plan, streetOn = false, ...rest }: WorldViewProps) {
  const { street, loading } = useStreetStart(streetOn);
  if (loading || plan === null) return <WorldLoading styles={rest.styles} />;
  return <WorldScene key={plan + String(street !== null)} street={street} plan={plan} {...rest} />;
}
