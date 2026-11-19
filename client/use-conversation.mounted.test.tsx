/**
 * @vitest-environment jsdom
 */
// The conversation hook against a stand-in for the host's timeline handle: it subscribes first,
// reads the latest page, follows live events and pages back by the page's own start cursor.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { useConversation, type Conversation } from "./use-conversation.js";

interface Page {
  entries: { seqStart: number; seqEnd: number; item: AgentTimelineItem }[];
  startCursor: { epoch: string; seq: number } | null;
  hasOlder: boolean;
  staleCursor?: boolean;
  error: string | null;
}
interface Pending {
  options: Record<string, unknown>;
  resolve(page: Page): void;
  reject(error: unknown): void;
}

let handlers: ((event: unknown) => void)[];
let releases: number;
let pending: Pending[];
let refs: string[];
let subscribeReady: Promise<void>;

// One object for every render, as the host's SDK object is: a new one would resubscribe each time.
const sdk = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => sdk.current,
}));
sdk.current = {
  agents: {
    ref: (id: string) => {
      refs.push(id);
      return {
        timeline: {
          subscribe(handler: (event: unknown) => void) {
            handlers.push(handler);
            return Object.assign(
              () => {
                releases += 1;
                handlers = handlers.filter((h) => h !== handler);
              },
              { ready: subscribeReady },
            );
          },
          refetch: (options: Record<string, unknown>) =>
            new Promise<Page>((resolve, reject) => pending.push({ options, resolve, reject })),
        },
      };
    },
  },
};

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLElement;
let root: Root;
let conversation: Conversation;
let currentAgent: string;

function Probe() {
  conversation = useConversation(currentAgent);
  return null;
}

const say = (text: string, messageId?: string): AgentTimelineItem => ({
  type: "assistant_message",
  text,
  messageId,
});
const you = (text: string): AgentTimelineItem => ({
  type: "user_message",
  text,
});
const entry = (seq: number, item: AgentTimelineItem, seqEnd = seq, turnId?: string) => ({
  seqStart: seq,
  seqEnd,
  item,
  turnId,
});
const page = (entries: Page["entries"], extra: Partial<Page> = {}): Page => ({
  entries,
  startCursor: entries.length ? { epoch: "e1", seq: entries[0]!.seqStart } : null,
  hasOlder: false,
  error: null,
  ...extra,
});
const live = (seq: number | undefined, item: AgentTimelineItem, turnId?: string, epoch = "e1") => ({
  agentId: "a1",
  timestamp: "t",
  seq,
  epoch,
  event: { type: "timeline", provider: "claude", item, turnId },
});
const texts = () => conversation.rows.map((row) => row.text);

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function answer(index: number, value: Page) {
  await act(async () => pending[index]!.resolve(value));
  await settle();
}
async function mount(agentId = "a1") {
  currentAgent = agentId;
  await act(async () => root.render(<Probe />));
  await settle();
}
async function push(event: unknown) {
  await act(async () => handlers.forEach((handler) => handler(event)));
}

