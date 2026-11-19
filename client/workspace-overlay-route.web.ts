/** Same spelling as Paseo's encodeWorkspaceIdForPathSegment, including legacy path-shaped IDs. */
function workspaceSegment(id: string): string {
  if (/^[A-Za-z0-9._~-]+$/.test(id)) return id;
  const bytes = new TextEncoder().encode(id);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return "b64_" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The stock app's workspace route. Connection addresses and pairing data stay with the host app. */
export function workspaceOverlayUrl(
  page: URL,
  hostId: string,
  workspaceId: string | null,
  agentId: string | null,
): string | null {
  const web = page.protocol === "https:" || page.protocol === "http:";
  const desktop = page.protocol === "paseo:" && page.host === "app";
  if ((!web && !desktop) || page.username || page.password) return null;
  const host = hostId.trim();
  const workspace = workspaceId?.trim();
  const agent = agentId?.trim();
  if (!host || [host, workspace, agent].some((id) => id === "." || id === "..")) return null;
  const root = "/h/" + encodeURIComponent(host);
  let path: string;
  let search = "";
  if (workspace) {
    path = root + "/workspace/" + workspaceSegment(workspace);
    if (agent) search = "?open=" + encodeURIComponent("agent:" + agent);
  } else if (agent) {
    path = root + "/agent/" + encodeURIComponent(agent);
  } else {
    return null;
  }
  const url = new URL(page.href);
  url.search = "";
  if (page.hash.startsWith("#/h/")) {
    url.hash = path + search;
  } else {
    // A reverse proxy may mount the app under a prefix before its /h/:server route.
    const at = page.pathname.indexOf("/h/");
    const base = at < 0 ? "" : page.pathname.slice(0, at);
    url.hash = "";
    url.pathname = base + path;
    url.search = search;
  }
  return url.href;
}
