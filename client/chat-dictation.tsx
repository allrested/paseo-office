import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "./text.js";
import { CHAT_TEXT_MAX } from "../shared/contracts.js";
import type { ChatDraft } from "./office-link.js";
import type { OfficeStyles } from "./styles.js";
import { ActionButton } from "./action-button.js";

/** Only the Web Speech API surface used by the composer. Safari exposes the prefixed constructor. */
interface SpeechEvents {
  result: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  };
  error: { error: string };
  end: Event;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  addEventListener<T extends keyof SpeechEvents>(
    type: T,
    listener: (event: SpeechEvents[T]) => void,
    options: { signal: AbortSignal },
  ): void;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechConstructor = new () => Recognition;
function speechConstructor(): SpeechConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const api = window as Window & {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return api.SpeechRecognition ?? api.webkitSpeechRecognition;
}

export function Dictation({
  setText,
  styles,
}: {
  setText: ChatDraft["setText"];
  styles: OfficeStyles;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<{ voice: Recognition; listeners: AbortController } | null>(null);
  useEffect(
    () => () => {
      const active = current.current;
      if (active) {
        active.listeners.abort();
        active.voice.abort();
      }
    },
    [],
  );
  const toggle = useCallback(() => {
    if (current.current) {
      current.current.voice.stop();
      return;
    }
    const Speech = speechConstructor();
    if (!Speech) return;
    const voice = new Speech();
    voice.lang = document.documentElement.lang || navigator.language;
    voice.continuous = true;
    voice.interimResults = false;
    let consumed = 0;
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    voice.addEventListener(
      "result",
      ({ resultIndex, results }) => {
        const words = [];
        for (let n = Math.max(resultIndex, consumed); n < results.length; n++) {
          if (results[n].isFinal) {
            words.push(results[n][0].transcript);
            consumed = n + 1;
          }
        }
        const phrase = words.join(" ").trim();
        if (phrase)
          setText((previous) =>
            (previous.trimEnd() + " " + phrase).trimStart().slice(0, CHAT_TEXT_MAX),
          );
      },
      options,
    );
    const finish = () => {
      listeners.abort();
      current.current = null;
      setListening(false);
    };
    voice.addEventListener("end", finish, options);
    voice.addEventListener(
      "error",
      ({ error: why }) => {
        if (why !== "aborted")
          setError(
            why === "not-allowed"
              ? "Allow microphone access in your browser to dictate."
              : "Dictation stopped. Check your microphone and try again.",
          );
        finish();
      },
      options,
    );
    current.current = { voice, listeners };
    setError("");
    try {
      voice.start();
      setListening(true);
    } catch {
      finish();
      setError("Your browser could not start dictation.");
    }
  }, [setText]);
  if (!speechConstructor()) return null;
  const label = listening ? "Stop dictation" : "Dictate message";
  return (
    <>
      <ActionButton label={label} pendingLabel={label} onPress={toggle} styles={styles} />
      {error && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      )}
    </>
  );
}
