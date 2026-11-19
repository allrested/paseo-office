import { WORLD_WORDS } from "./words.generated.js";

export interface WorldWords {
  /** One language's words as JSON text: `{ dict, ours? }`. */
  read(language: string): Promise<string>;
}

/** The words as the plugin carries them, built from `vendor/my-office` by `scripts/build-world.mjs`. */
export function embeddedWorldWords(): WorldWords {
  return {
    read: async (language) => {
      const text = Object.hasOwn(WORLD_WORDS, language) ? WORLD_WORDS[language] : undefined;
      if (text === undefined) throw new Error(`The office has no words for ${language}`);
      return text;
    },
  };
}
