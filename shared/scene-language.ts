export const SCENE_LANGUAGES = ["en", "vi", "th", "id"] as const;
export type SceneLanguage = (typeof SCENE_LANGUAGES)[number];
export const WORDS_LANGUAGES = ["vi", "th", "id"] as const;
export type WordsLanguage = (typeof WORDS_LANGUAGES)[number];
export const LANGUAGE_CHOICES = ["auto", ...SCENE_LANGUAGES] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];
export const LANGUAGE_NAMES = {
  en: "English",
  vi: "Tiếng Việt",
  th: "ไทย",
  id: "Bahasa Indonesia",
} as const;

export function languageOfLocale(locale: string): SceneLanguage {
  const base = locale.trim().toLowerCase().split(/[-_]/)[0];
  if (base === "in") return "id";
  return SCENE_LANGUAGES.find((language) => language === base) ?? "en";
}

export function sceneLanguage(choice: LanguageChoice, appLocale: string): SceneLanguage {
  return choice === "auto" ? languageOfLocale(appLocale) : choice;
}

export function isWordsLanguage(language: SceneLanguage): language is WordsLanguage {
  return language !== "en";
}
