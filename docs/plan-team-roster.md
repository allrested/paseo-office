# Team Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office names workspaces and agents by itself from teams the owner wrote down once in a new **Teams** settings section.

**Architecture:** The roster is three host settings. A pure planner decides which workspace gets which team and which agent gets which teammate; the hub runs it on every directory change and stores each choice as metadata on the workspace or agent, the way it stores sub-agent numbers today. The hub then resolves the shown names from what is stored, so a name is never shown before its write landed. Paseo's own names are never touched.

**Tech Stack:** TypeScript, zod 4, vitest (jsdom for mounted tests), react-native-web, `@getpaseo/plugin` 0.16.2, oxlint, oxfmt.

**Spec:** `docs/design-team-roster.md` (read it first; this plan argues from it).

## Global Constraints

- Work in `/workspace/utils/paseo-office-roster` on branch `feat/team-roster`. Run `npm ci` once before Task 1; the worktree has no `node_modules`.
- Every `git commit` is prefixed with `env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL` (the container's git env is another identity; a local hook refuses it). Never push: the owner is asked first.
- Names are the office's own: no call renames a Paseo workspace or sets a session title.
- Metadata keys, verbatim: `office.roster.team` (workspace), `office.roster.member` (agent). A value is a string id, or a whole number: the edition the holder was passed over at.
- Settings values, verbatim: `rosterOn` (boolean, default `false`), `rosterEdition` (whole number, default `0`), `teams` (list, default `[]`, of `{ id, name, members: [{ id, name }] }`).
- Limits: team name 40 characters (`TEAM_NAME_MAX`), teammate name 60, at most 50 teams and 50 teammates per team. Empty names, two teams with one name, and two teammates with one name in one team are refused.
- Name order for a workspace: hand-typed (`office.team.name`), roster team, workspace name. For an agent: hand-typed (`office.appearance` name), roster teammate, `<parent's office name>-<number>`, session title, `Agent <id8>`.
- The roster off: nothing is planned, nothing is written, every name is today's.
- Touch controls are at least 44 px high. No drag to reorder.
- Match the file's existing comment voice; do not reformat neighbouring code. Run `npm run format` only on files this plan touches.
- After each task: `npm run typecheck && npm run lint` must pass.

## File Structure

- `shared/roster.ts` (new): keys, limits, the zod shape of teams, `Roster`, mark readers, name lookups, `nextEdition`, `shownTeamName`. No server or client imports.
- `shared/settings.ts`: the three values, the refusal, version 7.
- `shared/contracts.ts`: `roster` on `OfficeAgent` and `OfficeWorkspace`, `createdAt` on `OfficeWorkspace`.
- `server/roster.ts` (new): `planRoster` and `rosterNames`, both pure.
- `server/directory.ts`: projects the stored marks and the workspace's creation time.
- `server/subagent-names.ts`: `officeNames` takes the roster's names.
- `server/hub.ts`: `setRoster`, the writes with their in-flight overlay, the shown names.
- `server/live-ports.ts`: `setWorkspaceMetadata`.
- `index.server.ts`: follows the settings; the two `teamNameOf` call sites become roster-aware.
- `client/teams-text.ts` (new): pure list edits and the holder lookup.
- `client/teams-settings.tsx` (new): the Teams section.
- `client/settings-sections.tsx`, `client/host-switches.tsx`, `client/office-settings.tsx`: the fourth section and its props.
- `docs/office.md`, `CHANGELOG.md`.

---

### Task 1: The roster's shape and settings

**Files:**

- Create: `shared/roster.ts`
- Create: `shared/roster.test.ts`
- Modify: `shared/settings.ts` (`HostValuesSchema`, the doc comment above `officeHostSettings`, `version`, the `superRefine` chain)
- Test: `shared/settings.test.ts`

**Interfaces:**

- Consumes: `tidyTeamName`, `storedTeamName`, `TEAM_NAME_MAX` from `shared/team-name.ts`.
- Produces (all from `shared/roster.ts`):
  - `ROSTER_TEAM_KEY = "office.roster.team"`, `ROSTER_MEMBER_KEY = "office.roster.member"`
  - `ROSTER_TEAMS_MAX = 50`, `ROSTER_MEMBERS_MAX = 50`, `MEMBER_NAME_MAX = 60`
  - `interface RosterMember { id: string; name: string }`, `interface RosterTeam { id: string; name: string; members: RosterMember[] }`
  - `interface Roster { on: boolean; edition: number; teams: readonly RosterTeam[] }`, `NO_ROSTER: Roster`
  - `type RosterMark = string | number`
  - `RosterTeamsSchema` (zod), `refuseBadTeams(teams: readonly RosterTeam[], context: z.RefinementCtx): void`
  - `tidyMemberName(name: string): string`
  - `storedRosterMark(value: unknown): RosterMark | undefined`
  - `rosterOf(values: { rosterOn: boolean; rosterEdition: number; teams: readonly RosterTeam[] }): Roster`
  - `teamOf(roster: Roster, mark: RosterMark | undefined): RosterTeam | null`
  - `memberOf(team: RosterTeam | null, mark: RosterMark | undefined): RosterMember | null`
  - `nextEdition(before: Roster, after: { on: boolean; teams: readonly RosterTeam[] }): number`
  - `shownTeamName(workspace: { name: string; metadata?: Readonly<Record<string, unknown>> | null }, roster: Roster): string`

- [ ] **Step 1: Write the failing tests**

Create `shared/roster.test.ts`:

```ts
import { expect, test } from "vitest";
import { z } from "zod";
import {
  NO_ROSTER,
  ROSTER_TEAM_KEY,
  RosterTeamsSchema,
  memberOf,
  nextEdition,
  refuseBadTeams,
  rosterOf,
  shownTeamName,
  storedRosterMark,
  teamOf,
  tidyMemberName,
  type Roster,
  type RosterTeam,
} from "./roster.js";
import { TEAM_NAME_KEY } from "./team-name.js";

const DEV: RosterTeam = {
  id: "t1",
  name: "PR-DEV",
  members: [
    { id: "m1", name: "Tze Jun Tan" },
    { id: "m2", name: "Kharisma Muzaki Ghufron" },
  ],
};
const QA: RosterTeam = { id: "t2", name: "PR-QA", members: [{ id: "m3", name: "Rosalyn" }] };
const ON: Roster = { on: true, edition: 1, teams: [DEV, QA] };

const Checked = RosterTeamsSchema.superRefine(refuseBadTeams);

test("a stored mark is an id or a whole edition, else nothing", () => {
  expect(storedRosterMark("t1")).toBe("t1");
  expect(storedRosterMark(0)).toBe(0);
  expect(storedRosterMark(3)).toBe(3);
  expect(storedRosterMark("")).toBeUndefined();
  expect(storedRosterMark(-1)).toBeUndefined();
  expect(storedRosterMark(1.5)).toBeUndefined();
  expect(storedRosterMark(false)).toBeUndefined();
  expect(storedRosterMark(null)).toBeUndefined();
});

test("a team and a teammate are found by id, and only while the roster is on", () => {
  expect(teamOf(ON, "t2")).toBe(QA);
  expect(teamOf(ON, "gone")).toBeNull();
  expect(teamOf(ON, 1)).toBeNull();
  expect(teamOf(ON, undefined)).toBeNull();
  expect(teamOf({ ...ON, on: false }, "t2")).toBeNull();
  expect(memberOf(DEV, "m2")?.name).toBe("Kharisma Muzaki Ghufron");
  expect(memberOf(DEV, "m3")).toBeNull();
  expect(memberOf(null, "m1")).toBeNull();
});

test("the settings' three values read as one roster", () => {
  expect(rosterOf({ rosterOn: true, rosterEdition: 4, teams: [DEV] })).toEqual({
    on: true,
    edition: 4,
    teams: [DEV],
  });
  expect(NO_ROSTER).toEqual({ on: false, edition: 0, teams: [] });
});

test("names are tidied to one line and their length", () => {
  expect(tidyMemberName("  Tze   Jun\nTan ")).toBe("Tze Jun Tan");
  expect(tidyMemberName("x".repeat(80))).toHaveLength(60);
  const parsed = Checked.parse([
    { id: "t1", name: "  PR-DEV  ", members: [{ id: "m1", name: " TJ " }] },
  ]);
  expect(parsed).toEqual([{ id: "t1", name: "PR-DEV", members: [{ id: "m1", name: "TJ" }] }]);
});

test("an empty name, a name twice and an id twice are refused", () => {
  const messages = (teams: unknown) => {
    const result = Checked.safeParse(teams);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  expect(messages([{ id: "t1", name: " ", members: [] }])).not.toEqual([]);
  expect(messages([{ id: "t1", name: "A", members: [{ id: "m1", name: "" }] }])).not.toEqual([]);
  expect(
    messages([
      { id: "t1", name: "A", members: [] },
      { id: "t2", name: "a", members: [] },
    ]),
  ).toEqual(['teams: "a" is there twice']);
  expect(
    messages([
      {
        id: "t1",
        name: "A",
        members: [
          { id: "m1", name: "TJ" },
          { id: "m2", name: "tj" },
        ],
      },
    ]),
  ).toEqual(['teams: "tj" is twice in A']);
  expect(
    messages([
      { id: "t1", name: "A", members: [{ id: "m1", name: "TJ" }] },
      { id: "t2", name: "B", members: [{ id: "m1", name: "Zaki" }] },
    ]),
  ).toEqual(["teams: an id is there twice"]);
  expect(messages([DEV, QA])).toEqual([]);
});

test("too many teams or teammates are refused", () => {
  const many = Array.from({ length: 51 }, (_, index) => ({
    id: `t${index}`,
    name: `Team ${index}`,
    members: [],
  }));
  expect(z.object({ teams: RosterTeamsSchema }).safeParse({ teams: many }).success).toBe(false);
});

test("the edition goes up when a team or a teammate is added or the roster is switched on", () => {
  const before: Roster = { on: true, edition: 2, teams: [DEV] };
  expect(nextEdition(before, { on: true, teams: [DEV] })).toBe(2);
  expect(nextEdition(before, { on: true, teams: [DEV, QA] })).toBe(3);
  expect(
    nextEdition(before, {
      on: true,
      teams: [{ ...DEV, members: [...DEV.members, { id: "m9", name: "Shashwat Gupta" }] }],
    }),
  ).toBe(3);
  // A rename, a removal and a new order hand nothing new out.
  expect(nextEdition(before, { on: true, teams: [{ ...DEV, name: "DEV" }] })).toBe(2);
  expect(nextEdition(before, { on: true, teams: [] })).toBe(2);
  expect(nextEdition({ ...before, on: false }, { on: true, teams: [DEV] })).toBe(3);
  expect(nextEdition(before, { on: false, teams: [DEV, QA] })).toBe(3);
});

test("a team goes by its hand-typed name, then the roster's, then the workspace's", () => {
  const plain = { name: "paseo-7f3a", metadata: {} };
  const rostered = { name: "paseo-7f3a", metadata: { [ROSTER_TEAM_KEY]: "t1" } };
  const typed = {
    name: "paseo-7f3a",
    metadata: { [ROSTER_TEAM_KEY]: "t1", [TEAM_NAME_KEY]: "Payments" },
  };
  expect(shownTeamName(plain, ON)).toBe("paseo-7f3a");
  expect(shownTeamName(rostered, ON)).toBe("PR-DEV");
  expect(shownTeamName(typed, ON)).toBe("Payments");
  expect(shownTeamName(rostered, { ...ON, on: false })).toBe("paseo-7f3a");
  expect(shownTeamName({ name: "x", metadata: { [ROSTER_TEAM_KEY]: 1 } }, ON)).toBe("x");
});
```

Add to `shared/settings.test.ts` (keep its existing imports; add `officeHostSettings` if it is not imported there yet):

```ts
test("the roster is off and empty until the owner writes it, and a bad team is refused", () => {
  const defaults = officeHostSettings.schema.parse({});
  expect(defaults.rosterOn).toBe(false);
  expect(defaults.rosterEdition).toBe(0);
  expect(defaults.teams).toEqual([]);
  const twice = officeHostSettings.schema.safeParse({
    teams: [
      { id: "t1", name: "PR-DEV", members: [] },
      { id: "t2", name: "PR-DEV", members: [] },
    ],
  });
  expect(twice.success).toBe(false);
  expect(officeHostSettings.version).toBe(7);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run shared/roster.test.ts shared/settings.test.ts`
Expected: FAIL, `shared/roster.test.ts` cannot resolve `./roster.js`; the settings test fails on `rosterOn`.

- [ ] **Step 3: Write `shared/roster.ts`**

```ts
import { z } from "zod";
import { TEAM_NAME_MAX, storedTeamName, tidyTeamName } from "./team-name.js";

/** On a workspace: the roster team it holds, by id, or the edition it was passed over at. */
export const ROSTER_TEAM_KEY = "office.roster.team";
/** On an agent: the roster teammate it holds, by id, or the edition it was passed over at. */
export const ROSTER_MEMBER_KEY = "office.roster.member";
export const ROSTER_TEAMS_MAX = 50;
export const ROSTER_MEMBERS_MAX = 50;
export const MEMBER_NAME_MAX = 60;
const ID_MAX = 40;

/** A teammate name as it is kept: one line, trimmed, at most MEMBER_NAME_MAX characters. */
export function tidyMemberName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MEMBER_NAME_MAX);
}

const id = z.string().min(1).max(ID_MAX);
const RosterMemberSchema = z.object({
  id,
  name: z.string().transform(tidyMemberName).pipe(z.string().min(1)),
});
const RosterTeamSchema = z.object({
  id,
  name: z.string().transform(tidyTeamName).pipe(z.string().min(1).max(TEAM_NAME_MAX)),
  members: z.array(RosterMemberSchema).max(ROSTER_MEMBERS_MAX).default([]),
});
export const RosterTeamsSchema = z.array(RosterTeamSchema).max(ROSTER_TEAMS_MAX).default([]);
export type RosterTeam = z.output<typeof RosterTeamSchema>;
export type RosterMember = z.output<typeof RosterMemberSchema>;

/** A name is the same name whatever its capitals: nobody tells "TJ" from "tj" on the floor. */
const same = (name: string) => name.toLowerCase();

/** Two teams of one name, two teammates of one name in a team, and an id used twice. */
export function refuseBadTeams(teams: readonly RosterTeam[], context: z.RefinementCtx): void {
  const refuse = (message: string) =>
    context.addIssue({ code: "custom", path: ["teams"], message: `teams: ${message}` });
  const ids = new Set<string>();
  const names = new Set<string>();
  let idTwice = false;
  for (const team of teams) {
    if (names.has(same(team.name))) refuse(`"${team.name}" is there twice`);
    names.add(same(team.name));
    idTwice ||= ids.has(team.id);
    ids.add(team.id);
    const members = new Set<string>();
    for (const member of team.members) {
      if (members.has(same(member.name))) refuse(`"${member.name}" is twice in ${team.name}`);
      members.add(same(member.name));
      idTwice ||= ids.has(member.id);
      ids.add(member.id);
    }
  }
  if (idTwice) refuse("an id is there twice");
}

/** The roster as the server and the planner read it. */
export interface Roster {
  on: boolean;
  /** Raised when the roster grows or is switched on: what was passed over before is looked at again. */
  edition: number;
  teams: readonly RosterTeam[];
}
export const NO_ROSTER: Roster = { on: false, edition: 0, teams: [] };

export function rosterOf(values: {
  rosterOn: boolean;
  rosterEdition: number;
  teams: readonly RosterTeam[];
}): Roster {
  return { on: values.rosterOn, edition: values.rosterEdition, teams: values.teams };
}

/** What is stored on a workspace or an agent: an id, or the edition it was passed over at. */
export type RosterMark = string | number;

export function storedRosterMark(value: unknown): RosterMark | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The team a mark names; null for a passed-over mark, a deleted team and a roster that is off. */
export function teamOf(roster: Roster, mark: RosterMark | undefined): RosterTeam | null {
  if (!roster.on || typeof mark !== "string") return null;
  return roster.teams.find((team) => team.id === mark) ?? null;
}

/** The teammate of `team` a mark names; null for a passed-over mark and a deleted teammate. */
export function memberOf(
  team: RosterTeam | null,
  mark: RosterMark | undefined,
): RosterMember | null {
  if (team === null || typeof mark !== "string") return null;
  return team.members.find((member) => member.id === mark) ?? null;
}

function idsOf(teams: readonly RosterTeam[]): Set<string> {
  return new Set(teams.flatMap((team) => [team.id, ...team.members.map((member) => member.id)]));
}

/**
 * The edition a save carries: one more when it adds a team or a teammate or switches the roster
 * on, else the same. A rename, a removal and a new order hand nothing new out.
 */
export function nextEdition(
  before: Roster,
  after: { on: boolean; teams: readonly RosterTeam[] },
): number {
  const known = idsOf(before.teams);
  const grew = [...idsOf(after.teams)].some((entry) => !known.has(entry));
  const switchedOn = after.on && !before.on;
  return grew || switchedOn ? before.edition + 1 : before.edition;
}

/** The name a workspace's team goes by: the hand-typed one, else the roster's, else its own. */
export function shownTeamName(
  workspace: { name: string; metadata?: Readonly<Record<string, unknown>> | null },
  roster: Roster,
): string {
  return (
    storedTeamName(workspace.metadata) ??
    teamOf(roster, storedRosterMark(workspace.metadata?.[ROSTER_TEAM_KEY]))?.name ??
    workspace.name
  );
}
```

- [ ] **Step 4: Add the three values to `shared/settings.ts`**

Add the import beside the other shared imports:

```ts
import { RosterTeamsSchema, refuseBadTeams } from "./roster.js";
```

In `HostValuesSchema`, after the `stickyNotes` line:

```ts
  rosterOn: z.boolean().default(false),
  rosterEdition: z.number().int().nonnegative().default(0),
  teams: RosterTeamsSchema,
```

In `officeHostSettings`: `version: 7`, and one more link in the chain after `.superRefine(refuseBadDays)`:

```ts
    .superRefine(({ teams }, context) => refuseBadTeams(teams, context))
```

In the doc comment above `officeHostSettings`, before the sentence that starts `` `jiraProjects` ``, add:

```
 * `rosterOn` has the office name teams and agents from `teams`, each a team with its teammates
 * in the order they are handed out; `rosterEdition` goes up when that list grows or is switched
 * on, so what was passed over is looked at again.
```

In the comment above `migrate`, append: `Version 7 adds the roster, off and empty.` Leave `migrate` as it is: the three values take their defaults.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run shared/roster.test.ts shared/settings.test.ts client/host-switches.mounted.test.tsx`
Expected: the two shared files PASS. If `host-switches.mounted.test.tsx` fails to compile because its `stored` literal lacks the new keys, add `rosterOn: false, rosterEdition: 0, teams: [],` to that literal after `stickyNotes: "",` and run again. Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `npm run typecheck && npm run lint && npx oxfmt shared/roster.ts shared/roster.test.ts shared/settings.ts shared/settings.test.ts`
Expected: no errors.

```bash
git add shared/roster.ts shared/roster.test.ts shared/settings.ts shared/settings.test.ts client/host-switches.mounted.test.tsx
env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  git commit -m "feat: the settings hold a roster of teams and their teammates"
```

---

### Task 2: The planner

**Files:**

- Create: `server/roster.ts`
- Create: `server/roster.test.ts`

**Interfaces:**

- Consumes from `shared/roster.ts`: `Roster`, `RosterMark`, `RosterTeam`, `teamOf`, `memberOf`.
- Produces (from `server/roster.ts`):
  - `interface RosterWorkspace { id: string; createdAt?: string; roster?: RosterMark }`
  - `interface RosterAgent { id: string; workspaceId: string | null; createdAt: string; roster?: RosterMark }`
  - `interface RosterWrite { kind: "workspace" | "agent"; id: string; mark: RosterMark }`
  - `planRoster(roster: Roster, workspaces: readonly RosterWorkspace[], agents: readonly RosterAgent[]): RosterWrite[]`
  - `rosterNames(roster: Roster, workspaces: readonly RosterWorkspace[], agents: readonly RosterAgent[]): { teams: Map<string, string>; members: Map<string, string> }` (workspace id to team name, agent id to teammate name)

- [ ] **Step 1: Write the failing tests**

Create `server/roster.test.ts`:

```ts
import { expect, test } from "vitest";
import type { Roster, RosterMark } from "../shared/roster.js";
import {
  planRoster,
  rosterNames,
  type RosterAgent,
  type RosterWorkspace,
  type RosterWrite,
} from "./roster.js";

const ROSTER: Roster = {
  on: true,
  edition: 1,
  teams: [
    {
      id: "dev",
      name: "PR-DEV",
      members: [
        { id: "tj", name: "Tze Jun Tan" },
        { id: "zaki", name: "Kharisma Muzaki Ghufron" },
        { id: "shashwat", name: "Shashwat Gupta" },
        { id: "taufik", name: "Taufik Suryaman" },
      ],
    },
    {
      id: "qa",
      name: "PR-QA",
      members: [
        { id: "rosalyn", name: "Rosalyn" },
        { id: "qx", name: "QX" },
      ],
    },
  ],
};

const at = (minute: number) => `2026-11-23T08:${String(minute).padStart(2, "0")}:00.000Z`;
const ws = (id: string, minute: number, roster?: RosterMark): RosterWorkspace => ({
  id,
  createdAt: at(minute),
  ...(roster === undefined ? {} : { roster }),
});
const agent = (
  id: string,
  workspaceId: string | null,
  minute: number,
  roster?: RosterMark,
): RosterAgent => ({
  id,
  workspaceId,
  createdAt: at(minute),
  ...(roster === undefined ? {} : { roster }),
});
const team = (id: string, mark: RosterMark): RosterWrite => ({ kind: "workspace", id, mark });
const member = (id: string, mark: RosterMark): RosterWrite => ({ kind: "agent", id, mark });

/** The view once every planned write is stored. */
function stored(
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
  writes: readonly RosterWrite[],
): { workspaces: RosterWorkspace[]; agents: RosterAgent[] } {
  const marks = new Map(writes.map((write) => [`${write.kind}:${write.id}`, write.mark]));
  return {
    workspaces: workspaces.map((entry) => ({
      ...entry,
      roster: marks.get(`workspace:${entry.id}`) ?? entry.roster,
    })),
    agents: agents.map((entry) => ({
      ...entry,
      roster: marks.get(`agent:${entry.id}`) ?? entry.roster,
    })),
  };
}

test("the first workspace is PR-DEV and its agents take the teammates in order", () => {
  const workspaces = [ws("w1", 0)];
  const agents = [agent("a1", "w1", 1), agent("a2", "w1", 2)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    team("w1", "dev"),
    member("a1", "tj"),
    member("a2", "zaki"),
  ]);
});

