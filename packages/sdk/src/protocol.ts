/**
 * Wire-protocol constants shared by every Pochta client and the relay. Kept in
 * one place so a third-party client (or a non-JS port) has a single source of
 * truth. The human-readable spec is PROTOCOL.md at the repo root.
 */

/** Bumped when the on-the-wire contract changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Phoenix Channel topic for a account's inbox (join your own to receive). */
export const inboxTopic = (pubkey: string): string => `inbox:${pubkey}`;

/** The socket mount path on the relay. */
export const SOCKET_PATH = "/socket";

/** Channel events the client uses on the inbox topic. */
export const EVENTS = {
  /** Server → client: a sealed envelope was delivered to your inbox. */
  message: "message",
  /** Client → server: deliver a sealed envelope to `to` (queued if offline). */
  send: "send",
  /** Client → server: ask who's online / last-seen for a set of pubkeys. */
  presence: "presence",
} as const;
