import type { Alert, AlertKind } from "./alerts.js";
import type { Incident } from "./contracts.js";
import type { NotifyLevel } from "./settings.js";

/** What the office sends to the owner's webhook when it raises something that needs a look. */
export interface Notice {
  /** Who sent it, for a receiver that takes messages from several places. */
  source: "paseo-office";
  /** One line a chat can show as it is. */
  text: string;
  kind: AlertKind | "incident" | "test";
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

function build(fields: Omit<Notice, "source" | "text" | "severity">, office: string): Notice {
  const { title, detail, url } = fields;
  const text = [`${office}: ${title}`, detail, url].filter((part) => part).join("\n");
  const severity = DANGER.has(fields.kind) ? "danger" : "warning";
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