test("a later agent takes the next teammate, and the fifth is passed over", () => {
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, "zaki"),
    agent("a3", "w1", 3),
    agent("a4", "w1", 4),
    agent("a5", "w1", 5),
  ];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    member("a3", "shashwat"),
    member("a4", "taufik"),
    member("a5", 1),
  ]);
});

test("the second workspace is PR-QA and the third is passed over with its agents untouched", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1), ws("w3", 2)];
  const agents = [agent("b1", "w2", 3), agent("c1", "w3", 4)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    team("w2", "qa"),
    team("w3", 1),
    member("b1", "rosalyn"),
  ]);
});

test("workspaces are served oldest first whatever order they are listed in", () => {
  const workspaces = [ws("young", 9), ws("old", 1)];
  expect(planRoster(ROSTER, workspaces, [])).toEqual([team("old", "dev"), team("young", "qa")]);
});

test("a workspace without a creation time goes by its oldest agent, then by id", () => {
  const workspaces: RosterWorkspace[] = [{ id: "wb" }, { id: "wa" }, { id: "wc" }];
  const agents = [agent("x", "wc", 1), agent("y", "wa", 5), agent("z", "wa", 3)];
  // wc's oldest agent is the oldest; wa's is next; wb has none and comes last.
  expect(
    planRoster(ROSTER, workspaces, agents).filter((write) => write.kind === "workspace"),
  ).toEqual([team("wc", "dev"), team("wa", "qa"), team("wb", 1)]);
});

