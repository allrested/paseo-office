import type { Alert, AlertKind } from "./alerts.js";
import type { Incident } from "./contracts.js";
import { PLAN_OUT_PCT } from "./plan-usage.js";
import type { NotifyLevel } from "./settings.js";

/** What the office sends to the owner's webhook when it raises something that needs a look. */
export interface Notice {
  /** Who sent it, for a receiver that takes messages from several places. */
  source: "paseo-office";
  /** One line a chat can show as it is. */
  text: string;
  kind: AlertKind | "incident" | "plan" | "host" | "test";
  severity: "warning" | "danger";
  title: string;
  detail: string;
  /** The agent it is about, by the name the office shows; absent when it is about none. */
  agent?: string;
  /** Where to read more: an incident's page in its tracker. */
  url?: string;
  /** Epoch ms it was noticed. */
  at: number;
}

/** A loop burns a plan until someone stops it; the others wait for a look. */
const DANGER: ReadonlySet<Notice["kind"]> = new Set(["loop", "incident"]);

function build(
  fields: Omit<Notice, "source" | "text" | "severity">,
  office: string,
  severity: Notice["severity"] = DANGER.has(fields.kind) ? "danger" : "warning",
): Notice {
  const { title, detail, url } = fields;
  const text = [`${office}: ${title}`, detail, url].filter((part) => part).join("\n");
  return { source: "paseo-office", text, severity, ...fields };
}

/** An alert as it was raised: its title and detail already follow streamer mode. */
export function alertNotice(alert: Alert, agent: string | null, office: string): Notice {
  const { kind, title, detail, at } = alert;
  return build({ kind, title, detail, at, ...(agent === null ? {} : { agent }) }, office);
}

export function incidentNotice(incident: Incident, office: string): Notice {
  const { key, title, url, foundAt } = incident;
  return build(
    { kind: "incident", title: `Incident ${key}`, detail: title, url, at: foundAt },
    office,
  );
}

/** A provider's closest limit has reached 80%, 95% or 100%: the last is danger, as a loop is. */
export function planNotice(
  provider: string,
  limit: string,
  usedPct: number,
  at: number,
  office: string,
): Notice {
  const out = usedPct >= PLAN_OUT_PCT;
  const title = out
    ? `${provider} is out of its ${limit} limit`
    : `${provider} is at ${Math.floor(usedPct)}% of its ${limit} limit`;
  return build({ kind: "plan", title, detail: "", at }, office, out ? "danger" : "warning");
}

/** The host's memory is at the Host card's danger threshold. */
export function hostNotice(percent: number, at: number, office: string): Notice {
  const detail = `${percent}% of memory is in use`;
  return build({ kind: "host", title: "The host is low on memory", detail, at }, office, "danger");
}

export function testNotice(at: number, office: string): Notice {
  return build(
    { kind: "test", title: "Test message", detail: "The office can reach this address.", at },
    office,
  );
}

/** Whether the owner asked to be told of this: `danger` leaves the warnings out. */
export function wanted(notice: Notice, level: NotifyLevel): boolean {
  return notice.severity === "danger" || level === "warning";
}