beforeEach(() => {
  handlers = [];
  releases = 0;
  pending = [];
  refs = [];
  subscribeReady = Promise.resolve();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

test("it subscribes first, then reads the latest 60 entries, without wholeTurns (it has no size limit)", async () => {
  await mount();
  expect(handlers).toHaveLength(1);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.options).toEqual({
    direction: "tail",
    limit: 60,
  });
  expect(conversation.status).toBe("loading");
  await answer(0, page([entry(1, you("Hi")), entry(2, say("Hello", "m1"))]));
  expect(conversation.status).toBe("ready");
  expect(texts()).toEqual(["Hi", "Hello"]);
});

test("it waits for the subscription to be ready before it reads", async () => {
  let ready!: () => void;
  subscribeReady = new Promise<void>((resolve) => (ready = resolve));
  await mount();
  expect(pending).toHaveLength(0);
  await act(async () => ready());
  await settle();
  expect(pending).toHaveLength(1);
});

test("a live item is appended; one sequence number arriving twice is kept once", async () => {
  await mount();
  await answer(0, page([entry(1, you("Hi"))]));
  await push(live(2, say("Hel", "m1")));
  await push(live(2, say("Hel", "m1")));
  await push(live(3, say("lo", "m1")));
  expect(texts()).toEqual(["Hi", "Hello"]);
});

test("a live piece inside a merged page entry's range is not added again", async () => {
  await mount();
  await answer(0, page([entry(1, you("Hi")), entry(2, say("Hello", "m1"), 4)]));
  await push(live(3, say("llo", "m1")));
  await push(live(5, say("!", "m1")));
  expect(texts()).toEqual(["Hi", "Hello!"]);
});

test("a live piece that came while the latest page was read stays when it is past the page's end", async () => {
  await mount();
  await push(live(3, you("three")));
  await push(live(2, you("two, in the page")));
  await answer(0, page([entry(1, you("One")), entry(2, you("Two"))]));
  expect(texts()).toEqual(["One", "Two", "three"]);
});

test("a read after a restored subscription keeps what is live past the page; a replacement keeps nothing", async () => {
  await mount();
  await answer(0, page([entry(1, you("One"))]));
  await push(live(2, you("two")));
  await push(live(4, you("four")));
  await push({ agentId: "a1", subscriptionId: "s", event: { type: "subscription_restored" } });
  await answer(1, page([entry(1, you("One")), entry(2, you("Two")), entry(3, you("Three"))]));
  expect(texts()).toEqual(["One", "Two", "Three", "four"]);

  await push({ agentId: "a1", event: { type: "replacement", epoch: "e2" } });
  await answer(2, page([entry(1, you("Fresh"))]));
  expect(texts()).toEqual(["Fresh"]);
});

test("the turn of a page entry and of a live piece reaches the rows", async () => {
  await mount();
  await answer(0, page([entry(1, say("From the page"), 1, "t1")]));
  await push(live(2, say("A new turn"), "t2"));
  await push(live(3, say(" goes on"), "t2"));
  expect(texts()).toEqual(["From the page", "A new turn goes on"]);
});

test("a tool call's live updates are one row, as it is after a reopen", async () => {
  const call = (status: "running" | "completed"): AgentTimelineItem =>
    ({
      type: "tool_call",
      callId: "c1",
      name: "Bash",
      status,
      error: null,
      detail: { type: "shell", command: "npm test" },
    }) as AgentTimelineItem;
  await mount();
  await answer(0, page([entry(1, you("Hi"))]));
  await push(live(2, call("running")));
  await push(live(3, say("Waiting", "m1")));
  await push(live(4, call("completed")));
  expect(texts()).toEqual(["Hi", "Bash: npm test", "Waiting"]);
});

test("a live item arriving out of order is placed by its sequence number", async () => {
  await mount();
  await answer(0, page([entry(1, you("Hi"))]));
  await push(live(4, you("four")));
  await push(live(3, you("three")));
  expect(texts()).toEqual(["Hi", "three", "four"]);
});

test("a live piece past the last held entry is appended without sorting the list", async () => {
  await mount();
  await answer(0, page([entry(1, you("Hi")), entry(2, say("Hello", "m1"), 4)]));
  const sort = vi.spyOn(Array.prototype, "sort");
  try {
    await push(live(5, you("five")));
    await push(live(6, you("six")));
    // An out of order piece still lands in place, also without a sort.
    await push(live(8, you("eight")));
    await push(live(7, you("seven")));
    await push(live(3, you("inside the merged range")));
    expect(sort).not.toHaveBeenCalled();
  } finally {
    sort.mockRestore();
  }
  expect(texts()).toEqual(["Hi", "Hello", "five", "six", "seven", "eight"]);
});

test("live events without a timeline item or sequence number add nothing", async () => {
  await mount();
  await answer(0, page([entry(1, you("Hi"))]));
  await push(live(undefined, you("no seq")));
  await push({
    agentId: "a1",
    timestamp: "t",
    seq: 9,
    event: { type: "turn_started" },
  });
  expect(texts()).toEqual(["Hi"]);
});

test.each([
  [
    "subscription_restored",
    {
      agentId: "a1",
      subscriptionId: "s",
      event: { type: "subscription_restored" },
    },
  ],
  ["replacement", { agentId: "a1", event: { type: "replacement", epoch: "e2" } }],
])("a %s event reads the latest page again and replaces what is held", async (_name, event) => {
  await mount();
  await answer(0, page([entry(1, you("Old"))]));
  await push(event);
  expect(pending).toHaveLength(2);
  expect(pending[1]!.options).toEqual({
    direction: "tail",
    limit: 60,
  });
  await answer(1, page([entry(1, you("New"))]));
  expect(texts()).toEqual(["New"]);
});

test("loadEarlier asks for the page before the held start cursor and puts it in front", async () => {
  await mount();
  await answer(
    0,
    page([entry(10, you("Later"))], {
      hasOlder: true,
      startCursor: { epoch: "e1", seq: 10 },
    }),
  );
  expect(conversation.hasEarlier).toBe(true);
  await act(async () => conversation.loadEarlier());
  expect(conversation.loadingEarlier).toBe(true);
  expect(pending[1]!.options).toEqual({
    direction: "before",
    cursor: { epoch: "e1", seq: 10 },
    limit: 60,
  });
  await answer(1, page([entry(4, you("Earlier"))], { hasOlder: false }));
  expect(texts()).toEqual(["Earlier", "Later"]);
  expect(conversation.hasEarlier).toBe(false);
  expect(conversation.loadingEarlier).toBe(false);
});

test("a second loadEarlier while one is in flight asks nothing", async () => {
  await mount();
  await answer(0, page([entry(10, you("Later"))], { hasOlder: true }));
  await act(async () => {
    conversation.loadEarlier();
    conversation.loadEarlier();
  });
  expect(pending).toHaveLength(2);
});

test("a following earlier page uses the cursor of the page before", async () => {
  await mount();
  await answer(0, page([entry(10, you("c"))], { hasOlder: true }));
  await act(async () => conversation.loadEarlier());
  await answer(1, page([entry(5, you("b"))], { hasOlder: true }));
  await act(async () => conversation.loadEarlier());
  expect(pending[2]!.options.cursor).toEqual({ epoch: "e1", seq: 5 });
});

test("a failed first read is an error with one sentence; retry reads again", async () => {
  await mount();
  await act(async () => pending[0]!.reject(new Error("socket closed")));
  await settle();
  expect(conversation.status).toBe("error");
  expect(conversation.error).toBe("Unable to read the conversation: socket closed");
  await act(async () => conversation.retry());
  await settle();
  expect(conversation.status).toBe("loading");
  expect(pending).toHaveLength(2);
  await answer(1, page([entry(1, you("Hi"))]));
  expect(conversation.status).toBe("ready");
  expect(conversation.error).toBeNull();
});

test("a page that carries an error is a failed read", async () => {
  await mount();
  await answer(0, page([], { error: "agent not found" }));
  expect(conversation.status).toBe("error");
  expect(conversation.error).toBe("Unable to read the conversation: agent not found");
});

test("a failed earlier page keeps the rows and leaves loadEarlier usable", async () => {
  await mount();
  await answer(0, page([entry(10, you("Later"))], { hasOlder: true }));
  await act(async () => conversation.loadEarlier());
  await act(async () => pending[1]!.reject(new Error("timeout")));
  await settle();
  expect(texts()).toEqual(["Later"]);
  expect(conversation.status).toBe("ready");
  expect(conversation.loadingEarlier).toBe(false);
  expect(conversation.hasEarlier).toBe(true);
  expect(conversation.earlierFailed).toBe(true);
  await act(async () => conversation.loadEarlier());
  expect(conversation.earlierFailed).toBe(false);
  expect(pending).toHaveLength(3);
  await answer(2, page([entry(4, you("Earlier"))]));
  expect(conversation.earlierFailed).toBe(false);
  expect(texts()).toEqual(["Earlier", "Later"]);
});

test("an earlier page from a stale cursor is not prepended: the tail is read again", async () => {
  await mount();
  await answer(0, page([entry(10, you("Later"))], { hasOlder: true }));
  await act(async () => conversation.loadEarlier());
  await answer(1, page([entry(3, you("Wrong"))], { staleCursor: true, hasOlder: true }));
  expect(texts()).toEqual(["Later"]);
  expect(pending).toHaveLength(3);
  expect(pending[2]!.options).toEqual({
    direction: "tail",
    limit: 60,
  });
  await answer(2, page([entry(1, you("Fresh"))]));
  expect(texts()).toEqual(["Fresh"]);
  expect(conversation.loadingEarlier).toBe(false);
  expect(conversation.earlierFailed).toBe(false);
});

test("unmount unsubscribes, and a page arriving afterwards sets nothing", async () => {
  await mount();
  const seen = conversation;
  act(() => root.unmount());
  expect(releases).toBe(1);
  await act(async () => pending[0]!.resolve(page([entry(1, you("Late"))])));
  expect(conversation).toBe(seen);
  root = createRoot(container);
});

test("changing the agent drops the old rows and starts again; the old page is ignored", async () => {
  await mount("a1");
  await answer(0, page([entry(1, you("From a1"))]));
  await mount("a2");
  expect(releases).toBe(1);
  expect(refs.at(-1)).toBe("a2");
  expect(conversation.rows).toEqual([]);
  expect(conversation.status).toBe("loading");
  await answer(1, page([entry(1, you("From a2"))]));
  expect(texts()).toEqual(["From a2"]);
});

test("a first page of the old agent arriving after the switch is ignored", async () => {
  await mount("a1");
  await mount("a2");
  await answer(0, page([entry(1, you("Stale"))]));
  expect(conversation.rows).toEqual([]);
  await answer(1, page([entry(1, you("Fresh"))]));
  expect(texts()).toEqual(["Fresh"]);
});