test("a teammate freed by an archive goes to the next new agent, not to one passed over", () => {
  // a2 (zaki) was archived: it is no longer listed. a5 was passed over at this edition.
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a3", "w1", 3, "shashwat"),
    agent("a4", "w1", 4, "taufik"),
    agent("a5", "w1", 5, 1),
  ];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([]);
  expect(planRoster(ROSTER, workspaces, [...agents, agent("a6", "w1", 6)])).toEqual([
    member("a6", "zaki"),
  ]);
});

test("a team freed by an archive goes to the next new workspace, not to one passed over", () => {
  // w1 (PR-DEV) was archived. w3 was passed over at this edition.
  const workspaces = [ws("w2", 1, "qa"), ws("w3", 2, 1)];
  expect(planRoster(ROSTER, workspaces, [])).toEqual([]);
  expect(planRoster(ROSTER, [...workspaces, ws("w4", 3)], [])).toEqual([team("w4", "dev")]);
});

test("a longer roster reaches what was passed over, oldest first", () => {
  const grown: Roster = {
    on: true,
    edition: 2,
    teams: [...ROSTER.teams, { id: "ops", name: "PR-OPS", members: [{ id: "ali", name: "Ali" }] }],
  };
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, "qa"), ws("w3", 2, 1), ws("w4", 3, 1)];
  const agents = [agent("c1", "w3", 4), agent("c2", "w3", 5)];
  expect(planRoster(grown, workspaces, agents)).toEqual([
    team("w3", "ops"),
    team("w4", 2),
    member("c1", "ali"),
    member("c2", 2),
  ]);
});

test("switching on with no team marks everything, and the first team then reaches it", () => {
  const empty: Roster = { on: true, edition: 1, teams: [] };
  const workspaces = [ws("w1", 0)];
  const agents = [agent("a1", "w1", 1)];
  const first = planRoster(empty, workspaces, agents);
  expect(first).toEqual([team("w1", 1)]);
  const after = stored(workspaces, agents, first);
  const withTeam: Roster = { on: true, edition: 2, teams: [ROSTER.teams[0]] };
  expect(planRoster(withTeam, after.workspaces, after.agents)).toEqual([
    team("w1", "dev"),
    member("a1", "tj"),
  ]);
});

test("a deleted team or teammate gives its holder no other", () => {
  const workspaces = [ws("w1", 0, "gone-team"), ws("w2", 1, "dev")];
  const agents = [agent("a1", "w2", 2, "gone-member"), agent("a2", "w2", 3)];
  // w1 is not offered PR-QA; a1 is not offered a teammate; a2 is new and takes the first.
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([member("a2", "tj")]);
});

test("a teammate of another team reads as passed over", () => {
  const workspaces = [ws("w2", 1, "qa")];
  const agents = [agent("moved", "w2", 2, "tj"), agent("b1", "w2", 3)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([member("b1", "rosalyn")]);
});

test("an agent without a workspace and a roster that is off are left alone", () => {
  expect(planRoster(ROSTER, [], [agent("lobby", null, 1)])).toEqual([]);
  expect(planRoster({ ...ROSTER, on: false }, [ws("w1", 0)], [agent("a1", "w1", 1)])).toEqual([]);
});

test("planning what was just planned plans nothing more", () => {
  const workspaces = [ws("w1", 0), ws("w2", 1), ws("w3", 2)];
  const agents = [agent("a1", "w1", 3), agent("b1", "w2", 4), agent("c1", "w3", 5)];
  const after = stored(workspaces, agents, planRoster(ROSTER, workspaces, agents));
  expect(planRoster(ROSTER, after.workspaces, after.agents)).toEqual([]);
});

test("the names are those of what is stored", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, 1), ws("w3", 2, "gone")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, 1),
    agent("a3", "w1", 3, "rosalyn"),
    agent("b1", "w2", 4, "tj"),
    agent("new", "w1", 5),
  ];
  const names = rosterNames(ROSTER, workspaces, agents);
  expect([...names.teams]).toEqual([["w1", "PR-DEV"]]);
  expect([...names.members]).toEqual([["a1", "Tze Jun Tan"]]);
  const off = rosterNames({ ...ROSTER, on: false }, workspaces, agents);
  expect(off.teams.size + off.members.size).toBe(0);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run server/roster.test.ts`
Expected: FAIL, cannot resolve `./roster.js`.

- [ ] **Step 3: Write `server/roster.ts`**

```ts
import {
  memberOf,
  teamOf,
  type Roster,
  type RosterMark,
  type RosterTeam,
} from "../shared/roster.js";

export interface RosterWorkspace {
  id: string;
  /** Absent on a host that does not say when a workspace was made. */
  createdAt?: string;
  roster?: RosterMark;
}

export interface RosterAgent {
  id: string;
  workspaceId: string | null;
  createdAt: string;
  roster?: RosterMark;
}

export interface RosterWrite {
  kind: "workspace" | "agent";
  id: string;
  mark: RosterMark;
}

/**
 * Not looked at yet: no mark, or passed over at an edition before this one. An id, even of a
 * team or teammate since deleted, is a look that was had: its holder is offered no other.
 */
function open(mark: RosterMark | undefined, edition: number): boolean {
  return mark === undefined || (typeof mark === "number" && mark < edition);
}

function oldestFirst<Entry extends { id: string }>(
  entries: readonly Entry[],
  madeAt: (entry: Entry) => string | undefined,
): Entry[] {
  // No time sorts last: "￿" is after every ISO date.
  const key = (entry: Entry) => madeAt(entry) ?? "￿";
  return [...entries].sort(
    (left, right) => key(left).localeCompare(key(right)) || left.id.localeCompare(right.id),
  );
}

function agentsByWorkspace(agents: readonly RosterAgent[]): Map<string, RosterAgent[]> {
  const byWorkspace = new Map<string, RosterAgent[]>();
  for (const agent of agents) {
    if (agent.workspaceId === null) continue;
    byWorkspace.set(agent.workspaceId, [...(byWorkspace.get(agent.workspaceId) ?? []), agent]);
  }
  return byWorkspace;
}

/**
 * The metadata to write so every workspace and agent the roster can name has a mark. Workspaces
 * not looked at yet, oldest first, take the first team no listed workspace holds; agents of a
 * workspace with a team, oldest first, take its first teammate no listed agent there holds. One
 * the roster has nothing left for gets the edition, so a name freed later goes to a new one and
 * never to it. Every workspace's write comes before any agent's. Nothing when the roster is off.
 */
export function planRoster(
  roster: Roster,
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
): RosterWrite[] {
  if (!roster.on) return [];
  const members = agentsByWorkspace(agents);
  const oldestAgent = (workspace: RosterWorkspace) =>
    oldestFirst(members.get(workspace.id) ?? [], (agent) => agent.createdAt)[0]?.createdAt;
  const ordered = oldestFirst(
    workspaces,
    (workspace) => workspace.createdAt ?? oldestAgent(workspace),
  );
  const writes: RosterWrite[] = [];
  const teams = new Map<string, RosterTeam>();
  const held = new Set<string>();
  for (const workspace of ordered) {
    const team = teamOf(roster, workspace.roster);
    if (team === null) continue;
    teams.set(workspace.id, team);
    held.add(team.id);
  }
  for (const workspace of ordered) {
    if (!open(workspace.roster, roster.edition)) continue;
    const team = roster.teams.find((candidate) => !held.has(candidate.id));
    writes.push({ kind: "workspace", id: workspace.id, mark: team?.id ?? roster.edition });
    if (team === undefined) continue;
    teams.set(workspace.id, team);
    held.add(team.id);
  }
  for (const workspace of ordered) {
    const team = teams.get(workspace.id);
    if (team === undefined) continue;
    const own = oldestFirst(members.get(workspace.id) ?? [], (agent) => agent.createdAt);
    const taken = new Set<string>();
    for (const agent of own) {
      const member = memberOf(team, agent.roster);
      if (member !== null) taken.add(member.id);
    }
    for (const agent of own) {
      if (!open(agent.roster, roster.edition)) continue;
      const member = team.members.find((candidate) => !taken.has(candidate.id));
      writes.push({ kind: "agent", id: agent.id, mark: member?.id ?? roster.edition });
      if (member !== undefined) taken.add(member.id);
    }
  }
  return writes;
}

