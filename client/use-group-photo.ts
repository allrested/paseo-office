import { useCallback, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { chatRpc, GroupPhotoSchema } from "../shared/contracts.js";

export type GroupPhotoCapture = () => string | null | Promise<string | null>;

interface Shot {
  requestId: string;
  data: string;
}

/** One in-flight action per office. Repeat an unacknowledged post with its original picture and ID. */
export function useGroupPhoto() {
  const call = useRpc(chatRpc);
  const [capture, setCapture] = useState<GroupPhotoCapture | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const shot = useRef<Shot | null>(null);
  const onPhotoReady = useCallback((next: GroupPhotoCapture | null) => {
    setCapture(() => next);
  }, []);
  const send = useCallback(() => {
    if (pending.current) return pending.current;
    const run = async () => {
      if (!shot.current) {
        const data = GroupPhotoSchema.safeParse(await capture?.());
        if (!data.success)
          throw new Error(
            "The office could not take a photo. Try again when the 3D floor is ready.",
          );
        const requestId =
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        shot.current = { requestId, data: data.data };
      }
      const result = await call({ op: "photo", ...shot.current });
      if (!result.ok) {
        shot.current = null;
        throw new Error(result.error);
      }
      shot.current = null;
    };
    pending.current = run().finally(() => {
      pending.current = null;
    });
    return pending.current;
  }, [call, capture]);
  return { onPhotoReady, onGroupPhoto: capture ? send : undefined };
}
