// How long each team has been in the office, kept in office/tenure.json: when its agents first and
// last worked, on how many calendar days, how many turns they finished. A port of upstream's
// server/tenure.mjs (my-office), with the reading of Claude Code's transcripts left out: a team is
// a workspace, known by its name. A team that worked on two days or more and has been quiet for 30
// days gets its farewell, once; one new to the office is an intern until 20 turns on two days; every
// team present when the ledger first starts is permanent.

import { z } from "zod";

export const FAREWELL_DAYS = 30;
export const PROMOTE_TURNS = 20;
export const PROMOTE_DAYS = 2;
const DAY = 86_400_000;
const MAX = 300;
const LISTED = 60;
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
  /** The ledger as last saved; null when there is none or it cannot be read. */
  load(): TenureLedger | null;
  save(data: TenureLedger): void;
}
export type TenureChange = "new" | "back" | "ready";
export interface Tenure {
  touch(team: string, input: { at?: number; turn?: boolean }): TenureChange | null;
  markFarewell(team: string, live: boolean): boolean;
  markOfficial(team: string): boolean;
  list(live: ReadonlySet<string>): TenureProject[];
  seed(teams: readonly SeedTeam[]): void;
  get(team: string): TenureEntry | null;
  /** True once seed() has run on this ledger, now or on an earlier start. */
  seeded(): boolean;
}

/** A time as the local calendar day, YYYY-MM-DD. */
export const dayOf = (ms: number): string => new Date(ms).toLocaleDateString("sv");
export const wasActive = (p: { days?: number } | undefined): boolean => (p?.days ?? 0) >= 2;
export const farewellDue = (
  p: { days?: number; last?: number; farewell?: number } | undefined,
  days: number,
  now: number,
  live: boolean,
): boolean =>
  p !== undefined &&
  days > 0 &&
  wasActive(p) &&
  !p.farewell &&
  !live &&
  now - (p.last ?? now) >= days * DAY;
export const isIntern = (
  p: { pre?: boolean; official?: number; checked?: boolean } | undefined,
): boolean => p !== undefined && !p.pre && !p.official && p.checked === true;
export const promoteDue = (
  p:
    | { pre?: boolean; official?: number; checked?: boolean; turns?: number; days?: number }
    | undefined,
): boolean => isIntern(p) && (p?.turns ?? 0) >= PROMOTE_TURNS && (p?.days ?? 0) >= PROMOTE_DAYS;

export function createTenure(deps: { store: TenureStore; now?: () => number }): Tenure {
  const now = deps.now ?? Date.now;
  const ledger: TenureLedger = deps.store.load() ?? { v: 1, seeded: false, projects: {} };
  const entry = (team: string): TenureEntry | undefined =>
    Object.hasOwn(ledger.projects, team) ? ledger.projects[team] : undefined;
  const save = () => deps.store.save(ledger);

  // The 300 teams most lately at work: a list that never grows past what anyone has.
  function cap(): void {
    const names = Object.keys(ledger.projects);
    if (names.length <= MAX) return;
    names.sort((a, b) => (entry(b)?.last ?? 0) - (entry(a)?.last ?? 0));
    for (const name of names.slice(MAX)) delete ledger.projects[name];
  }

  function touch(team: string, input: { at?: number; turn?: boolean }): TenureChange | null {
    if (team === "") return null;
    const at = input.at ?? now();
    let p = entry(team);
    let change: TenureChange | null = null;
    if (p === undefined) {
      // A team new to the office is an intern: there are no transcripts to look back on.
      p = { first: at, last: at, days: 0, lastDay: "", turns: 0, checked: true };
      ledger.projects[team] = p;
      change = "new";
      cap();
    }
    const ready = promoteDue(p);
    if (p.farewell) {
      p.back = at;
      p.farewell = 0;
      change = "back";
    }
    const day = dayOf(at);
    if (p.lastDay !== day) {
      p.lastDay = day;
      p.days += 1;
    }
    p.last = Math.max(p.last, at);
    if (input.turn === true) p.turns += 1;
    if (change === null && !ready && promoteDue(p)) change = "ready";
    save();
    return change;
  }

  return {
    touch,
    markFarewell(team, live) {
      const p = entry(team);
      if (p === undefined || !farewellDue(p, FAREWELL_DAYS, now(), live)) return false;
      p.farewell = now();
      p.back = 0;
      save();
      return true;
    },
    markOfficial(team) {
      const p = entry(team);
      if (p === undefined || !promoteDue(p)) return false;
      p.official = now();
      save();
      return true;
    },
    list(live) {
      const at = now();
      const out: TenureProject[] = [];
      for (const [name, p] of Object.entries(ledger.projects)) {
        const due = farewellDue(p, FAREWELL_DAYS, at, live.has(name));
        const back = p.back && at - p.back < BACK_SHOWN ? p.back : 0;
        const intern = isIntern(p);
        if (!due && !p.farewell && !back && !intern && !p.official) continue;
        out.push({
          name,
          last: p.last,
          days: p.days,
          turns: p.turns,
          due,
          farewell: p.farewell ?? 0,
          back,
          intern,
          ready: promoteDue(p),
          official: p.official ?? 0,
        });
      }
      return out.sort((a, b) => b.last - a.last).slice(0, LISTED);
    },
    seed(teams) {
      if (ledger.seeded) return;
      const at = now();
      for (const team of teams) {
        if (team.name === "" || entry(team.name) !== undefined) continue;
        ledger.projects[team.name] = {
          first: team.first,
          last: at,
          days: team.daysSeen,
          lastDay: dayOf(at),
          turns: 0,
          pre: true,
          checked: true,
        };
      }
      ledger.seeded = true;
      cap();
      save();
    },
    get: (team) => entry(team) ?? null,
    seeded: () => ledger.seeded,
  };
}
