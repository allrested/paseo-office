import { openExternalUrl } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { failureReason, withPlaceholders } from "../shared/genui-placeholders.js";
import { type GenuiAction, type GenuiKit, type GenuiRuntime, useGenuiKit } from "./genui-kit.js";

/** What a card can do for the session it sits in: send a reply to its agent. */
export interface GenuiSession {
  agentId: string;
  send(text: string): Promise<void>;
}

export const GenuiSessionContext = createContext<GenuiSession | null>(null);

/** One note for a component that would read a file or load an image. */
const NO_IMAGES = {
  ok: false,
  off: true,
  error: "Needs the Generative UI plugin's workspace chat.",
} as const;
const loadNoImage = () => Promise.resolve(NO_IMAGES);

function LiveSpec({
  kit,
  program,
  blockKey,
  theme,
}: {
  kit: GenuiKit;
  program: object;
  blockKey: string;
  theme: PluginTheme;
}) {
  const session = useContext(GenuiSessionContext);
  const toast = useToast();
  const initial = useMemo(() => kit.initialState(program), [kit, program]);
  const [changed, setChanged] = useState<Record<string, unknown>>({});
  const state = useMemo(() => ({ ...initial, ...changed }), [initial, changed]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [queue, setQueue] = useState<readonly { id: string; text: string }[]>([]);

  const setValue = useCallback(
    (name: string, value: unknown) => {
      if (Object.hasOwn(initial, name)) setChanged((before) => ({ ...before, [name]: value }));
    },
    [initial],
  );
  const setQueued = useCallback(
    (id: string, text: string | null) =>
      setQueue((before) => {
        const rest = before.filter((item) => item.id !== `${blockKey}:${id}`);
        return text === null ? rest : [...rest, { id: `${blockKey}:${id}`, text }];
      }),
    [blockKey],
  );

  const runAction = useCallback(
    async (action: GenuiAction) => {
      switch (action.type) {
        case "set":
          setValue(action.name, action.value);
          return;
        case "queue": {
          const id = `queue:${action.text}`;
          const queued = queue.some((item) => item.id === `${blockKey}:${id}`);
          setQueued(id, queued ? null : action.text);
          return;
        }
        case "send":
          // Without a session to answer to, a button that sends does nothing.
          if (session === null) return;
          await session.send(
            kit.composeReply(
              queue.map((item) => item.text),
              action.text,
            ),
          );
          setQueue([]);
          setAnswer(action.text);
          return;
        case "openUrl":
          await openExternalUrl(action.url);
          return;
        case "copy":
          await copyText(action.text);
          toast.show("Copied");
          return;
      }
    },
    [kit, queue, blockKey, session, setQueued, setValue, toast],
  );

  const runtime = useMemo(
    (): GenuiRuntime => ({
      setValue,
      openFile: null,
      loadImage: loadNoImage,
      readText: null,
      loadAudio: null,
      playAudio: null,
      answer,
      queue,
      setQueued,
      queued: (id) => queue.find((item) => item.id === `${blockKey}:${id}`)?.text ?? null,
      superseded: false,
      agentId: session?.agentId ?? null,
      blockKey,
      theme,
      compact: true,
      platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web",
      async run(actions) {
        try {
          for (const action of actions) await runAction(action);
        } catch (failure) {
          toast.show(failure instanceof Error ? failure.message : String(failure));
        }
      },
    }),
    [setValue, answer, queue, setQueued, blockKey, session, theme, runAction, toast],
  );

  const { roots } = useMemo(() => kit.evaluate(program, state), [kit, program, state]);
  const nodes = useMemo(() => withPlaceholders(roots), [roots]);
  return (
    <kit.UiRuntimeContext.Provider value={runtime}>
      <View style={CARD_GAP}>
        <kit.RenderNodes nodes={nodes} isolate />
      </View>
    </kit.UiRuntimeContext.Provider>
  );
}

const CARD_GAP = { gap: 8, marginVertical: 4 } as const;

/**
 * A complete `ui` block, drawn by the vendored Generative UI renderer. While that loads, and when
 * it cannot parse or load, `fallback` says why in its place (the title card).
 */
export function GenuiBlock({
  source,
  blockKey,
  theme,
  fallback,
}: {
  source: string;
  blockKey: string;
  theme: PluginTheme;
  fallback(reason: string | null): ReactNode;
}) {
  const loaded = useGenuiKit();
  const compiled = useMemo(
    () => (loaded.status === "ready" ? loaded.kit.compile(source) : null),
    [loaded, source],
  );
  if (loaded.status === "loading") return fallback(null);
  if (loaded.status === "failed") return fallback(loaded.message);
  if (compiled === null || compiled.program === null)
    return fallback(failureReason(compiled?.diagnostics ?? []));
  return <LiveSpec kit={loaded.kit} program={compiled.program} blockKey={blockKey} theme={theme} />;
}
