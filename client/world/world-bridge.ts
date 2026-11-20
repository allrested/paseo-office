import type { GroupPhotoCapture } from "../use-group-photo.js";
import { WORLD_API_VERSION, type WorldApi, type WorldStartOptions } from "./world-api.js";

/** From the plugin to the page: a call of `PaseoOfficeWorld`. */
export interface BridgeCall {
  call: string;
  args: unknown[];
}

/** From the page to the plugin: a callback the plugin gave `start`, or a problem. */
export type BridgeReply = { callback: string; args: unknown[] } | { problem: string };

export interface WorldBridge {
  api: WorldApi;
  receive(text: string): void;
}

type Handler = (...args: unknown[]) => void;

/** The page's reply in `text`, or null for text that is not one. */
function parseReply(text: string): BridgeReply | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { callback, args, problem } = value as Record<string, unknown>;
  if (typeof problem === "string") return { problem };
  if (typeof callback === "string" && Array.isArray(args)) return { callback, args };
  return null;
}

/** The sign shows a logo only from a `data:` URL: the page's policy refuses any other image. */
function brandForPage(brand: WorldStartOptions["brand"]): WorldStartOptions["brand"] {
  if (brand === undefined) return undefined;
  return {
    ...brand,
    logoUrl: brand.logoUrl?.startsWith("data:") ? brand.logoUrl : null,
  };
}

/**
 * The scene's API over messages. Each call becomes `{ call, args }` for `post`; the page answers
 * with `{ callback, args }` for a callback `start` was given, or `{ problem }`. A photo request waits
 * for its matching JPEG or the capture timeout.
 */
export function createWorldBridge(
  post: (text: string) => void,
  onPhotoReady?: (capture: GroupPhotoCapture | null) => void,
): WorldBridge {
  const handlers = new Map<string, Handler>();
  const send = (message: BridgeCall) => post(JSON.stringify(message));
  const sender =
    (call: string) =>
    (...args: unknown[]) =>
      send({ call, args });

  let pendingPhoto: {
    id: number;
    timer: ReturnType<typeof setTimeout>;
    resolve(data: string | null): void;
  } | null = null;
  let photoId = 0;
  const finishPhoto = (data: string | null) => {
    if (!pendingPhoto) return;
    clearTimeout(pendingPhoto.timer);
    const { resolve } = pendingPhoto;
    pendingPhoto = null;
    resolve(data);
  };
  const capture = (): Promise<string | null> => {
    finishPhoto(null);
    const id = ++photoId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => finishPhoto(null), 10_000);
      pendingPhoto = { id, resolve, timer };
      try {
        send({ call: "captureGroupPhoto", args: [id] });
      } catch {
        finishPhoto(null);
      }
    });
  };

  const api: WorldApi = {
    version: WORLD_API_VERSION,
    start(options) {
      handlers.clear();
      const data: Record<string, unknown> = {};
      const callbacks: string[] = [];
      for (const [key, value] of Object.entries(options)) {
        if (typeof value === "function") {
          handlers.set(key, value as Handler);
          callbacks.push(key);
        } else if (key !== "brand") {
          data[key] = value;
        }
      }
      if (onPhotoReady) {
        handlers.set("onCaptureReady", () => onPhotoReady(capture));
        handlers.set("onCaptured", (id, photo) => {
          if (pendingPhoto && id === pendingPhoto.id)
            finishPhoto(typeof photo === "string" ? photo : null);
        });
        callbacks.push("onCaptureReady", "onCaptured");
      }
      const brand = brandForPage(options.brand);
      send({
        call: "start",
        args: [{ ...data, ...(brand === undefined ? {} : { brand }), callbacks }],
      });
    },
    stop() {
      handlers.clear();
      finishPhoto(null);
      onPhotoReady?.(null);
      send({ call: "stop", args: [] });
    },
    setTheme: sender("setTheme"),
    setSessions: sender("setSessions"),
    event: sender("event"),
    select: sender("select"),
    focusProject: sender("focusProject"),
    setBoardRows: sender("setBoardRows"),
    setDuties: sender("setDuties"),
    photoRelease: sender("photoRelease"),
    setClaudeVersion: sender("setClaudeVersion"),
    setTenure: sender("setTenure"),
    setLiftService: sender("setLiftService"),
    setMachine: sender("setMachine"),
    meet: sender("meet"),
    gather: sender("gather"),
    setWeather: sender("setWeather"),
    setIncidents: sender("setIncidents"),
    setSound: sender("setSound"),
  };

  return {
    api,
    receive(text) {
      const reply = parseReply(text);
      if (reply === null) return;
      if ("problem" in reply) handlers.get("onProblem")?.(reply.problem);
      else handlers.get(reply.callback)?.(...reply.args);
    },
  };
}
