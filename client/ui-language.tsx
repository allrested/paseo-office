import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import {
  isWordsLanguage,
  sceneLanguage,
  type SceneLanguage,
  type WordsLanguage,
} from "../shared/scene-language.js";
import { officeLanguageSettings } from "../shared/settings.js";
import { translatePattern as translateId } from "../shared/ui-patterns-id.js";
import { translatePattern as translateTh } from "../shared/ui-patterns-th.js";
import { translatePattern as translateVi } from "../shared/ui-patterns-vi.js";
import { useAppLocale } from "./app-locale.js";

const UiLanguageContext = createContext<SceneLanguage>("en");

const TRANSLATORS: Readonly<Record<WordsLanguage, (text: string) => string>> = {
  id: translateId,
  vi: translateVi,
  th: translateTh,
};

/** The text in the interface's language; the English itself where that language has no word for it. */
export function translate(language: SceneLanguage, text: string): string {
  return isWordsLanguage(language) ? TRANSLATORS[language](text) : text;
}

/**
 * Gives the office's own interface the language the 3D scene speaks: the device's choice, or the
 * app's language for Automatic. Vietnamese, Thai and Indonesian have words; English is the text itself.
 */
export function UiLanguage({ children }: { children: ReactNode }) {
  const settings = useSettings(officeLanguageSettings);
  const appLocale = useAppLocale();
  const choice = settings.status === "ready" ? settings.values.choice : "auto";
  const language = sceneLanguage(choice, appLocale);
  return <UiLanguageContext.Provider value={language}>{children}</UiLanguageContext.Provider>;
}

/** Translates a label, a hint or a title. Outside `UiLanguage` it gives the text back. */
export function useT(): (text: string) => string {
  const language = useContext(UiLanguageContext);
  return useCallback((text: string) => translate(language, text), [language]);
}