/** The roster's name for each workspace and agent whose stored mark still names one. */
export function rosterNames(
  roster: Roster,
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
): { teams: Map<string, string>; members: Map<string, string> } {
  const byWorkspace = new Map<string, RosterTeam>();
  const teams = new Map<string, string>();
  for (const workspace of workspaces) {
    const team = teamOf(roster, workspace.roster);
    if (team === null) continue;
    byWorkspace.set(workspace.id, team);
    teams.set(workspace.id, team.name);
  }
  const members = new Map<string, string>();
  for (const agent of agents) {
    if (agent.workspaceId === null) continue;
    const member = memberOf(byWorkspace.get(agent.workspaceId) ?? null, agent.roster);
    if (member !== null) members.set(agent.id, member.name);
  }
  return { teams, members };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/roster.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Check and commit**

Run: `npm run typecheck && npm run lint && npx oxfmt server/roster.ts server/roster.test.ts`

```bash
git add server/roster.ts server/roster.test.ts
env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  git commit -m "feat: a planner hands the roster's teams and teammates out, oldest first"
```

---

### Task 3: The directory carries the marks, and a sub-agent is named after a roster parent

**Files:**

- Modify: `shared/contracts.ts` (`OfficeAgentSchema`, `OfficeWorkspaceSchema`)
- Modify: `server/directory.ts` (`DirectoryWorkspaceInput`, `projectAgent`, `projectWorkspace`)
- Modify: `server/subagent-names.ts` (`officeNames`)
- Test: `server/directory.test.ts`, `server/subagent-names.test.ts`

**Interfaces:**

- Consumes from `shared/roster.ts`: `ROSTER_TEAM_KEY`, `ROSTER_MEMBER_KEY`, `storedRosterMark`, `RosterMark`.
- Produces:
  - `OfficeAgent.roster?: string | number`, `OfficeWorkspace.roster?: string | number`, `OfficeWorkspace.createdAt?: string`. An `OfficeAgent` satisfies `RosterAgent` and an `OfficeWorkspace` satisfies `RosterWorkspace` of Task 2.
  - `officeNames(agents: readonly OfficeAgent[], given?: ReadonlyMap<string, string>): Map<string, string>`: `given` is agent id to roster teammate name. The result holds a name for every agent that has a hand-typed name, a given name, or a number under a shown parent.

- [ ] **Step 1: Write the failing tests**

Add to `server/directory.test.ts`. It has the builders `agentInput(overrides)` and `workspaceInput(overrides)` (a workspace `w1` named `main`). Add the import `import { ROSTER_MEMBER_KEY, ROSTER_TEAM_KEY } from "../shared/roster.js";`.

```ts
test("an agent carries its roster mark, an id or the edition it was passed over at", () => {
  const marked = (mark: unknown) =>
    projectAgent(agentInput({ metadata: { [ROSTER_MEMBER_KEY]: mark } }));
  expect(marked("tj")?.roster).toBe("tj");
  expect(marked(2)?.roster).toBe(2);
  expect(marked(false)).not.toHaveProperty("roster");
  expect(projectAgent(agentInput({}))).not.toHaveProperty("roster");
});

test("a workspace carries its roster mark and when it was made", () => {
  const made = projectWorkspace(
    workspaceInput({
      createdAt: "2026-11-23T08:00:00.000Z",
      metadata: { [ROSTER_TEAM_KEY]: "dev" },
    }),
  );
  expect(made?.roster).toBe("dev");
  expect(made?.createdAt).toBe("2026-11-23T08:00:00.000Z");
  // The name is still the workspace's here: the hub turns the mark into a name.
  expect(made?.name).toBe("main");
  expect(made).not.toHaveProperty("workspaceName");
  const bare = projectWorkspace(workspaceInput({ createdAt: null }));
  expect(bare).not.toHaveProperty("roster");
  expect(bare).not.toHaveProperty("createdAt");
});
```

The file's existing test at line 173 compares a whole projected workspace with `toEqual`; it stays green because `workspaceInput({})` has neither field.

Add to `server/subagent-names.test.ts` (it has `agent(id, title, extra)` already):

```ts
test("a roster name is an agent's office name, under a hand-typed one", () => {
  const lead = agent("lead", "Refactor auth");
  const helper = agent("helper", "Explore", { parent: "lead", number: 1 });
  const named = { ...agent("typed", "Fix"), appearance: { name: "Boss" } };
  const given = new Map([
    ["lead", "Tze Jun Tan"],
    ["typed", "Rosalyn"],
  ]);
  const names = officeNames([lead, helper, named], given);
  expect(names.get("lead")).toBe("Tze Jun Tan");
  // A passed-over sub-agent is named after its parent's roster name.
  expect(names.get("helper")).toBe("Tze Jun Tan-1");
  expect(names.get("typed")).toBe("Boss");
});

test("a sub-agent with a roster name of its own goes by it", () => {
  const lead = agent("lead", "Refactor auth");
  const helper = agent("helper", "Explore", { parent: "lead", number: 1 });
  const names = officeNames([lead, helper], new Map([["helper", "QX"]]));
  expect(names.get("helper")).toBe("QX");
  expect(names.has("lead")).toBe(false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run server/directory.test.ts server/subagent-names.test.ts`
Expected: FAIL: `roster` is undefined on the projections; `officeNames` ignores its second argument.

- [ ] **Step 3: Extend the contracts**

In `shared/contracts.ts`, in `OfficeAgentSchema` after the `next` field:

```ts
  /** The roster teammate it holds, by id, or the edition it was passed over at; absent before either. */
  roster: z.union([z.string(), z.number()]).optional(),
```

In `OfficeWorkspaceSchema` after `workspaceName`:

```ts
  /** The roster team it holds, by id, or the edition it was passed over at; absent before either. */
  roster: z.union([z.string(), z.number()]).optional(),
  /** When it was made; absent on a host that does not say. */
  createdAt: z.string().optional(),
```

- [ ] **Step 4: Project the marks in `server/directory.ts`**

Add the import:

```ts
import { ROSTER_MEMBER_KEY, ROSTER_TEAM_KEY, storedRosterMark } from "../shared/roster.js";
```

In `DirectoryWorkspaceInput`, after `name: string;`:

```ts
  /** When the workspace was made; an older host does not say. */
  createdAt?: string | null;
```

In `projectAgent`, after the `const next = ...` line:

```ts
const roster = storedRosterMark(agent.metadata?.[ROSTER_MEMBER_KEY]);
```

and in its returned object after the `next` spread:

```ts
    ...(roster === undefined ? {} : { roster }),
```

In `projectWorkspace`, after the `const teamName = ...` line:

```ts
const roster = storedRosterMark(workspace.metadata?.[ROSTER_TEAM_KEY]);
```

and in its returned object after the `workspaceName` spread:

```ts
    ...(roster === undefined ? {} : { roster }),
    ...(workspace.createdAt ? { createdAt: workspace.createdAt } : {}),
```

Then confirm what the daemon sends: run
`grep -n "createdAt" node_modules/@getpaseo/protocol/dist/messages.d.ts | head -40` and look for the field inside the workspace descriptor schema. If the descriptor has no `createdAt`, leave the code as written (the optional field stays absent and the planner falls back to the oldest agent) and write that one fact into the commit body.

- [ ] **Step 5: Let `officeNames` take the roster's names**

In `server/subagent-names.ts`, change the signature and the start of `nameOf`:

```ts
/**
 * Each agent's office name, by id: its hand-typed name, else the roster's (`given`), else
 * `<parent's office name>-<number>` for a numbered sub-agent of a shown parent.
 */
export function officeNames(
  agents: readonly OfficeAgent[],
  given: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const names = new Map<string, string>();
  const nameOf = (agent: OfficeAgent, seen: Set<string>): string | null => {
    const own = agent.appearance?.name ?? given.get(agent.id);
    if (own) {
      names.set(agent.id, own);
      return own;
    }
```

The rest of `nameOf` and the function stay as they are. Replace the old one-line doc comment above the function with the one shown.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/directory.test.ts server/subagent-names.test.ts server/hub.test.ts`
Expected: PASS (the hub's tests still pass: `given` defaults to none).

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint && npx oxfmt shared/contracts.ts server/directory.ts server/directory.test.ts server/subagent-names.ts server/subagent-names.test.ts`

```bash
git add shared/contracts.ts server/directory.ts server/directory.test.ts server/subagent-names.ts server/subagent-names.test.ts
env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  git commit -m "feat: the directory carries roster marks, and a sub-agent is named after a roster parent"
```

---

### Task 4: The hub hands names out and shows them

**Files:**

- Modify: `server/hub.ts` (`HubPorts`, `Hub`, `createHub`: beside `writeNumbers`, `named`, `onDirectory`)
- Modify: `server/live-ports.ts` (`liveHubPorts`)
- Modify: `index.server.ts` (`followSettings`, the `teamRenameRpc` handler near line 811, the `agent.turn.after` hook near line 951)
- Test: `server/hub.test.ts`, `index.server.test.ts`

**Interfaces:**

- Consumes: `planRoster`, `rosterNames`, `RosterWrite` (Task 2); `officeNames(agents, given)` and the `roster`/`createdAt` fields (Task 3); `NO_ROSTER`, `Roster`, `RosterMark`, `ROSTER_TEAM_KEY`, `ROSTER_MEMBER_KEY`, `rosterOf`, `shownTeamName` (Task 1); `sortWorkspaces` from `server/directory.ts`.
- Produces:
  - `HubPorts.setAgentMetadata?(agentId: string, patch: Record<string, string | number>): Promise<void>` (widened from `number`)
  - `HubPorts.setWorkspaceMetadata?(workspaceId: string, patch: Record<string, string | number>): Promise<void>`
  - `Hub.setRoster(roster: Roster): void`

- [ ] **Step 1: Write the failing hub tests**

Add to `server/hub.test.ts`. It has `agent(id, status)`, `startHarness(initial, extraPorts)`, `subscribe(hub)`, `settle` and `DIRECTORY_FLUSH_MS` already. Add these imports: `import { ROSTER_MEMBER_KEY, ROSTER_TEAM_KEY, type Roster } from "../shared/roster.js";` and `OfficeWorkspace` to the type import from `../shared/contracts.js`.

```ts
const ROSTER: Roster = {
  on: true,
  edition: 1,
  teams: [
    {
      id: "dev",
      name: "PR-DEV",
      members: [
        { id: "tj", name: "Tze Jun Tan" },
        { id: "zaki", name: "Kharisma Muzaki Ghufron" },
      ],
    },
  ],
};

function room(id: string, extra: Partial<OfficeWorkspace> = {}): OfficeWorkspace {
  return { id, name: id, projectName: "shop", createdAt: "2026-11-23T08:00:00.000Z", ...extra };
}

function member(id: string, minute: number, extra: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    ...agent(id, "idle"),
    workspaceId: "w1",
    createdAt: `2026-11-23T08:0${minute}:00.000Z`,
    ...extra,
  };
}

interface RosterWrites {
  workspaces: [string, Record<string, string | number>][];
  agents: [string, Record<string, string | number>][];
}

function rosterPorts(writes: RosterWrites): Partial<HubPorts> {
  return {
    setWorkspaceMetadata: async (id, patch) => {
      writes.workspaces.push([id, patch]);
    },
    setAgentMetadata: async (id, patch) => {
      writes.agents.push([id, patch]);
    },
  };
}

/** The agents and workspaces a subscriber holds after its events: a snapshot, then each list as it changed. */
function lastView(events: OfficeEvent[]): { agents: OfficeAgent[]; workspaces: OfficeWorkspace[] } {
  let agents: OfficeAgent[] = [];
  let workspaces: OfficeWorkspace[] = [];
  for (const event of events) {
    if (event.type === "snapshot") ({ agents, workspaces } = event.state);
    if (event.type === "agents") agents = event.agents;
    if (event.type === "workspaces") workspaces = event.workspaces;
  }
  return { agents, workspaces };
}

test("the roster's team and teammates are stored once, the workspace first", async () => {
  const writes: RosterWrites = { workspaces: [], agents: [] };
  const view = { agents: [member("a1", 1), member("a2", 2)], workspaces: [room("w1")] };
  const { hub, directory } = startHarness(view, rosterPorts(writes));
  hub.setRoster(ROSTER);
  const watcher = subscribe(hub);
  await settle();
  expect(writes.workspaces).toEqual([["w1", { [ROSTER_TEAM_KEY]: "dev" }]]);
  expect(writes.agents).toEqual([
    ["a1", { [ROSTER_MEMBER_KEY]: "tj" }],
    ["a2", { [ROSTER_MEMBER_KEY]: "zaki" }],
  ]);
  // The same view again, the echoes not yet back: nothing is sent twice.
  directory.emit(view);
  await settle();
  expect(writes.workspaces).toHaveLength(1);
  expect(writes.agents).toHaveLength(2);
  watcher.controller.abort();
  await watcher.done;
});

test("a name shows once its mark is stored, and never before", async () => {
  const writes: RosterWrites = { workspaces: [], agents: [] };
  const { hub, directory, clock } = startHarness(
    { agents: [member("a1", 1)], workspaces: [room("w1")] },
    rosterPorts(writes),
  );
  hub.setRoster(ROSTER);
  const watcher = subscribe(hub);
  await settle();
  const before = lastView(watcher.events);
  expect(before.workspaces[0].name).toBe("w1");
  expect(before.agents[0].name).toBeUndefined();
  directory.emit({
    agents: [member("a1", 1, { roster: "tj" })],
    workspaces: [room("w1", { roster: "dev" })],
  });
  clock.advance(DIRECTORY_FLUSH_MS);
  await settle();
  const after = lastView(watcher.events);
  expect(after.workspaces[0]).toMatchObject({ name: "PR-DEV", workspaceName: "w1" });
  expect(after.agents[0].name).toBe("Tze Jun Tan");
  watcher.controller.abort();
  await watcher.done;
});

test("a hand-typed team name stays over the roster's, and the roster off shows today's names", async () => {
  const stored = {
    agents: [member("a1", 1, { roster: "tj" })],
    workspaces: [room("w1", { roster: "dev", name: "Payments", workspaceName: "w1" })],
  };
  const { hub, clock } = startHarness(stored, rosterPorts({ workspaces: [], agents: [] }));
  hub.setRoster(ROSTER);
  const watcher = subscribe(hub);
  await settle();
  expect(lastView(watcher.events).workspaces[0]).toMatchObject({
    name: "Payments",
    workspaceName: "w1",
  });
  expect(lastView(watcher.events).agents[0].name).toBe("Tze Jun Tan");
  hub.setRoster({ ...ROSTER, on: false });
  // The change goes out with the next flush, as a directory change does.
  clock.advance(DIRECTORY_FLUSH_MS);
  await settle();
  expect(lastView(watcher.events).agents[0].name).toBeUndefined();
  watcher.controller.abort();
  await watcher.done;
});

test("a roster set while the office is open is planned at once", async () => {
  const writes: RosterWrites = { workspaces: [], agents: [] };
  const { hub } = startHarness(
    { agents: [member("a1", 1)], workspaces: [room("w1")] },
    rosterPorts(writes),
  );
  const watcher = subscribe(hub);
  await settle();
  expect(writes.workspaces).toEqual([]);
  hub.setRoster(ROSTER);
  await settle();
  expect(writes.workspaces).toEqual([["w1", { [ROSTER_TEAM_KEY]: "dev" }]]);
  watcher.controller.abort();
  await watcher.done;
});

test("a roster write that fails is planned again at the next change", async () => {
  const writes: RosterWrites = { workspaces: [], agents: [] };
  let fail = true;
  const view = { agents: [], workspaces: [room("w1")] };
  const { hub, directory } = startHarness(view, {
    setWorkspaceMetadata: async (id, patch) => {
      if (fail) throw new Error("offline");
      writes.workspaces.push([id, patch]);
    },
    setAgentMetadata: async () => undefined,
  });
  hub.setRoster(ROSTER);
  const watcher = subscribe(hub);
  await settle();
  expect(writes.workspaces).toEqual([]);
  fail = false;
  directory.emit(view);
  await settle();
  expect(writes.workspaces).toEqual([["w1", { [ROSTER_TEAM_KEY]: "dev" }]]);
  watcher.controller.abort();
  await watcher.done;
});
```

`clock.advance(ms)` and `settle()` are from `server/fake-clock.ts`; the flush-window test at line 221 of this file uses them the same way. The hub pushes a changed list as an `agents` or a `workspaces` event, once per flush window.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run server/hub.test.ts`
Expected: FAIL: `hub.setRoster is not a function`; `setWorkspaceMetadata` is not a known port.

- [ ] **Step 3: Extend the hub**

In `server/hub.ts`:

Imports: change `import { settleResets } from "./directory.js";` to `import { settleResets, sortWorkspaces } from "./directory.js";` and add

```ts
import {
  NO_ROSTER,
  ROSTER_MEMBER_KEY,
  ROSTER_TEAM_KEY,
  type Roster,
  type RosterMark,
} from "../shared/roster.js";
import { planRoster, rosterNames, type RosterWrite } from "./roster.js";
```

In `HubPorts`, replace the `setAgentMetadata` line with:

```ts
  setAgentMetadata?(agentId: string, patch: Record<string, string | number>): Promise<void>;
  /** Stores the office's own data on a workspace: its roster team. */
  setWorkspaceMetadata?(
    workspaceId: string,
    patch: Record<string, string | number>,
  ): Promise<void>;
```

In `interface Hub`, after `setBrand`:

```ts
  /** The roster names follow from now on; what is open is planned and named again at once. */
  setRoster(roster: Roster): void;
```

In `writeNumbers`, the `send` helper's `patch` parameter stays `Record<string, number>` (a number record is a `Record<string, string | number>`), so nothing else changes there.

Below `writeNumbers`, add:

```ts
let roster: Roster = NO_ROSTER;
// Marks sent and not yet reported back, by `workspace:<id>` or `agent:<id>`. They are planned
// as if stored, so a team or teammate in flight is never handed out twice; names come from
// what the directory reports, so none shows before its mark is stored.
const pendingRoster = new Map<string, RosterMark>();

function withPendingRoster<Entry extends { id: string; roster?: RosterMark }>(
  kind: RosterWrite["kind"],
  entries: readonly Entry[],
): Entry[] {
  return entries.map((entry) => {
    const key = `${kind}:${entry.id}`;
    const mark = pendingRoster.get(key);
    if (mark === undefined) return entry;
    if (entry.roster === mark) {
      pendingRoster.delete(key);
      return entry;
    }
    return { ...entry, roster: mark };
  });
}

function writeRoster(next: DirectoryView): void {
  const toWorkspace = ports.setWorkspaceMetadata;
  const toAgent = ports.setAgentMetadata;
  if (toWorkspace === undefined || toAgent === undefined) return;
  const planned = planRoster(
    roster,
    withPendingRoster("workspace", next.workspaces),
    withPendingRoster("agent", next.agents),
  );
  for (const { kind, id, mark } of planned) {
    const key = `${kind}:${id}`;
    pendingRoster.set(key, mark);
    const sent =
      kind === "workspace"
        ? toWorkspace(id, { [ROSTER_TEAM_KEY]: mark })
        : toAgent(id, { [ROSTER_MEMBER_KEY]: mark });
    sent.catch((error: unknown) => {
      // Planned again at the next change.
      pendingRoster.delete(key);
      ports.log(`[office] roster mark failed: ${errorMessage(error)}`);
    });
  }
}

/** The workspaces under their roster team's name, where the owner typed none. */
function teamed(
  workspaces: readonly OfficeWorkspace[],
  teams: ReadonlyMap<string, string>,
): readonly OfficeWorkspace[] {
  if (teams.size === 0) return workspaces;
  return sortWorkspaces(
    workspaces.map((workspace) => {
      const team = teams.get(workspace.id);
      // A workspaceName says the owner typed a team name: it stays.
      if (team === undefined || workspace.workspaceName !== undefined) return workspace;
      return { ...workspace, name: team, workspaceName: workspace.name };
    }),
  );
}
```

Change `named` to take the roster's names:

```ts
function named(agents: readonly OfficeAgent[], given: ReadonlyMap<string, string>): OfficeAgent[] {
  const names = officeNames(agents, given);
  return agents.map((agent) => {
    const name = names.get(agent.id);
    return name === undefined ? agent : { ...agent, name };
  });
}
```

In `onDirectory`, after `writeNumbers(next.agents);` add `writeRoster(next);`, and replace the `view = { ... }` assignment with:

```ts
const names = rosterNames(roster, next.workspaces, next.agents);
view = {
  agents: named(resets.size === 0 ? next.agents : settled.agents, names.members),
  workspaces: teamed(next.workspaces, names.teams),
  folders: next.folders,
};
```

In the returned hub object, after `setBrand`:

```ts
    setRoster(next) {
      if (JSON.stringify(roster) === JSON.stringify(next)) return;
      roster = next;
      // What is open is planned and named again. A closed office is planned when it next opens:
      // its directory's first view goes through onDirectory.
      if (stopDirectory !== null) onDirectory(reported);
    },
```

`reported` (line 134) starts as `EMPTY_VIEW` and holds the directory's last view; `stopDirectory` (line 159) is null while the office is closed.

- [ ] **Step 4: Run the hub tests**

Run: `npx vitest run server/hub.test.ts`
Expected: PASS, the five new tests and every earlier one.

- [ ] **Step 5: Add the workspace port**

In `server/live-ports.ts`, in the object `liveHubPorts` returns, after `setAgentMetadata`:

```ts
    setWorkspaceMetadata: (workspaceId, patch) =>
      holder.require().workspaces.ref(workspaceId).setMetadata(patch),
```

`workspaces.ref(id).setMetadata` is the call `index.server.ts` already makes for `TEAM_NAME_KEY`. If `setMetadata` does not resolve to `Promise<void>`, append `.then(() => undefined)`.

- [ ] **Step 6: Write the failing server test**

In `index.server.test.ts`, after the test "a team is given a name of the office's own, kept on its workspace, and an empty one takes it back" (line 1123), add:

```ts
test("a team whose typed name is cleared goes back to its roster name", async () => {
  if (ON.status !== "ready") throw new Error("ON is the ready state");
  const rostered: SettingsState = {
    ...ON,
    values: {
      ...ON.values,
      rosterOn: true,
      rosterEdition: 1,
      teams: [{ id: "dev", name: "PR-DEV", members: [] }],
    },
  };
  const { recorded, directory, context, stop } = setup(async () => rostered);
  // The server follows the settings it read at its start.
  for (const listener of recorded.listeners) await listener(rostered);
  directory.workspaceMetadata = { "office.roster.team": "dev", "office.team.name": "Payments" };
  const rename = recorded.handlers.get("office.team.rename.request");
  expect(await rename?.({ workspaceId: "w1", name: "" }, context)).toEqual({
    ok: true,
    name: "PR-DEV",
  });
  expect(directory.workspaceMetadata).toEqual({
    "office.roster.team": "dev",
    "office.team.name": null,
  });
  await stop();
});
```

`ON`, `setup`, `recorded.listeners` and `directory.workspaceMetadata` are this file's own (lines 68, 419, 39 and 200). End the test the way the test above it ends: if that one does not call `stop()`, or calls it differently, do as it does. If the `ON`, `OFF` and `NOTES` literals fail to type-check after Task 1 (they list every host value), add `rosterOn: false, rosterEdition: 0, teams: [],` to each `values`.

Run: `npx vitest run index.server.test.ts -t "roster name"`
Expected: FAIL: the answer's name is `api`, the workspace's own.

- [ ] **Step 7: Follow the settings in `index.server.ts`**

Imports: change line 66 to `import { TEAM_NAME_KEY, tidyTeamName } from "./shared/team-name.js";` and add
`import { NO_ROSTER, rosterOf, shownTeamName, type Roster } from "./shared/roster.js";`

Beside the other values `followSettings` keeps (`agentToolsOn`, `stepsNamed`, `pinnedNotes`), declare:

```ts
// The roster the names follow; off until the settings are read.
let roster: Roster = NO_ROSTER;
```

In `followSettings`, after `hub.setBrand(...)`:

```ts
roster = rosterOf(state.values);
hub.setRoster(roster);
```

In the `teamRenameRpc` handler, replace the two lines that compute `shown` and call `renamed` with:

```ts
// Cleared, the team goes by its roster name where it has one, else by the workspace's.
const shown = shownTeamName(
  { name: current.name, metadata: { ...current.metadata, [TEAM_NAME_KEY]: next } },
  roster,
);
// The directory's next view would carry the tenure over too; a restart before it would not.
(await lifeReady)?.renamed(shownTeamName(current, roster), shown);
```

(`storedTeamName` reads an empty string as no name, so `next === ""` needs no special case here.)

In the `agent.turn.after` hook, replace `return workspace ? teamNameOf(workspace) : null;` with `return workspace ? shownTeamName(workspace, roster) : null;`.

`teamNameOf` in `shared/team-name.ts` is now unused by the server; leave the function (and its tests) in place.

- [ ] **Step 8: Run the server tests**

Run: `npx vitest run index.server.test.ts server/hub.test.ts server/life-feed.test.ts`
Expected: PASS.

- [ ] **Step 9: Check and commit**

Run: `npm run typecheck && npm run lint && npx oxfmt server/hub.ts server/hub.test.ts server/live-ports.ts index.server.ts index.server.test.ts`

```bash
git add server/hub.ts server/hub.test.ts server/live-ports.ts index.server.ts index.server.test.ts
env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  git commit -m "feat: the office names workspaces and agents from the roster"
```

---

### Task 5: The Teams section

**Files:**

- Create: `client/teams-text.ts`, `client/teams-text.test.ts`
- Create: `client/teams-settings.tsx`, `client/teams-settings.mounted.test.tsx`
- Modify: `client/settings-sections.tsx` (`sections`, `icons`, `SettingsSections` props and `pages`)
- Modify: `client/host-switches.tsx` (`HostSetting`, `HostSwitchesProps`, the `SettingsSections` call)
- Modify: `client/office-settings.tsx` (`OfficeSettingsFields`)

**Interfaces:**

- Consumes: `RosterTeam`, `Roster`, `RosterMark`, `nextEdition`, `rosterOf`, `tidyMemberName`, `MEMBER_NAME_MAX`, `ROSTER_TEAMS_MAX`, `ROSTER_MEMBERS_MAX` (Task 1); `tidyTeamName`, `TEAM_NAME_MAX`; `OfficeAgent.roster`, `OfficeWorkspace.roster`, `OfficeWorkspace.workspaceName` (Task 3); `HostValues` and the `change(setting, patch): Promise<boolean>` and `saveProblem(setting): string | null` callbacks of `client/host-switches.tsx`.
- Produces:
  - `client/teams-text.ts`: `newId(prefix: "t" | "m"): string`, `addTeam(teams, id): RosterTeam[]`, `addMember(teams, teamId, id): RosterTeam[]`, `renameTeam(teams, teamId, name): RosterTeam[]`, `renameMember(teams, teamId, memberId, name): RosterTeam[]`, `removeTeam(teams, teamId): RosterTeam[]`, `removeMember(teams, teamId, memberId): RosterTeam[]`, `moved<Entry>(list: readonly Entry[], index: number, by: -1 | 1): Entry[]`, `interface RosterHolders { teams: ReadonlyMap<string, string>; members: ReadonlySet<string> }`, `holdersOf(workspaces, agents): RosterHolders`, `TEAMS_LABEL = "Teams"`.
  - `client/teams-settings.tsx`: `TeamsSettings(props: { values: HostValues | null; change(setting: "Teams", patch: Partial<HostValues>): Promise<boolean>; problem: string | null; holders: RosterHolders; styles: OfficeStyles })`.
  - `HostSwitchesProps.rosterHolders?: RosterHolders`.

- [ ] **Step 1: Write the failing text tests**

Create `client/teams-text.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import type { RosterTeam } from "../shared/roster.js";
import {
  addMember,
  addTeam,
  holdersOf,
  moved,
  newId,
  removeMember,
  removeTeam,
  renameMember,
  renameTeam,
} from "./teams-text.js";

const TEAMS: RosterTeam[] = [
  {
    id: "t1",
    name: "PR-DEV",
    members: [
      { id: "m1", name: "TJ" },
      { id: "m2", name: "Zaki" },
    ],
  },
  { id: "t2", name: "PR-QA", members: [] },
];

test("a new team and a new teammate start with a numbered name nobody has", () => {
  expect(addTeam(TEAMS, "t3").at(-1)).toEqual({ id: "t3", name: "Team 3", members: [] });
  expect(addTeam([{ id: "t9", name: "Team 2", members: [] }], "t3").at(-1)?.name).toBe("Team 3");
  expect(addMember(TEAMS, "t1", "m3")[0].members.at(-1)).toEqual({ id: "m3", name: "Teammate 3" });
  expect(addMember(TEAMS, "t2", "m3")[1].members).toEqual([{ id: "m3", name: "Teammate 1" }]);
});

test("a rename keeps the id and tidies the name; an empty one changes nothing", () => {
  expect(renameTeam(TEAMS, "t2", "  PR  QA ")[1]).toEqual({ id: "t2", name: "PR QA", members: [] });
  expect(renameTeam(TEAMS, "t2", "  ")).toEqual(TEAMS);
  expect(renameMember(TEAMS, "t1", "m2", "Kharisma")[0].members[1]).toEqual({
    id: "m2",
    name: "Kharisma",
  });
  expect(renameMember(TEAMS, "t1", "m2", "")).toEqual(TEAMS);
});

test("a removal takes one team or one teammate", () => {
  expect(removeTeam(TEAMS, "t1").map((team) => team.id)).toEqual(["t2"]);
  expect(removeMember(TEAMS, "t1", "m1")[0].members.map((member) => member.id)).toEqual(["m2"]);
});

test("a move swaps with the neighbour and stops at the ends", () => {
  expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
});

test("ids are short and differ", () => {
  const first = newId("t");
  expect(first).toMatch(/^t[a-z0-9]{6,12}$/);
  expect(newId("t")).not.toBe(first);
});

test("the holders are the workspaces and agents whose mark is an id", () => {
  const workspaces = [
    { id: "w1", name: "PR-DEV", workspaceName: "paseo-7f3a", roster: "t1" },
    { id: "w2", name: "Payments", workspaceName: "paseo-91bc", roster: "t2" },
    { id: "w3", name: "paseo-aa", roster: 1 },
  ] as OfficeWorkspace[];
  const agents = [
    { id: "a1", roster: "m1" },
    { id: "a2", roster: 1 },
    { id: "a3" },
  ] as OfficeAgent[];
  const holders = holdersOf(workspaces, agents);
  // The workspace's own name in Paseo, whatever the team is shown as.
  expect([...holders.teams]).toEqual([
    ["t1", "paseo-7f3a"],
    ["t2", "paseo-91bc"],
  ]);
  expect([...holders.members]).toEqual(["m1"]);
});
```

Run: `npx vitest run client/teams-text.test.ts`
Expected: FAIL, cannot resolve `./teams-text.js`.

- [ ] **Step 2: Write `client/teams-text.ts`**

```ts
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import { tidyMemberName, type RosterTeam } from "../shared/roster.js";
import { tidyTeamName } from "../shared/team-name.js";

/** The Teams section's setting, as its failure is reported. */
export const TEAMS_LABEL = "Teams";

/** An id for a new team ("t") or teammate ("m"): never shown, only stored. */
export function newId(prefix: "t" | "m"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}

/** `<word> <n>` for the first n from `from` that no name in `taken` has. */
function freeName(word: string, from: number, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  let number = from;
  while (lower.has(`${word} ${number}`.toLowerCase())) number += 1;
  return `${word} ${number}`;
}

export function addTeam(teams: readonly RosterTeam[], id: string): RosterTeam[] {
  const name = freeName(
    "Team",
    teams.length + 1,
    teams.map((team) => team.name),
  );
  return [...teams, { id, name, members: [] }];
}

function inTeam(
  teams: readonly RosterTeam[],
  teamId: string,
  change: (team: RosterTeam) => RosterTeam,
): RosterTeam[] {
  return teams.map((team) => (team.id === teamId ? change(team) : team));
}

export function addMember(teams: readonly RosterTeam[], teamId: string, id: string): RosterTeam[] {
  return inTeam(teams, teamId, (team) => ({
    ...team,
    members: [
      ...team.members,
      {
        id,
        name: freeName(
          "Teammate",
          team.members.length + 1,
          team.members.map((member) => member.name),
        ),
      },
    ],
  }));
}

/** An empty name changes nothing: the roster has no nameless team. */
export function renameTeam(teams: readonly RosterTeam[], teamId: string, name: string) {
  const next = tidyTeamName(name);
  return next === "" ? [...teams] : inTeam(teams, teamId, (team) => ({ ...team, name: next }));
}

export function renameMember(
  teams: readonly RosterTeam[],
  teamId: string,
  memberId: string,
  name: string,
): RosterTeam[] {
  const next = tidyMemberName(name);
  if (next === "") return [...teams];
  return inTeam(teams, teamId, (team) => ({
    ...team,
    members: team.members.map((member) =>
      member.id === memberId ? { ...member, name: next } : member,
    ),
  }));
}

export function removeTeam(teams: readonly RosterTeam[], teamId: string): RosterTeam[] {
  return teams.filter((team) => team.id !== teamId);
}

export function removeMember(
  teams: readonly RosterTeam[],
  teamId: string,
  memberId: string,
): RosterTeam[] {
  return inTeam(teams, teamId, (team) => ({
    ...team,
    members: team.members.filter((member) => member.id !== memberId),
  }));
}

/** The list with the entry at `index` one place up (-1) or down (1); unchanged at an end. */
export function moved<Entry>(list: readonly Entry[], index: number, by: -1 | 1): Entry[] {
  const to = index + by;
  const next = [...list];
  if (to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Who holds what: each held team's workspace, by its own name in Paseo, and the held teammates. */
export interface RosterHolders {
  teams: ReadonlyMap<string, string>;
  members: ReadonlySet<string>;
}

export const NO_HOLDERS: RosterHolders = { teams: new Map(), members: new Set() };

export function holdersOf(
  workspaces: readonly OfficeWorkspace[],
  agents: readonly OfficeAgent[],
): RosterHolders {
  const teams = new Map<string, string>();
  for (const workspace of workspaces)
    if (typeof workspace.roster === "string")
      teams.set(workspace.roster, workspace.workspaceName ?? workspace.name);
  const members = new Set<string>();
  for (const agent of agents) if (typeof agent.roster === "string") members.add(agent.roster);
  return { teams, members };
}
```

Run: `npx vitest run client/teams-text.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 3: Write the failing mounted test**

Create `client/teams-settings.mounted.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// The Teams section, mounted. Its saves go through the header's `change`, so a stand-in records
// each patch and answers as the host would.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { officeHostSettings } from "../shared/settings.js";
import type { HostValues } from "./host-switches.js";
import { useOfficeStyles } from "./styles.js";
import { TeamsSettings } from "./teams-settings.js";
import type { RosterHolders } from "./teams-text.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  return { TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const DEFAULTS: HostValues = officeHostSettings.schema.parse({});

let values: HostValues;
let patches: Partial<HostValues>[];
let problem: string | null;
let holders: RosterHolders;
let container: HTMLElement;
let root: Root;

function Harness() {
  const styles = useOfficeStyles(THEME, true, true);
  return (
    <TeamsSettings
      values={values}
      // As the host: the patch is checked, kept when valid, and the section drawn again.
      change={async (_setting, patch) => {
        patches.push(patch);
        const checked = officeHostSettings.schema.safeParse({ ...values, ...patch });
        if (!checked.success) {
          problem = checked.error.issues.map((issue) => issue.message).join("\n");
          return false;
        }
        values = checked.data;
        problem = null;
        return true;
      }}
      problem={problem}
      holders={holders}
      styles={styles}
    />
  );
}

const mount = () => act(async () => root.render(<Harness />));

beforeEach(() => {
  values = { ...DEFAULTS };
  patches = [];
  problem = null;
  holders = { teams: new Map(), members: new Set() };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function byLabel<Found extends HTMLElement>(label: string): Found {
  const found = container.querySelector<Found>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await mount();
}

async function type(label: string, text: string): Promise<void> {
  const input = byLabel<HTMLInputElement>(label);
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await mount();
}

test("the switch turns the roster on and raises the edition", async () => {
  await mount();
  const roster = byLabel("Name teams and agents from the roster");
  expect(roster.getAttribute("aria-checked")).toBe("false");
  await press("Name teams and agents from the roster");
  expect(patches).toEqual([{ rosterOn: true, rosterEdition: 1, teams: [] }]);
  await press("Name teams and agents from the roster");
  expect(patches.at(-1)).toEqual({ rosterOn: false, rosterEdition: 1, teams: [] });
});

test("a team and its teammates are added, renamed, moved and removed", async () => {
  values = { ...DEFAULTS, rosterOn: true, rosterEdition: 1 };
  await mount();
  await press("Add team");
  expect(values.teams.map((team) => team.name)).toEqual(["Team 1"]);
  expect(values.rosterEdition).toBe(2);
  await type("Team 1 name", "PR-DEV");
  expect(values.teams[0].name).toBe("PR-DEV");
  // A rename hands nothing new out.
  expect(values.rosterEdition).toBe(2);
  await press("Add teammate to PR-DEV");
  await type("PR-DEV teammate 1", "Tze Jun Tan");
  await press("Add teammate to PR-DEV");
  await type("PR-DEV teammate 2", "Kharisma Muzaki Ghufron");
  expect(values.teams[0].members.map((member) => member.name)).toEqual([
    "Tze Jun Tan",
    "Kharisma Muzaki Ghufron",
  ]);
  expect(values.rosterEdition).toBe(4);
  await press("Move Kharisma Muzaki Ghufron up");
  expect(values.teams[0].members.map((member) => member.name)).toEqual([
    "Kharisma Muzaki Ghufron",
    "Tze Jun Tan",
  ]);
  await press("Remove Tze Jun Tan");
  expect(values.teams[0].members.map((member) => member.name)).toEqual(["Kharisma Muzaki Ghufron"]);
  await press("Add team");
  await press("Move Team 2 up");
  expect(values.teams.map((team) => team.name)).toEqual(["Team 2", "PR-DEV"]);
  await press("Remove team Team 2");
  expect(values.teams.map((team) => team.name)).toEqual(["PR-DEV"]);
});

test("a name the settings refuse is reported and not kept", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [
      { id: "t1", name: "PR-DEV", members: [] },
      { id: "t2", name: "PR-QA", members: [] },
    ],
  };
  await mount();
  await type("PR-QA name", "pr-dev");
  expect(values.teams[1].name).toBe("PR-QA");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '"pr-dev" is there twice',
  );
  expect(byLabel<HTMLInputElement>("PR-QA name").value).toBe("PR-QA");
});

test("a held team says which workspace has it, and a held teammate is marked", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [
      {
        id: "t1",
        name: "PR-DEV",
        members: [
          { id: "m1", name: "TJ" },
          { id: "m2", name: "Zaki" },
        ],
      },
    ],
  };
  holders = { teams: new Map([["t1", "paseo-7f3a"]]), members: new Set(["m1"]) };
  await mount();
  expect(container.textContent).toContain("Workspace paseo-7f3a");
  expect(byLabel("TJ, at a desk")).toBeTruthy();
  expect(container.querySelector('[aria-label="Zaki, at a desk"]')).toBeNull();
});

