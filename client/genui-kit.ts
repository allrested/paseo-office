import { useEffect, useState, type ComponentType, type Context } from "react";
import type { GenuiNode } from "../shared/genui-placeholders.js";

/** One message from the spec's parser or evaluator. */
export interface GenuiDiagnostic {
  line: number;
  column: number;
  severity: string;
  message: string;
}

/** An action a component asks for; the office runs the ones named in `GenuiAction["type"]`. */
export type GenuiAction =
  | { kind: "action"; type: "set"; name: string; value: unknown }
  | { kind: "action"; type: "queue"; text: string }
  | { kind: "action"; type: "send"; text: string }
  | { kind: "action"; type: "openUrl"; url: string }
  | { kind: "action"; type: "copy"; text: string };

/** What a component reads from its surroundings (vendor/genui/client/runtime.ts). */
export interface GenuiRuntime {
  setValue(name: string, value: unknown): void;
  run(actions: readonly GenuiAction[]): Promise<void>;
  openFile: null;
  loadImage: ((src: string) => Promise<{ ok: false; error: string; off: true }>) | null;
  readText: null;
  loadAudio: null;
  playAudio: null;
  answer: string | null;
  queue: readonly { id: string; text: string }[];
  setQueued(id: string, text: string | null): void;
  queued(id: string): string | null;
  superseded: boolean;
  agentId: string | null;
  blockKey: string | null;
  theme: unknown;
  compact: boolean;
  platform: "ios" | "android" | "web";
}

/** The parts of the vendored renderer the office uses (vendor/genui/entry.tsx). */
export interface GenuiKit {
  compile(source: string): { program: object | null; diagnostics: GenuiDiagnostic[] };
  initialState(program: object): Record<string, unknown>;
  evaluate(
    program: object,
    state: Record<string, unknown>,
  ): { roots: GenuiNode[]; diagnostics: GenuiDiagnostic[] };
  RenderNodes: ComponentType<{ nodes: readonly GenuiNode[]; isolate?: boolean }>;
  UiRuntimeContext: Context<GenuiRuntime | null>;
  composeReply(queued: readonly string[], last: string | null): string;
}

let pending: Promise<GenuiKit> | null = null;

/**
 * The renderer, about 400 KB minified, is a module of its own: its code runs only when a reply
 * first holds a complete `ui` block with the setting on. (The host compiles the client into one
 * file, so the bytes still come with the plugin; what waits is running them.)
 */
export function loadGenuiKit(): Promise<GenuiKit> {
  pending ??= import("./genui-kit.generated.js").then(
    (module) => module as unknown as GenuiKit,
    (failure: unknown) => {
      pending = null;
      throw failure;
    },
  );
  return pending;
}

export type GenuiKitState =
  | { status: "loading" }
  | { status: "ready"; kit: GenuiKit }
  | { status: "failed"; message: string };

export function useGenuiKit(): GenuiKitState {
  const [state, setState] = useState<GenuiKitState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    loadGenuiKit().then(
      (kit) => live && setState({ status: "ready", kit }),
      (failure: unknown) =>
        live &&
        setState({
          status: "failed",
          message: failure instanceof Error ? failure.message : String(failure),
        }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
