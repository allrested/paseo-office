/**
 * What the office does with a `ui` block's evaluated tree before it draws. A few components ask the
 * Generative UI plugin's own daemon RPCs (the project views, the map, the image search) or wait for
 * a file `Load` reads; the office has neither, so each becomes a labelled note in its place.
 */
export interface GenuiNode {
  readonly kind: "node";
  readonly type: string;
  readonly key: string;
  readonly props: Readonly<Record<string, unknown>>;
}

/** Components whose renderer calls the Generative UI plugin's daemon RPCs or its web search. */
const NEEDS_WORKSPACE = new Set([
  "Changes",
  "Commits",
  "PullRequest",
  "Threads",
  "Environments",
  "Map",
  "ImageSearch",
]);

const REASON_MAX = 120;

function isNode(value: unknown): value is GenuiNode {
  return typeof value === "object" && value !== null && (value as GenuiNode).kind === "node";
}

function note(node: GenuiNode, what: string): GenuiNode {
  return {
    kind: "node",
    type: "Callout",
    key: node.key,
    props: { text: `${what}: needs the Generative UI plugin's workspace chat`, tone: "neutral" },
  };
}

function replace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replace);
  if (isNode(value)) {
    if (value.type === "Loading") {
      const named = value.props.component;
      return note(value, typeof named === "string" ? named : "Load");
    }
    if (NEEDS_WORKSPACE.has(value.type)) return note(value, value.type);
    return { ...value, props: replace(value.props) };
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, replace(inner)]));
  }
  return value;
}

/** The tree with each component the office cannot draw replaced by a note; the input is not changed. */
export function withPlaceholders(roots: readonly GenuiNode[]): GenuiNode[] {
  return replace(roots) as GenuiNode[];
}

/** One short line for why a block did not parse: its first error, with the line. */
export function failureReason(
  diagnostics: readonly { line: number; column: number; severity: string; message: string }[],
): string {
  const first = diagnostics.find((item) => item.severity === "error") ?? diagnostics[0];
  if (first === undefined) return "The block did not parse.";
  const text = `Line ${first.line}: ${first.message}`.replace(/\s+/g, " ");
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text;
}