test("nothing can be changed while the settings are read", async () => {
  await act(async () =>
    root.render(
      <TeamsSettings
        values={null}
        change={async () => false}
        problem={null}
        holders={holders}
        styles={useStylesOnce()}
      />,
    ),
  );
  expect(container.querySelector('[aria-label="Add team"]')).toBeNull();
});

// A hook cannot be called in a test body: this renders once to read the styles.
function useStylesOnce() {
  let styles!: ReturnType<typeof useOfficeStyles>;
  function Probe() {
    styles = useOfficeStyles(THEME, true, true);
    return null;
  }
  const holder = document.createElement("div");
  const probe = createRoot(holder);
  act(() => probe.render(<Probe />));
  act(() => probe.unmount());
  return styles;
}
```

Run: `npx vitest run client/teams-settings.mounted.test.tsx`
Expected: FAIL, cannot resolve `./teams-settings.js`.

- [ ] **Step 4: Write `client/teams-settings.tsx`**

Before writing, read `client/setting-field.tsx` (the commit-on-blur pattern this file copies), `client/labeled-switch.tsx` (its props) and the keys of `OfficeStyles` used below in `client/styles.ts` (`headerField`, `sheetLabel`, `fieldHint`, `actionError`, `workspaceAction`, `sidebarButtonText`, and the text-input style `SettingField` passes to its `TextInput`). Use the same input style `SettingField` uses; where a key named below does not exist, use the one `SettingField` or `TeamName` (`client/team-name.tsx`) uses for the same purpose.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  MEMBER_NAME_MAX,
  ROSTER_MEMBERS_MAX,
  ROSTER_TEAMS_MAX,
  nextEdition,
  rosterOf,
  type RosterTeam,
} from "../shared/roster.js";
import { TEAM_NAME_MAX } from "../shared/team-name.js";
import type { HostValues } from "./host-switches.js";
import { LabeledSwitch } from "./labeled-switch.js";
import type { OfficeStyles } from "./styles.js";
import {
  TEAMS_LABEL,
  addMember,
  addTeam,
  moved,
  newId,
  removeMember,
  removeTeam,
  renameMember,
  renameTeam,
  type RosterHolders,
} from "./teams-text.js";

const SWITCH_LABEL = "Name teams and agents from the roster";
const INTRO =
  "Each workspace takes the first free team, oldest first, and each agent in it the first free " +
  "teammate. Paseo's own names stay. A name you type on a team or an agent wins.";

const layout = StyleSheet.create({
  team: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  field: { flex: 1, minWidth: 0 },
  // A touch target, whatever the label's length.
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

interface TeamsSettingsProps {
  /** Null while the settings are read or cannot be read: nothing can then be changed. */
  values: HostValues | null;
  /** Resolves false when the host refuses the save; never rejects. */
  change(setting: typeof TEAMS_LABEL, patch: Partial<HostValues>): Promise<boolean>;
  problem: string | null;
  holders: RosterHolders;
  styles: OfficeStyles;
}

/**
 * The roster: a switch, then each team with its teammates in the order they are handed out.
 * Every change is one save of the whole list, with the edition a longer list or the switch
 * going on calls for.
 */
export function TeamsSettings({ values, change, problem, holders, styles }: TeamsSettingsProps) {
  const save = useCallback(
    (on: boolean, teams: RosterTeam[]) => {
      if (values === null) return Promise.resolve(false);
      const rosterEdition = nextEdition(rosterOf(values), { on, teams });
      return change(TEAMS_LABEL, { rosterOn: on, rosterEdition, teams });
    },
    [change, values],
  );
  const on = values?.rosterOn ?? false;
  const teams = values?.teams ?? [];
  const toggle = useCallback((next: boolean) => void save(next, teams), [save, teams]);
  const edit = useCallback((next: RosterTeam[]) => save(on, next), [save, on]);
  const appendTeam = useCallback(() => void edit(addTeam(teams, newId("t"))), [edit, teams]);
  return (
    <View style={styles.headerFields}>
      <LabeledSwitch
        label={SWITCH_LABEL}
        value={values === null ? null : on}
        onChange={toggle}
        styles={styles}
      />
      <Text style={styles.fieldHint}>{INTRO}</Text>
      {teams.map((team, index) => (
        <TeamBlock
          key={team.id}
          team={team}
          index={index}
          teams={teams}
          edit={edit}
          holders={holders}
          styles={styles}
        />
      ))}
      {values !== null && teams.length < ROSTER_TEAMS_MAX && (
        <TextButton label="Add team" text="Add team" onPress={appendTeam} styles={styles} />
      )}
      {problem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}

interface TeamBlockProps {
  team: RosterTeam;
  index: number;
  teams: RosterTeam[];
  edit(next: RosterTeam[]): Promise<boolean>;
  holders: RosterHolders;
  styles: OfficeStyles;
}

function TeamBlock({ team, index, teams, edit, holders, styles }: TeamBlockProps) {
  const rename = useCallback(
    (name: string) => edit(renameTeam(teams, team.id, name)),
    [edit, teams, team.id],
  );
  const up = useCallback(() => void edit(moved(teams, index, -1)), [edit, teams, index]);
  const down = useCallback(() => void edit(moved(teams, index, 1)), [edit, teams, index]);
  const remove = useCallback(() => void edit(removeTeam(teams, team.id)), [edit, teams, team.id]);
  const append = useCallback(
    () => void edit(addMember(teams, team.id, newId("m"))),
    [edit, teams, team.id],
  );
  const workspace = holders.teams.get(team.id);
  return (
    <View
      style={StyleSheet.compose(layout.team, {
        borderTopColor: styles.sidebarButton.borderColor,
      })}
    >
      <View style={layout.row}>
        <NameField
          label={`${team.name} name`}
          value={team.name}
          max={TEAM_NAME_MAX}
          onSave={rename}
          styles={styles}
        />
        <TextButton label={`Move ${team.name} up`} text="Up" onPress={up} styles={styles} />
        <TextButton label={`Move ${team.name} down`} text="Down" onPress={down} styles={styles} />
        <TextButton
          label={`Remove team ${team.name}`}
          text="Remove"
          onPress={remove}
          styles={styles}
        />
      </View>
      <Text style={styles.fieldHint}>
        {workspace === undefined ? "No workspace has this team" : `Workspace ${workspace}`}
      </Text>
      {team.members.map((member, at) => (
        <MemberRow
          key={member.id}
          team={team}
          at={at}
          teams={teams}
          edit={edit}
          held={holders.members.has(member.id)}
          styles={styles}
        />
      ))}
      {team.members.length < ROSTER_MEMBERS_MAX && (
        <TextButton
          label={`Add teammate to ${team.name}`}
          text="Add teammate"
          onPress={append}
          styles={styles}
        />
      )}
    </View>
  );
}

interface MemberRowProps {
  team: RosterTeam;
  at: number;
  teams: RosterTeam[];
  edit(next: RosterTeam[]): Promise<boolean>;
  held: boolean;
  styles: OfficeStyles;
}

function MemberRow({ team, at, teams, edit, held, styles }: MemberRowProps) {
  const member = team.members[at];
  const within = useCallback(
    (members: RosterTeam["members"]) =>
      edit(teams.map((entry) => (entry.id === team.id ? { ...entry, members } : entry))),
    [edit, teams, team.id],
  );
  const rename = useCallback(
    (name: string) => edit(renameMember(teams, team.id, member.id, name)),
    [edit, teams, team.id, member.id],
  );
  const up = useCallback(() => void within(moved(team.members, at, -1)), [within, team, at]);
  const down = useCallback(() => void within(moved(team.members, at, 1)), [within, team, at]);
  const remove = useCallback(
    () => void edit(removeMember(teams, team.id, member.id)),
    [edit, teams, team.id, member.id],
  );
  return (
    <View style={layout.row}>
      {held && (
        <View
          accessibilityLabel={`${member.name}, at a desk`}
          style={StyleSheet.compose(layout.dot, { backgroundColor: styles.workspaceAccent })}
        />
      )}
      <NameField
        label={`${team.name} teammate ${at + 1}`}
        value={member.name}
        max={MEMBER_NAME_MAX}
        onSave={rename}
        styles={styles}
      />
      <TextButton label={`Move ${member.name} up`} text="Up" onPress={up} styles={styles} />
      <TextButton label={`Move ${member.name} down`} text="Down" onPress={down} styles={styles} />
      <TextButton label={`Remove ${member.name}`} text="Remove" onPress={remove} styles={styles} />
    </View>
  );
}

interface NameFieldProps {
  label: string;
  value: string;
  max: number;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: string): Promise<boolean>;
  styles: OfficeStyles;
}

/** A name that saves when it is submitted or loses focus, as SettingField does; a refused or empty one goes back. */
function NameField({ label, value, max, onSave, styles }: NameFieldProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [draft, setDraft] = useState<string | null>(null);
  // A submit blurs the field too: one save, not a second.
  const saving = useRef(false);
  const commit = useCallback(() => {
    if (draft === null || saving.current) return;
    const next = draft.trim();
    if (next === "" || next === value) {
      setDraft(null);
      return;
    }
    saving.current = true;
    void onSave(next).finally(() => {
      saving.current = false;
      if (mounted.current) setDraft(null);
    });
  }, [draft, value, onSave]);
  return (
    <View style={layout.field}>
      <TextInput
        accessibilityLabel={label}
        value={draft ?? value}
        maxLength={max}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
    </View>
  );
}

interface TextButtonProps {
  label: string;
  text: string;
  onPress(): void;
  styles: OfficeStyles;
}

function TextButton({ label, text, onPress, styles }: TextButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={StyleSheet.compose(styles.workspaceAction, layout.button)}
    >
      <Text style={styles.sidebarButtonText}>{text}</Text>
    </Pressable>
  );
}
```

