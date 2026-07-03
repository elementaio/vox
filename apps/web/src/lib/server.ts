/**
 * Which relay to talk to. This is what makes the app self-hostable: a family or
 * company runs their own relay, and the client points at it.
 *
 * Default: the SAME origin the app was served from (so visiting your family
 * server's URL "just works"). Override: a saved server address (for pointing a
 * client at a relay other than where the page is hosted). Dev falls back to the
 * local Phoenix relay on :4000 (Vite serves the UI on :5180).
 */

const KEY = "chat.server.v1";

/** ws(s)://host base for the chosen relay (no trailing slash, no /socket). */
export function serverBase(): string {
  const override = localStorage.getItem(KEY);
  if (override) return override.replace(/\/+$/, "");

  const loc = window.location;
  if (loc.port === "5180") return "ws://localhost:4000"; // Vite dev → local relay
  // Packaged desktop/native shell is served from file:// (no host to inherit) →
  // default to the public relay. Users can still point elsewhere via setServer().
  if (loc.protocol === "file:" || !loc.host) return "wss://vox.server.jadwal.io";
  const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${loc.host}`;
}

export const socketUrl = (): string => `${serverBase()}/socket`;
export const httpBase = (): string => serverBase().replace(/^ws/, "http");

/** What to show the user (the override, or "this site"). */
export function serverLabel(): string {
  return localStorage.getItem(KEY) || "this site";
}

/** Save/clear a custom relay address. Accepts ws://, wss://, http(s):// or host. */
export function setServer(input: string): void {
  const v = input.trim().replace(/\/+$/, "");
  if (!v) {
    localStorage.removeItem(KEY);
    return;
  }
  // Normalize http(s) → ws(s); bare host → ws://host.
  let url = v;
  if (url.startsWith("http://")) url = "ws://" + url.slice(7);
  else if (url.startsWith("https://")) url = "wss://" + url.slice(8);
  else if (!url.startsWith("ws://") && !url.startsWith("wss://")) url = "ws://" + url;
  localStorage.setItem(KEY, url);
}
