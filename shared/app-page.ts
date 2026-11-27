/**
 * An `app` block of the Generative UI plugin is a self-contained HTML page. The office runs it in
 * a frame with only `allow-scripts`: its own empty origin, no storage of ours, no top navigation,
 * no forms, no popups.
 */
export const APP_FRAME_SANDBOX = "allow-scripts";

/**
 * Inline script and style, and images, fonts and media that are data or blob URLs; nothing is
 * fetched from anywhere, and the page takes no `<base>` and submits no form. The plugin's own
 * renderer uses the same policy, without the last two.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The page the frame opens: the policy first, so every line of the block comes after it. */
export function appPage(html: string): string {
  return [
    "<!doctype html>",
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    html,
  ].join("\n");
}
