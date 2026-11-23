import { expect, test } from "vitest";
import type {
  ActivityStep,
  OfficeAgent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  SkillsResult,
} from "../shared/contracts.js";
import {
  libraryNote,
  librarySummary,
  libraryTeams,
  skillAsk,
  skillWhere,
  topicOf,
  TOPIC_MAX,
  askHint,
  busyLine,
  skillMatches,
  skillTeams,
  unreadLine,
  workspaceSkills,
  type LibraryTeam,
} from "./library-text.js";
import { buildOfficeModel } from "../shared/model.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-16T00:00:01Z",
    ...patch,
  };
}

function workspace(id: string, patch: Partial<OfficeWorkspace> = {}): OfficeWorkspace {
  return { id, name: id, projectName: "shop", ...patch };
}

function post(seq: number, patch: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: "hello",
    author: "user",
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
    ...patch,
  };
}

function office(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  boards: Record<string, Post[]> = {},
  doing: Record<string, ActivityStep> = {},
): OfficeSnapshot {
  return { agents, workspaces, activity: {}, doing, boards, wake: { paused: false, queued: {} } };
}

const SKILLS: SkillsResult = {
  host: [
    { name: "paseo", description: "Runs agents.", folders: [".claude", ".agents"] },
    { name: "brainstorm", description: null, folders: [".claude"] },
  ],
  workspaces: { w1: [{ name: "release", description: "Cuts a beta.", folders: [".claude"] }] },
  readAt: "2026-11-16T10:00:00.000Z",
};

test("every workspace is a team with its skills, who is at a skill now and who can be asked", () => {
  const model = buildOfficeModel(
    office(
      [
        agent("old", { createdAt: "2026-11-16T00:00:01Z" }),
        agent("new", { createdAt: "2026-11-16T05:00:00Z" }),
        agent("busy", { status: "running" }),
        // (its own turn has ended, and it waits on the sub-agent it started: not asked)
        agent("lead", { createdAt: "2026-11-16T06:00:00Z" }),
        agent("sub", {
          parentAgentId: "lead",
          status: "running",
          createdAt: "2026-11-16T07:00:00Z",
        }),
        agent("asking", { permissions: [{ id: "q", kind: "tool", title: "Run?" }] }),
        agent("other", { workspaceId: "w2", status: "running" }),
        agent("lobby", { workspaceId: null }),
      ],
      [workspace("w1", { name: "shop-api" }), workspace("w2", { name: "landing" })],
      {},
      { busy: { kind: "skill", key: "c1" }, other: { kind: "read", key: "c2" } },
    ),
  );

  expect(libraryTeams(model, SKILLS)).toEqual([
    {
      roomId: "w1",
      name: "shop-api (shop)",
      atSkill: ["busy"],
      writers: [
        { agentId: "new", title: "new" },
        { agentId: "old", title: "old" },
      ],
      asked: null,
      skills: [{ name: "release", description: "Cuts a beta.", folders: [".claude"] }],
    },
    // (a workspace the reading has no folder for, and any before the first reading, says null)
    { roomId: "w2", name: "landing (shop)", atSkill: [], writers: [], asked: null, skills: null },
  ]);
  expect(libraryTeams(model, null)[0]?.skills).toBeNull();
});

test("a skill request names the topic on its first line and the folder by the agent's tool", () => {
  expect(skillAsk("  How we cut\na release  ", "claude")).toBe(
    [
      "Skill request: How we cut a release",
      "Write a skill that teaches this, with the steps taken from your work in this workspace. Put it in .claude/skills/<name>/SKILL.md of this workspace. Its front matter has a name, and a description that says when to use it. Change no other file.",
      "Then post one note on this board with the skill's name and what it teaches.",
    ].join("\n"),
  );
  expect(skillAsk("Releases", "codex").split("\n")[1]).toContain(
    "Put it in the folder of this workspace that your tool reads skills from, as <name>/SKILL.md.",
  );
  expect(topicOf("x".repeat(TOPIC_MAX + 20))).toHaveLength(TOPIC_MAX);
});

test("the newest skill request and the asked agent's first note after it are the answer", () => {
  const ask = skillAsk("Releases", "claude");
  const teamsWith = (posts: Post[]) =>
    libraryTeams(
      buildOfficeModel(office([agent("a"), agent("b")], [workspace("w1")], { w1: posts })),
      null,
    )[0]?.asked;

  expect(teamsWith([post(1, { text: ask, to: "b" })])).toEqual({
    agentId: "b",
    title: "b",
    text: null,
    cut: false,
    topic: "Releases",
  });
  expect(
    teamsWith([
      post(1, { text: ask, to: "b" }),
      post(2, { text: "Wrote release-notes: how a beta is cut.", author: "b" }),
      post(3, { text: "A later note.", author: "b" }),
    ]),
  ).toEqual({
    agentId: "b",
    title: "b",
    text: "Wrote release-notes: how a beta is cut.",
    cut: false,
    topic: "Releases",
  });
  // A review request, a note that names nobody and an agent's own note are not skill requests.
  expect(teamsWith([post(1, { text: "Review request: #1 Fix\nhttps://x", to: "a" })])).toBeNull();
  expect(teamsWith([post(1, { text: ask })])).toBeNull();
  expect(teamsWith([post(1, { text: ask, to: "a", author: "b" })])).toBeNull();
  // An agent that left is named so, and a long answer is cut.
  const long = teamsWith([
    post(1, { text: ask, to: "gone" }),
    post(2, { text: "x".repeat(700), author: "gone" }),
  ]);
  expect(long?.title).toBe("An agent that left");
  expect(long?.cut).toBe(true);
  expect(long?.text).toHaveLength(600);
});

