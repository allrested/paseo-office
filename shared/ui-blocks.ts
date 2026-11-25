/**
 * The Generative UI plugin (`genui`) has agents write `ui` and `app` code blocks that Paseo's
 * chat draws as live cards. The office's own transcript cannot draw them: it shows where one is.
 */
export type UiPiece =
  | { kind: "text"; text: string }
  | {
      kind: "block";
      language: "ui" | "app";
      /** The first card's title of a `ui` block, the page title of an `app` block. */
      title: string | null;
      /** False while the reply is still streaming the block. */
      complete: boolean;
    };

const TITLE_MAX = 80;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;

function unescaped(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}

function titleOf(language: "ui" | "app", body: string): string | null {
  const found =
    language === "ui"
      ? /\bCard\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')/.exec(body)
      : /<title>([^<]*)<\/title>/i.exec(body);
  const raw = found?.[1] ?? found?.[2];
  if (raw === undefined) return null;
  const title = (
    language === "ui"
      ? unescaped(raw)
      : raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
  return title === "" ? null : title;
}

/**
 * A reply as prose and the places of its `ui` and `app` blocks, in order. A reply with none is
 * one piece, the text unchanged. A fence inside another code block is that block's text.
 */
export function splitUiBlocks(text: string): UiPiece[] {
  const lines = text.split("\n");
  const pieces: UiPiece[] = [];
  let prose: string[] = [];
  const flush = () => {
    const joined = prose.join("\n").trim();
    if (joined !== "") pieces.push({ kind: "text", text: joined });
    prose = [];
  };
  let index = 0;
  while (index < lines.length) {
    const open = FENCE.exec(lines[index]);
    if (open === null) {
      prose.push(lines[index]);
      index += 1;
      continue;
    }
    const [, marks, word] = open;
    let close = index + 1;
    while (close < lines.length) {
      const end = FENCE.exec(lines[close]);
      if (end && end[2] === "" && end[1][0] === marks[0] && end[1].length >= marks.length) break;
      close += 1;
    }
    const complete = close < lines.length;
    if (word === "ui" || word === "app") {
      flush();
      const body = lines.slice(index + 1, close).join("\n");
      pieces.push({ kind: "block", language: word, title: titleOf(word, body), complete });
    } else {
      prose.push(...lines.slice(index, close + 1));
    }
    index = close + 1;
  }
  flush();
  return pieces.some((piece) => piece.kind === "block") ? pieces : [{ kind: "text", text }];
}
