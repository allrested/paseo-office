import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { worldBrand, type WorldPlan } from "./adapter.js";
import { kitScriptFrame, type ScriptFrameHandle } from "./script-frame-kit.js";
import { useWorldFeed } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";
import { createWorldBridge, type WorldBridge } from "./world-bridge.js";
import { bridgePageScript } from "./world-bridge-page.js";
import { WorldLoading } from "./world-loading.js";
import { messageOf } from "./world-loader.js";
import {
  useStandupBell,
  useWorldScript,
  worldStartOptions,
  type WorldLatest,
} from "./world-view-shared.js";
import type { WorldViewProps } from "./world-view.js";

const noFocus = () => undefined;

type WorldViewNativeSceneProps = Omit<WorldViewProps, "plan"> & { plan: WorldPlan };

/**
 * The office in 3D where there is no DOM to open a frame in: a ScriptFrame of the kit runs the
 * scene's script, and a bridge gives this view the scene's API over messages. The surface renders
 * it only where the kit has ScriptFrame. Whether the phone can draw it is found in the page: with no
 * WebGL2 the scene posts a problem, and the surface gives way to the 2D office.
 *
 * `focusApp` has nothing to do here: a page of a WebView does not take the app's keys. Photo mode is
 * off, since a WebView cannot keep a download.
 */
function WorldViewNativeScene({
  model,
  theme,
  styles,
  plan,
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
  incidents,
  onOpenIncidents,
  onProblem,
  sound,
}: WorldViewNativeSceneProps) {
  const Frame = kitScriptFrame();
  const onBell = useStandupBell();
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
      onSound: sound.set,
      onProblem,
    };
  });

  const script = useWorldScript(Frame !== null, onProblem);
  const page = useMemo(() => (script === null ? null : bridgePageScript(script)), [script]);
  const frame = useRef<ScriptFrameHandle | null>(null);
  const bridge = useRef<WorldBridge | null>(null);
  const [api, setApi] = useState<WorldApi | null>(null);

  // The frame is mounted when this runs, so its handle is there. Its posts wait for the page, in
  // order: start goes first, then whatever the feed sends once `api` is set.
  useEffect(() => {
    const handle = frame.current;
    if (page === null || handle === null) return undefined;
    const made = createWorldBridge((text) => handle.post(text));
    bridge.current = made;
    try {
      made.api.start(
        worldStartOptions(latest, {
          focus: noFocus,
          brand: worldBrand(null),
          photo: false,
          plan,
        }),
      );
    } catch (error) {
      latest.current.onProblem(messageOf(error));
      return undefined;
    }
    setApi(made.api);
    return () => {
      made.api.stop();
      bridge.current = null;
      setApi(null);
    };
  }, [page, plan]);

  const { note } = useWorldFeed(api, {
    model,
    theme,
    focusRoomId,
    focusRequest,
    selectedAgentId,
    machine,
    meeting,
    incidents,
    sound: sound.on,
    plan,
  });

  const onMessage = useCallback((text: string) => bridge.current?.receive(text), []);
  const onError = useCallback((message: string) => latest.current.onProblem(message), []);

  return (
    <View style={styles.scene}>
      {Frame !== null && page !== null ? (
        <Frame
          ref={frame}
          script={page}
          title="Office in 3D"
          onMessage={onMessage}
          onError={onError}
        />
      ) : null}
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
 * The office in 3D on the phone's script frame, on the host's plan. A changed plan unmounts the
 * `ScriptFrame` and mounts a new one: the scene's page starts once.
 */
export function WorldViewNative({ plan, ...rest }: WorldViewProps) {
  if (plan === null) return <WorldLoading styles={rest.styles} />;
  return <WorldViewNativeScene key={plan} plan={plan} {...rest} />;
}
