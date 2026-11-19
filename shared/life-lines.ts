// The office's life in the team chat: what upstream's chatLife (ui/group-chat.js) says for each kind of
// moment, as a table the server reads. The scene sends a kind and a few words; this gives the sender,
// the words' key under chat.life.* and the options the engine's say() takes. Nothing here is text the
// scene wrote.
export interface LifeContext {
  /** The people at rest now, by id. */
  resting(): string[];
  /** A person's name in the chat; null when unknown. */
  name(id: string): string | null;
  now: number;
}

export interface LifeLine {
  from: string;
  key: string;
  vars: Record<string, string>;
  options: {
    key: string;
    pin?: boolean;
    react?: string[];
    reacts?: number;
    answer?: { key: string; chance?: number }[];
  };
  /** A second line, said after a delay by another sender (upstream's "got it" and "sorry"). */
  extra?: { from: string; key: string; delay: number };
}

type Vars = Readonly<Record<string, string>>;
interface Row extends Omit<LifeLine["options"], "key"> {
  from: "hr" | "reception" | "person" | "anyone";
  key: string | ((vars: Vars) => string);
  /** The words' key lives under this prefix (default chat.life.). */
  prefix?: string;
  extra?: { from: "person" | "who"; key: string; delay: number };
}

const ask = (key: string, ...chances: number[]) => chances.map((chance) => ({ key, chance }));

const ROWS: Readonly<Record<string, Row>> = {
  standup: {
    from: "hr",
    key: "standup",
    pin: true,
    react: ["👍"],
    reacts: 3,
    answer: [{ key: "meeting", chance: 0.7 }],
  },
  nap: { from: "anyone", key: "nap", react: ["😆", "❤️"], reacts: 2 },
  wake: { from: "anyone", key: "wake", react: ["😭", "😆"], reacts: 2 },
  parcel: {
    from: "reception",
    key: "parcel",
    extra: { from: "person", key: "chat.reply.parcelGot", delay: 4500 },
  },
  tea: {
    from: "anyone",
    key: "tea",
    react: ["❤️", "😆", "😮"],
    reacts: 4,
    answer: [{ key: "milkTea", chance: 0.6 }],
  },
  birthday: {
    from: "hr",
    key: "birthday",
    react: ["❤️", "😆"],
    reacts: 5,
    answer: [{ key: "hpbd" }, { key: "hpbd", chance: 0.8 }, { key: "hpbd", chance: 0.5 }],
  },
  stairs: {
    from: "person",
    key: "stairs",
    react: ["😭", "😆"],
    reacts: 3,
    answer: ask("stairsAsk", 0.9, 0.5),
  },
  liftDone: { from: "reception", key: "liftDone", react: ["👍", "❤️"], reacts: 3 },
  altar: { from: "reception", key: "altar", react: ["❤️"], reacts: 3 },
  trophy: {
    from: "hr",
    key: "trophy",
    react: ["❤️", "😮"],
    reacts: 5,
    answer: [{ key: "deploy", chance: 0.7 }],
  },
  bye: { from: "person", key: "chat.work.bye", prefix: "", answer: [{ key: "bye", chance: 0.6 }] },
  official: {
    from: "hr",
    key: "official",
    react: ["🎉", "❤️", "👍", "😆"],
    reacts: 7,
    answer: ask("officialAsk", 0.95, 0.8, 0.5),
  },
  farewell: {
    from: "hr",
    key: "farewell",
    pin: true,
    react: ["😭", "❤️"],
    reacts: 4,
    answer: ask("farewellAsk", 0.9, 0.6),
  },
  farewellPhoto: {
    from: "hr",
    key: "farewellPhoto",
    react: ["❤️", "😭", "😆"],
    reacts: 6,
    answer: ask("farewellAsk", 0.9, 0.7, 0.4),
  },
  back: {
    from: "anyone",
    key: "back",
    react: ["😆", "❤️", "😮"],
    reacts: 5,
    answer: ask("backAsk", 0.95, 0.6),
  },
  micro: {
    from: "anyone",
    key: (v) => (v.monday === "true" ? "microMon" : "micro"),
    react: ["😆", "😭"],
    reacts: 3,
    answer: ask("microAsk", 0.8, 0.4),
  },
  microSmell: {
    from: "anyone",
    key: "microSmell",
    react: ["😭", "😆", "😷"],
    reacts: 4,
    answer: ask("smellAsk", 0.95, 0.6),
  },
  microPop: {
    from: "anyone",
    key: "microPop",
    react: ["😆", "😮"],
    reacts: 3,
    answer: ask("popAsk", 0.9),
  },
  makeup: {
    from: "anyone",
    key: "makeup",
    react: ["😩", "😆", "😭"],
    reacts: 4,
    answer: ask("makeup", 0.95, 0.6),
  },
  breakEve: {
    from: "anyone",
    key: (v) => (v.makeup ? "breakEveMakeup" : "breakEve"),
    react: ["🥳", "❤️", "😆"],
    reacts: 5,
    answer: ask("breakEve", 0.95, 0.7),
  },
  drillNotice: {
    from: "hr",
    key: "drillNotice",
    pin: true,
    react: ["👍", "🧯", "😭"],
    reacts: 4,
    answer: ask("drillNotice", 0.9, 0.6),
  },
  drillDone: {
    from: "hr",
    key: "drillDone",
    react: ["👏", "❤️", "😆"],
    reacts: 5,
    answer: ask("drillDone", 0.9, 0.6),
  },
  dutyRoster: {
    from: "hr",
    key: "dutyRoster",
    react: ["👍", "🙏"],
    reacts: 3,
    answer: [{ key: "dutyRoster", chance: 0.6 }],
  },
  dutyGrumble: {
    from: "anyone",
    key: (v) => `duty_${v.chore}`,
    react: ["😤", "😆", "😭"],
    reacts: 3,
    extra: { from: "who", key: "chat.reply.dutySorry", delay: 5000 },
  },
};

export const LIFE_KINDS: readonly string[] = Object.keys(ROWS);

function sender(role: Row["from"], kind: string, id: string, ctx: LifeContext): string | null {
  if (role === "hr" || role === "reception") return role;
  const person = id && ctx.name(id) !== null ? id : null;
  if (role === "person" || person !== null) return person;
  const resting = ctx.resting();
  return (
    resting[Math.floor(Math.random() * resting.length)] ??
    (kind === "microSmell" || kind === "microPop" ? null : "reception")
  );
}

/** The office chooses the words, sender and a period key shared by all devices. */
export function lifeLine(kind: string, vars: Vars, ctx: LifeContext): LifeLine | null {
  const row = Object.hasOwn(ROWS, kind) ? ROWS[kind] : undefined;
  if (!row) return null;
  const { from: role, key, prefix = "chat.life.", extra, ...options } = row;
  const id = vars.id ?? "";
  const from = sender(role, kind, id, ctx);
  if (from === null) return null;
  const every = Number(vars.every) > 0 ? Number(vars.every) : 20 * 60_000;
  const line: LifeLine = {
    from,
    key: prefix + (typeof key === "function" ? key(vars) : key),
    vars: { ...vars, name: vars.name ?? ctx.name(id) ?? "" },
    options: { ...options, key: `life:${kind}:${id}:${Math.floor(ctx.now / every)}` },
  };
  if (extra) {
    const to = extra.from === "who" ? vars.who : id;
    if (to && ctx.name(to) !== null) line.extra = { ...extra, from: to };
  }
  return line;
}
