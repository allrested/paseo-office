import { useEffect, useMemo, useState } from "react";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { worldWordsRpc } from "../../shared/contracts.js";
import {
  LANGUAGE_NAMES,
  isWordsLanguage,
  sceneLanguage,
  type LanguageChoice,
  type SceneLanguage,
} from "../../shared/scene-language.js";
import { officeLanguageSettings } from "../../shared/settings.js";
import { useAppLocale } from "../app-locale.js";
import { sharedWordsLoader } from "./words-loader.js";
import { messageOf } from "./world-loader.js";

export interface SceneWords {
  status: "loading" | "ready";
  language: SceneLanguage;
  words: string | undefined;
  note: string | null;
}

type Arrived =
  | { language: SceneLanguage; words: string }
  | { language: SceneLanguage; failure: string };
const LOADING: SceneWords = { status: "loading", language: "en", words: undefined, note: null };

/**
 * The language the 3D office starts in and its words. The device's choice (or the app's language, for Automatic) is read
 * first; a language that is not English is asked of the host, once per page. The scene waits for both, so it starts in
 * its language and is not started twice. Words that cannot be loaded give English and a note, never a problem report:
 * a problem would take the 3D view away.
 */
export function useSceneWords(): SceneWords {
  const settings = useSettings(officeLanguageSettings);
  const appLocale = useAppLocale();
  const fetchWords = useRpc(worldWordsRpc);
  let choice: LanguageChoice | null = null;
  if (settings.status === "ready") choice = settings.values.choice;
  else if (settings.status !== "loading") choice = "auto";
  const wanted = choice === null ? null : sceneLanguage(choice, appLocale);
  const [arrived, setArrived] = useState<Arrived | null>(null);
  useEffect(() => {
    if (wanted === null || !isWordsLanguage(wanted)) return undefined;
    let current = true;
    sharedWordsLoader
      .load(wanted, (language) => fetchWords({ language }))
      .then(
        (words) => {
          if (current) setArrived({ language: wanted, words });
          return undefined;
        },
        (error: unknown) => {
          if (current) setArrived({ language: wanted, failure: messageOf(error) });
        },
      );
    return () => {
      current = false;
    };
  }, [wanted, fetchWords]);
  return useMemo(() => {
    if (wanted === null) return LOADING;
    if (!isWordsLanguage(wanted))
      return { status: "ready", language: "en", words: undefined, note: null };
    if (arrived === null || arrived.language !== wanted) return LOADING;
    if ("failure" in arrived) {
      return {
        status: "ready",
        language: "en",
        words: undefined,
        note: `${LANGUAGE_NAMES[wanted]} text could not be loaded; the scene is in English`,
      };
    }
    return { status: "ready", language: wanted, words: arrived.words, note: null };
  }, [wanted, arrived]);
}