`styles.fieldInput` stands for the input style `SettingField` passes to its `TextInput`: use that exact key. `styles.workspaceAccent` and `styles.sidebarButton.borderColor` are used the same way in `client/settings-sections.tsx`.

The test's `type` helper fires `input` then `focusout`; react-native-web's `TextInput` maps these to `onChangeText` and `onBlur`. If the mounted test's field helper in `client/host-switches.mounted.test.tsx` types and blurs differently (read its helpers below line 175), copy its two helpers into the new test in place of `type`.

- [ ] **Step 5: Run the mounted test**

Run: `npx vitest run client/teams-settings.mounted.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Add the fourth section**

In `client/settings-sections.tsx`:

```ts
const sections = ["Appearance", "Teams", "Automation", "Services"] as const;
type Section = (typeof sections)[number];
const icons = {
  Appearance: "Palette",
  Teams: "UsersRound",
  Automation: "CalendarClock",
  Services: "Plug",
};
```

Add `teams: ReactNode;` to the props of `SettingsSections` (and to its destructuring) after `appearance`, and to `pages`: `const pages = { Appearance: appearance, Teams: teams, Automation: automation, Services: services };`.

Teams sits second: it is about who is on the floor, next to how the floor looks. With four tabs at 390 px each is about 90 px wide; `settingsLayout.tab` already wraps its label, so no style changes.

In `client/host-switches.tsx`:

- add `| "Teams"` to the `HostSetting` union;
- add to `HostSwitchesProps`: `/** Who holds which team and teammate, for the Teams section; none until the office has loaded. */ rosterHolders?: RosterHolders;` and to the destructured props `rosterHolders = NO_HOLDERS`;
- import `TeamsSettings` from `./teams-settings.js` and `NO_HOLDERS, TEAMS_LABEL, type RosterHolders` from `./teams-text.js`;
- pass the section to `SettingsSections`, after `appearance={...}`:

```tsx
      teams={
        <TeamsSettings
          values={stored}
          change={change}
          problem={saveProblem(TEAMS_LABEL)}
          holders={rosterHolders}
          styles={styles}
        />
      }