test("the strip says who is at a skill now, else invites a skill; an office without a team has none", () => {
  const model = (doing: Record<string, ActivityStep>) =>
    buildOfficeModel(office([agent("a", { status: "running" })], [workspace("w1")], {}, doing));
  expect(libraryNote(libraryTeams(model({ a: { kind: "skill", key: "c" } }), null))).toEqual({
    text: "1 at a skill",
    tone: "muted",
  });
  expect(libraryNote(libraryTeams(model({}), null))).toEqual({
    text: "Teach a skill",
    tone: "muted",
  });
  expect(
    libraryNote(
      libraryTeams(buildOfficeModel(office([agent("a", { workspaceId: null })], [])), null),
    ),
  ).toBeNull();
});

test("the card's first line counts the skills and who is at one", () => {
  const model = buildOfficeModel(
    office(
      [agent("a", { status: "running" })],
      [workspace("w1")],
      {},
      { a: { kind: "skill", key: "c" } },
    ),
  );
  const teams = libraryTeams(model, SKILLS);
  expect(librarySummary(teams, SKILLS)).toBe(
    "2 skills on this host, 1 in the teams' workspaces. a is at a skill now.",
  );
  expect(librarySummary(teams, null)).toBe("Reading the skills on this host.");
  // (a first reading that failed is not still reading: the failure shows under the button)
  expect(librarySummary(teams, null, true)).toBe("The skills could not be read.");
  const none: SkillsResult = { host: [], workspaces: {}, readAt: SKILLS.readAt };
  const resting = libraryTeams(buildOfficeModel(office([agent("a")], [workspace("w1")])), none);
  expect(librarySummary(resting, none)).toBe("No skills on this host or in the teams' workspaces.");
});

test("a skill says which folders it is in", () => {
  expect(skillWhere({ folders: [".claude"] })).toBe("In .claude");
  expect(skillWhere({ folders: [".claude", ".agents"] })).toBe("In .claude and .agents");
  expect(skillWhere({ folders: [".claude", ".agents", ".codex"] })).toBe(
    "In .claude, .agents and .codex",
  );
});

test("the line under the button names who is asked, or why nobody can be", () => {
  expect(askHint({ writers: [] }, null, false)).toBe(
    "No agent of this team is idle, so nobody can be asked.",
  );
  const writers = [{ agentId: "a", title: "Builder" }];
  expect(askHint({ writers }, "Builder", true)).toBe(
    "Wake agents is off, so a request would wait. Turn it on to ask.",
  );
  expect(askHint({ writers }, "Builder", false)).toBe(
    "Builder writes it and answers on the team's board.",
  );
});

function team(name: string, patch: Partial<LibraryTeam> = {}): LibraryTeam {
  return { roomId: name, name, atSkill: [], writers: [], asked: null, skills: [], ...patch };
}
const HUMANIZER = { name: "humanizer", description: "Rewrite AI text", folders: [".claude"] };

test("a skill several workspaces carry is listed once, with the workspaces that have it", () => {
  const teams = [
    team("A", { skills: [HUMANIZER, { name: "deploy", description: null, folders: [".agents"] }] }),
    team("B", { skills: [HUMANIZER] }),
    team("C", { skills: [{ ...HUMANIZER, description: "Another text" }] }),
    team("D", { skills: null }),
  ];
  expect(workspaceSkills(teams)).toEqual([
    { name: "deploy", description: null, folders: [".agents"], teams: ["A"] },
    { ...HUMANIZER, teams: ["A", "B"] },
    { ...HUMANIZER, description: "Another text", teams: ["C"] },
  ]);
  expect(skillTeams(["A"])).toBe("A");
  expect(skillTeams(["A", "B", "C"])).toBe("3 workspaces: A, B and C");
});

test("a search matches every word in the name or the description", () => {
  expect(skillMatches(HUMANIZER, "rewrite HUMAN")).toBe(true);
  expect(skillMatches(HUMANIZER, "rewrite deploy")).toBe(false);
  expect(skillMatches({ name: "deploy", description: null }, "dep")).toBe(true);
});

test("one line says why workspaces list no skill", () => {
  expect(unreadLine([], true)).toBeNull();
  expect(unreadLine([team("A")], false)).toBe("Reading the workspaces' skills...");
  expect(unreadLine([team("A")], "failed")).toBe("The workspaces' skills were not read.");
  expect(unreadLine([team("A")], true)).toBeNull();
  expect(unreadLine([team("A", { skills: null }), team("B", { skills: null })], true)).toBe(
    "The host has no folder for A and B.",
  );
});

test("the teams nobody of can be asked are named once", () => {
  const idle = team("A", { writers: [{ agentId: "a1", title: "Ada" }] });
  expect(busyLine([idle])).toBeNull();
  expect(busyLine([idle, team("B"), team("C")])).toBe(
    "No idle agent, so nobody can be asked, in B and C.",
  );
  expect(busyLine([team("B")])).toContain("No agent of any team is idle");
});
