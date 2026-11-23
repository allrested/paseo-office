import { z } from "zod";

export const FAREWELL_DAYS = 30;
export const PROMOTE_TURNS = 20;
export const PROMOTE_DAYS = 2;
const DAY = 86_400_000;
const MAX = 300;
const BACK_SHOWN = DAY;

const TenureEntrySchema = z.object({
  first: z.number(),
  last: z.number(),
  days: z.number(),
  lastDay: z.string(),
  turns: z.number(),
  farewell: z.number().optional(),
  back: z.number().optional(),
  pre: z.boolean().optional(),
  official: z.number().optional(),
  checked: z.boolean().optional(),
});
export type TenureEntry = z.output<typeof TenureEntrySchema>;
/** office/tenure.json. */
export const TenureLedgerSchema = z.object({
  v: z.literal(1),
  seeded: z.boolean(),
  projects: z.record(z.string(), TenureEntrySchema),
});
export type TenureLedger = z.output<typeof TenureLedgerSchema>;
export interface TenureProject {
  name: string;
  last: number;
  days: number;
  turns: number;
  due: boolean;
  farewell: number;
  back: number;
  intern: boolean;
  ready: boolean;
  official: number;
}
export interface SeedTeam {
  name: string;
  first: number;
  daysSeen: number;
}
export interface TenureStore {
  load(): unknown;
  save(data: TenureLedger): void;
}
export interface Tenure {
  touch(team: string, input: { at?: number; turn?: boolean }): "new" | "back" | "ready" | null;
  markFarewell(team: string, live: boolean): boolean;
  markOfficial(team: string): boolean;
  list(live: ReadonlySet<string>): TenureProject[];
  seed(teams: readonly SeedTeam[]): void;
  get(team: string): TenureEntry | null;
  /** A team that goes by another name keeps its entry; false when it has none or `to` is taken. */
  rename(from: string, to: string): boolean;
  /** True once seed() has run on this ledger, now or on an earlier start. */
  seeded(): boolean;
}
export const wasActive = (p: { days?: number } | undefined) => (p?.days ?? 0) >= 2;
export const farewellDue = (
  p: { days?: number; last?: number; farewell?: number } | undefined,
  days: number,
  now: number,
  live: boolean,
) =>
  p !== undefined &&
  days > 0 &&
  wasActive(p) &&
  !p.farewell &&
  !live &&
  now - (p.last ?? now) >= days * DAY;
export const isIntern = (p: { pre?: boolean; official?: number; checked?: boolean } | undefined) =>
  p !== undefined && !p.pre && !p.official && p.checked === true;
export const promoteDue = (
  p:
    | { pre?: boolean; official?: number; checked?: boolean; turns?: number; days?: number }
    | undefined,
) => isIntern(p) && (p?.turns ?? 0) >= PROMOTE_TURNS && (p?.days ?? 0) >= PROMOTE_DAYS;
export function createTenure(deps: { store: TenureStore; now?: () => number }): Tenure {
  const now = deps.now ?? Date.now;
  const parsed = TenureLedgerSchema.safeParse(deps.store.load());
  const ledger: TenureLedger = parsed.data ?? { v: 1, seeded: false, projects: {} };
  // Workspace names can be object property names. Keep one live dictionary until the save queue flushes.
  const projects: Record<string, TenureEntry> = Object.assign(Object.create(null), ledger.projects);
  ledger.projects = projects;
  const day = (at: number) => new Date(at).toLocaleDateString("sv");
  const ordered = () => Object.entries(projects).sort((a, b) => b[1].last - a[1].last);
  function cap() {
    for (const [name] of ordered().slice(MAX)) delete projects[name];
  }
  const save = () => deps.store.save(ledger);
  return {
    seeded: () => ledger.seeded,
    get: (team) => projects[team] ?? null,
    rename(from, to) {
      const entry = projects[from];
      if (!entry || !to || from === to || projects[to]) return false;
      projects[to] = entry;
      delete projects[from];
      save();
      return true;
    },
    seed(teams) {
      if (ledger.seeded) return;
      const at = now();
      for (const { name, first, daysSeen } of teams) {
        if (!name) continue;
        const before = projects[name];
        projects[name] = {
          first: Math.min(first, before?.first ?? first),
          last: at,
          days: Math.max(daysSeen, before?.days ?? 0),
          lastDay: day(at),
          turns: before?.turns ?? 0,
          pre: true,
          checked: true,
        };
      }
      ledger.seeded = true;
      cap();
      save();
    },
    touch(team, { at = now(), turn }) {
      if (!team) return null;
      const existing = projects[team];
      const p: TenureEntry = existing ?? {
        first: at,
        last: at,
        days: 0,
        lastDay: "",
        turns: 0,
        checked: true,
      };
      const ready = promoteDue(p);
      const back = Boolean(p.farewell);
      if (back) {
        p.back = at;
        p.farewell = 0;
      }
      p.last = Math.max(p.last, at);
      if (day(at) !== p.lastDay) {
        p.days++;
        p.lastDay = day(at);
      }
      if (turn) p.turns++;
      if (!existing) {
        projects[team] = p;
        cap();
      }
      save();
      if (!existing) return "new";
      if (back) return "back";
      return !ready && promoteDue(p) ? "ready" : null;
    },
    markOfficial(team) {
      const p = projects[team];
      if (!p || !promoteDue(p)) return false;
      p.official = now();
      save();
      return true;
    },
    markFarewell(team, live) {
      const p = projects[team],
        at = now();
      if (!p || !farewellDue(p, FAREWELL_DAYS, at, live)) return false;
      p.farewell = at;
      p.back = 0;
      save();
      return true;
    },
    list(live) {
      const at = now();
      return ordered()
        .map(([name, p]) => ({
          name,
          last: p.last,
          days: p.days,
          turns: p.turns,
          due: farewellDue(p, FAREWELL_DAYS, at, live.has(name)),
          farewell: p.farewell ?? 0,
          back: p.back && at - p.back < BACK_SHOWN ? p.back : 0,
          intern: isIntern(p),
          ready: promoteDue(p),
          official: p.official ?? 0,
        }))
        .filter((p) => p.due || p.farewell || p.back || p.intern || p.official)
        .slice(0, 60);
    },
  };
}