```

In `client/office-settings.tsx`, in `OfficeSettingsFields`, add above the `return`:

```tsx
const rosterHolders = useMemo(
  () => holdersOf(office.state.workspaces, office.state.agents),
  [office.state.workspaces, office.state.agents],
);
```

pass `rosterHolders={rosterHolders}` to `HostSwitches`, and import `holdersOf` from `./teams-text.js`. Check `office.state` before the office has loaded: if `workspaces` or `agents` can be undefined there (read `client/use-office.ts`), default each to `[]` in the two `holdersOf` arguments.

- [ ] **Step 7: Extend the two mounted tests that count sections**

Run: `npx vitest run client/host-switches.mounted.test.tsx client/office-settings.mounted.test.tsx`
If a test asserts the list of section buttons (search both files for `"Automation"`), add `"Teams"` in second place to its expected list. Add to `client/host-switches.mounted.test.tsx`:

```tsx
test("the Teams section saves the roster with the other host settings", async () => {
  await mount();
  const roster = container.querySelector<HTMLElement>(
    '[aria-label="Name teams and agents from the roster"]',
  );
  if (!roster) throw new Error("The Teams section is not there");
  await act(async () => roster.click());
  expect(saved.at(-1)?.values).toMatchObject({
    rosterOn: true,
    rosterEdition: 1,
    teams: [],
    agentTools: false,
  });
});
```

Expected: PASS.

- [ ] **Step 8: Check and commit**

Run: `npm run typecheck && npm run lint && npx vitest run client && npx oxfmt client/teams-text.ts client/teams-text.test.ts client/teams-settings.tsx client/teams-settings.mounted.test.tsx client/settings-sections.tsx client/host-switches.tsx client/host-switches.mounted.test.tsx client/office-settings.tsx`
Expected: every client test passes.

```bash
git add client/teams-text.ts client/teams-text.test.ts client/teams-settings.tsx client/teams-settings.mounted.test.tsx client/settings-sections.tsx client/host-switches.tsx client/host-switches.mounted.test.tsx client/office-settings.tsx client/office-settings.mounted.test.tsx
env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  git commit -m "feat: a Teams section in the settings writes the roster"
```

---

### Task 6: Docs, the whole suite, and a look on a real daemon

**Files:**

- Modify: `docs/office.md`, `CHANGELOG.md`
- Modify: `docs/design-team-roster.md` (status line only)

**Interfaces:**

- Consumes: everything above. Produces nothing later tasks use.

- [ ] **Step 1: Document it**

In `docs/office.md`, find the part that describes renaming a team (search `Rename team`). After it add a section:

```markdown
## Team roster

