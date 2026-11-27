import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { sceneLanguage, type SceneLanguage } from "../shared/scene-language.js";
import { officeLanguageSettings } from "../shared/settings.js";
import { UI_ID } from "../shared/ui-words-id.js";
import { useAppLocale } from "./app-locale.js";

const UiLanguageContext = createContext<SceneLanguage>("en");

/** The text in the interface's language; the English itself where that language has no word for it. */
export function translate(language: SceneLanguage, text: string): string {
  return language === "id" ? (UI_ID[text] ?? text) : text;
}

/**
 * Gives the office's own interface the language the 3D scene speaks: the device's choice, or the
 * app's language for Automatic. Indonesian has words; any other language shows English.
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
