/**
 * @elementaio/vox-sdk — the framework-agnostic client SDK for Vox.
 *
 * Everything a client needs to speak the Vox protocol: self-owned identity,
 * end-to-end sign-then-seal crypto, the relay transport + message operations,
 * encrypted media, invites, and private-relay enrollment. It ships NO storage
 * engine and NO UI — a host supplies a `Store` (durable history), a `KVStore`
 * (the account vault), the relay URLs, and `ClientEvents` callbacks. That's how
 * the same core runs a browser app, a desktop/mobile app, or a headless bot.
 *
 * The wire contract is specified in PROTOCOL.md (repo root).
 */

// --- values ---
export { seal, open, deriveEncryptionKey } from "./crypto";
export { createIdentity, restoreIdentity, sign, authParams, Vault, VAULT_PREFIX } from "./identity";
export { encryptAndUpload, downloadAndDecrypt } from "./blobs";
export { inviteToken, parseInvite } from "./invite";
export { enroll } from "./enroll";
export { PROTOCOL_VERSION, inboxTopic, SOCKET_PATH, EVENTS } from "./protocol";
export { Client } from "./client";
export { RoomCall, newRoomId } from "./room";
export { PhoenixTransport } from "./transport";
export { randomId, toBase64, fromBase64 } from "./util";

// --- types ---
export type { SealedEnvelope, OpenedMessage } from "./crypto";
export type { Identity, KVStore, AccountRef } from "./identity";
export type {
  Body,
  MediaBody,
  MediaRef,
  MessageStatus,
  PresenceInfo,
  CallState,
  ClientEvents,
  Store,
  StoredContact,
  StoredMessage,
} from "./types";
export type { ClientConfig } from "./client";
export type { RoomConfig, RoomEvents } from "./room";
export type { Transport, TransportEvents, Outbound, PresenceRow } from "./transport";