Settings > Office 3D > **Teams** holds a roster: teams, each with its teammates, in the order they
are handed out. With "Name teams and agents from the roster" on, the office names by itself:

- each workspace takes the first team no open workspace holds, oldest workspace first;
- each agent in that workspace, sub-agents too, takes the team's first teammate no agent there
  holds, oldest agent first;
- when the roster has nothing left, the workspace or agent keeps the name it has today. A
  sub-agent is then `<parent's name>-<number>`, and the parent's name can be a teammate's.

A name sticks until its workspace or agent is archived. A freed name goes to the next new one;
nothing that already runs is renamed. Adding a team or a teammate, or switching the roster on,
offers the longer list to what was passed over before.

The names are the office's own: Paseo's sidebar, tabs and CLI show the workspace and session
names they always did. A name you type on a team or an agent wins over the roster. Renaming a
team or teammate in the settings renames whoever holds it; removing one leaves its holder with
today's name. Switching the roster off shows today's names everywhere, and on again brings the
same assignments back.

What is stored: `office.roster.team` on a workspace and `office.roster.member` on an agent, each
the id of the team or teammate held, or a number when the roster had nothing left for it.
```

In `CHANGELOG.md`, under the topmost unreleased heading (add `## Unreleased` above the newest version if the file has none), add:

```markdown
- Team roster: a **Teams** section in the settings holds teams and their teammates, and the
  office names workspaces and agents from it by itself. Paseo's own names are not changed.
```

In `docs/design-team-roster.md`, change the status line to `Status: built on branch feat/team-roster; plan in docs/plan-team-roster.md.`

- [ ] **Step 2: Run everything**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:scripts && npm run check:world`
Expected: all pass. If `format:check` names a file this plan did not touch, leave it and say so in the report; if it names one this plan touched, run `npx oxfmt <that file>` and re-run.

- [ ] **Step 3: Commit**

```bash
git add docs/office.md CHANGELOG.md docs/design-team-roster.md
env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL \
  git commit -m "docs: the team roster"
```

- [ ] **Step 4: Look at it on the development daemon**

This step creates workspaces and agents on a daemon, so it needs the owner's yes first; ask, and stop here until it is given. With it:

1. Install this worktree as the `office` plugin on the development daemon (port 6768, its own `PASEO_HOME`; never the live one), following the `paseo-plugin` skill's install-from-folder steps.
2. In a phone-width browser (390 px) open Settings > Office 3D > Teams. Switch the roster on. Add `PR-DEV` with Tze Jun Tan, Kharisma Muzaki Ghufron, Shashwat Gupta, Taufik Suryaman, and `PR-QA` with Rosalyn, QX. Check: four tabs fit, every button is at least 44 px high, nothing scrolls sideways.
3. With one workspace holding two agents open: the office shows the room as PR-DEV and the agents as the first two teammates; Paseo's sidebar still shows the workspace's and sessions' own names.
4. Create a third and a fourth agent, then a fifth: Shashwat Gupta, Taufik Suryaman, then the session's own name.
5. Create a second workspace with one agent (PR-QA, Rosalyn) and a third workspace (its own name).
6. Archive the PR-DEV workspace, create a new one: it is PR-DEV. The third workspace still has its own name.
7. Switch the roster off: every name is Paseo's. On again: the same names as before.
8. Screenshot the Teams section and the floor at steps 3 and 6, in 3D and in the list view.

Report what was seen against each number, with the screenshots. Anything that differs from the spec is a defect to fix before the owner is asked about a push.

---

## Self-review notes

- Spec coverage: rules 1 to 5 and 8 are `planRoster` (Task 2); rule 3's "never shown before stored" and rules 6 and 7 are the hub (Task 4); the name orders are `officeNames`, `teamed` and `shownTeamName` (Tasks 1, 3, 4); editing by id is Tasks 1, 2 and 5; storage is Tasks 1 and 3; the section is Task 5; the spec's tests map to Tasks 1 to 5 and its by-hand check to Task 6.
- One point the spec leaves to the build: a hand-typed agent name keeps the roster teammate underneath. That follows from the planner reading only the mark, never the shown name; the test "the names are those of what is stored" and the hub test with a hand-typed team cover the workspace side, and `officeNames`' first test the agent side.
- Not in this plan: a version bump, a tag, a push, a pull request. Each waits for the owner.
