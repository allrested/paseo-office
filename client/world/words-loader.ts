import type { WordsLanguage } from "../../shared/scene-language.js";

export interface WordsLoader {
  /** Loads a language once per page; a failure is not kept, so a later call asks again. */
  load(
    language: WordsLanguage,
    fetchWords: (language: WordsLanguage) => Promise<string>,
  ): Promise<string>;
}

export function createWordsLoader(): WordsLoader {
  const ready = new Map<WordsLanguage, string>();
  const pending = new Map<WordsLanguage, Promise<string>>();
  return {
    load(language, fetchWords) {
      const done = ready.get(language);
      if (done !== undefined) return Promise.resolve(done);
      let running = pending.get(language);
      if (running === undefined) {
        running = fetchWords(language)
          .then((text) => {
            if (text.trim() === "") throw new Error(`The host sent no ${language} text`);
            ready.set(language, text);
            return text;
          })
          .finally(() => pending.delete(language));
        pending.set(language, running);
      }
      return running;
    },
  };
}

/** One per page: a language's words stay in memory once a device has loaded them. */
export const sharedWordsLoader: WordsLoader = createWordsLoader();
