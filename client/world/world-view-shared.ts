import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { notesWriteRpc, worldRpc } from "../../shared/contracts.js";
import type { OfficeModel } from "../../shared/model.js";
import { isWordsLanguage, type SceneLanguage } from "../../shared/scene-language.js";
import { failureText } from "../action-button.js";
import { boardRoom, isDarkTheme, type WorldPlan } from "./adapter.js";
import type { WorldBrand, WorldStartOptions } from "./world-api.js";
import { sharedWorldLoader } from "./world-loader.js";

/** What the scene's callbacks and its start read: always the last render's. */
export interface WorldLatest {
  scene?: WorldStartOptions["scene"];
  night?: boolean | undefined;
  street?: { kit: string | null } | null;
  model: OfficeModel;
  theme: PluginTheme;
  focusRoomId: string | null;
  selectedAgentId: string | null;
  onSelectAgent(agentId: string | null): void;
  onSelectBoard(roomId: string): void;
  onOpenMachine(): void;
  onOpenResources: (() => void) | undefined;
  onOpenAgentWorkspace: ((agentId: string) => void) | undefined;
  onOpenLibrary(): void;
  onOpenNotes(): void;
  onOpenIncidents(): void;
  /** The pantry's duty board: the duty board's editor. */
  onOpenDuties?(): void;
  /** A figure acted out a pretend duty: the host records it done by that agent. */
  onDutyActed?(id: string, agentId: string): void;
  onBell(): void | Promise<void>;
  onLife?: WorldStartOptions["onLife"];
  onTenure?: WorldStartOptions["onTenure"];
  onSound(on: boolean): void;
  onProblem(message: string): void;
}

/**
 * The scene's start, read from the last render. What a callback opens is Paseo's (a card, a sheet):
 * the keyboard goes with it through `extras.focus`. The bell opens nothing of Paseo's, and a card
 * closed from the scene opens nothing, so neither takes the keyboard.
 */
export function worldStartOptions(
  latest: { readonly current: WorldLatest },
  extras: {
    focus(): void;
    onToggleFullscreen?: () => void;
    brand: WorldBrand;
    plan: WorldPlan;
    photo?: false;
    language: SceneLanguage;
    words: string | undefined;
  },
): WorldStartOptions {
  const { focus } = extras;
  const { colors } = latest.current.theme;
  return {
    ...(latest.current.scene ? { scene: latest.current.scene } : {}),
    ...(latest.current.street ? { street: latest.current.street } : {}),
    plan: extras.plan,
    ...(extras.onToggleFullscreen ? { onToggleFullscreen: extras.onToggleFullscreen } : {}),
    dark: latest.current.night ?? isDarkTheme(colors),
    colors,
    brand: extras.brand,
    ...(isWordsLanguage(extras.language) && extras.words !== undefined
      ? { language: extras.language, words: extras.words }
      : {}),
    ...(extras.photo === undefined ? {} : { photo: extras.photo }),
    onSelect: (agentId) => {
      if (agentId !== null) focus();
      latest.current.onSelectAgent(agentId);
    },
    onBoard: (project) => {
      focus();
      const now = latest.current;
      const roomId = boardRoom(now.model, {
        project,
        focusRoomId: now.focusRoomId,
        selectedAgentId: now.selectedAgentId,
      });
      if (roomId !== null) now.onSelectBoard(roomId);
    },
    onMachine: () => {
      focus();
      latest.current.onOpenMachine();
    },
    onLibrary: () => {
      focus();
      latest.current.onOpenLibrary();
    },
    // Given only where Paseo can show Resources: otherwise the scene keeps the wall screen on
    // onMachine, the Host card.
    ...(latest.current.onOpenResources === undefined
      ? {}
      : {
          onResources: () => {
            focus();
            latest.current.onOpenResources?.();
          },
        }),
    // Give the workspace the keyboard when the walker interacts with a person.
    ...(latest.current.onOpenAgentWorkspace === undefined
      ? {}
      : {
          onOpen: (agentId: string) => {
            focus();
            latest.current.onOpenAgentWorkspace?.(agentId);
          },
        }),
    onLife: (kind, vars) => latest.current.onLife?.(kind, vars),
    onTenure: (op) => latest.current.onTenure?.(op),
    onBell: () => void latest.current.onBell(),
    onSound: (on) => latest.current.onSound(on),
    onNotes: () => {
      focus();
      latest.current.onOpenNotes();
    },
    onIncidents: () => {
      focus();
      latest.current.onOpenIncidents();
    },
    onDuties: () => {
      focus();
      latest.current.onOpenDuties?.();
    },
    // (nothing of Paseo's opens: the keyboard stays in the office)
    onDutyDone: (id, agentId) => latest.current.onDutyActed?.(id, agentId),
    onProblem: (message) => latest.current.onProblem(message),
  };
}

const subscribe = (listener: () => void) => sharedWorldLoader.subscribe(listener);
const read = () => sharedWorldLoader.state();

/**
 * The office's script, loaded once per page. Nothing loads while `enabled` is false (a tab that was
 * never shown has no size). After a failed load the loader keeps its failure until asked again, so
 * the answer is read after this load, not from the render's state.
 */
export function useWorldScript(
  enabled: boolean,
  onProblem: (message: string) => void,
): string | null {
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchWorld = useRpc(worldRpc);
  const fetchScript = useCallback(() => fetchWorld({}), [fetchWorld]);
  const problem = useRef(onProblem);
  useEffect(() => {
    problem.current = onProblem;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    async function load(): Promise<void> {
      await sharedWorldLoader.load(fetchScript);
      const state = sharedWorldLoader.state();
      if (mounted && state.status === "failed") problem.current(state.error);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [fetchScript, enabled]);
  return loadState.status === "ready" ? loadState.script : null;
}

/**
 * A click on the bell has the stand-up notes written. Whether a writer started is not waited for:
 * the Stand-up card's line says what the writer does.
 */
export function useStandupBell(): () => Promise<void> {
  const writeNotes = useRpc(notesWriteRpc);
  const toast = useToast();
  return useCallback(async () => {
    try {
      await writeNotes({});
    } catch (error) {
      toast.error(failureText("Write the stand-up notes", error));
    }
  }, [writeNotes, toast]);
}
