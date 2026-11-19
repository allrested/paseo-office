export type PromptHint =
  | { id: "photoBare" | "tooShort" }
  | { id: "dangling" | "vague"; phrase: string }
  | { id: "multi"; n: number };
export function coach(input: { text: string; photos: number; quoted: boolean }): PromptHint[];
export function numberTasks(text: string): string;
