import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import type { MediaRef, MessageStatus, StoredContact, StoredMessage, Store } from "@pochta-chat/sdk";

/**
 * On-device storage. This is where history actually lives — the server is a
 * transient relay and never keeps your messages, so this is the ONLY copy.
 *
 * It is ENCRYPTED AT REST: message text and contact names are sealed with
 * XChaCha20-Poly1305 under a key derived from your identity (set via
 * `setDbKey` after you unlock). Public keys and timestamps stay in the clear so
 * the store remains indexable/sortable, but content is unreadable on disk
 * without the account. Call `setDbKey` before any read/write.
 */

let dataKey: Uint8Array | null = null;
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const ub64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Derive the at-rest key from the identity seed. Call once after unlock. */
export function setDbKey(seed: Uint8Array): void {
  const buf = new Uint8Array(seed.length + 9);
  buf.set(seed);
  buf.set(te.encode("db-key-v1"), seed.length);
  dataKey = sha256(buf);
}

function encField(plain: string): string {
  if (!dataKey) throw new Error("db locked");
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(dataKey, nonce).encrypt(te.encode(plain));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return b64(out);
}

function decField(blob: string): string {
  if (!dataKey) throw new Error("db locked");
  const raw = ub64(blob);
  return td.decode(xchacha20poly1305(dataKey, raw.slice(0, 24)).decrypt(raw.slice(24)));
}

function encBytes(bytes: Uint8Array): string {
  if (!dataKey) throw new Error("db locked");
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(dataKey, nonce).encrypt(bytes);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return b64(out);
}

function decBytes(blob: string): Uint8Array {
  if (!dataKey) throw new Error("db locked");
  const raw = ub64(blob);
  return xchacha20poly1305(dataKey, raw.slice(0, 24)).decrypt(raw.slice(24));
}

// The message/contact/media data model is the SDK's shared contract; re-exported
// here so existing app imports (`./lib/db`) keep resolving unchanged.
export type { MediaRef, MessageStatus, StoredContact, StoredMessage } from "@pochta-chat/sdk";

// On-disk row: text and the media ref are stored as ciphertext strings.
type Row = Omit<StoredMessage, "text" | "media"> & { text: string; mediaEnc?: string };

interface ChatDB extends DBSchema {
  contacts: { key: string; value: StoredContact };
  messages: {
    key: string;
    value: Row;
    indexes: { "by-contact": string };
  };
  // Decrypted media cached on-device (encrypted at rest) so it persists across
  // reloads AND survives the server's retention window — no re-download.
  media: { key: string; value: { blobId: string; cipher: string; mime: string } };
}

// Decrypt a stored row into an app-facing message.
function toStored(row: Row): StoredMessage {
  const { mediaEnc, ...rest } = row;
  return {
    ...rest,
    text: row.deleted ? "" : decField(row.text),
    media: mediaEnc ? (JSON.parse(decField(mediaEnc)) as MediaRef) : undefined,
  };
}

let dbp: Promise<IDBPDatabase<ChatDB>> | null = null;

function db(): Promise<IDBPDatabase<ChatDB>> {
  if (!dbp) {
    dbp = openDB<ChatDB>("chat", 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("contacts", { keyPath: "pubkey" });
          const messages = d.createObjectStore("messages", { keyPath: "id" });
          messages.createIndex("by-contact", "contact");
        }
        if (oldVersion < 2) {
          d.createObjectStore("media", { keyPath: "blobId" });
        }
      },
    });
  }
  return dbp;
}

// --- contacts (name encrypted at rest) ---
export async function getContacts(): Promise<StoredContact[]> {
  const all = await (await db()).getAll("contacts");
  return all
    .map((c) => ({ ...c, name: decField(c.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertContact(c: StoredContact): Promise<void> {
  const d = await db();
  const existing = await d.get("contacts", c.pubkey);
  // Keep the earliest addedAt; refresh name/enc. Name is stored sealed.
  await d.put("contacts", {
    ...c,
    name: encField(c.name),
    addedAt: existing?.addedAt ?? c.addedAt,
  });
}

// --- messages (text + media ref encrypted at rest) ---
export async function getMessages(contact: string): Promise<StoredMessage[]> {
  const rows = await (await db()).getAllFromIndex("messages", "by-contact", contact);
  return rows.map(toStored).sort((a, b) => a.ts - b.ts);
}

export async function addMessage(m: StoredMessage): Promise<void> {
  const { media, ...rest } = m;
  const row: Row = {
    ...rest,
    text: encField(m.text),
    mediaEnc: media ? encField(JSON.stringify(media)) : undefined,
  };
  // put (not add) so engine re-delivery of the same id is idempotent on disk too.
  await (await db()).put("messages", row);
}

export async function setMessageStatus(
  id: string,
  status: MessageStatus,
): Promise<void> {
  const d = await db();
  const m = await d.get("messages", id);
  if (m && m.mine) {
    const rank = { sent: 0, delivered: 1, read: 2 };
    if (!m.status || rank[status] > rank[m.status]) {
      await d.put("messages", { ...m, status });
    }
  }
}

export async function lastMessage(contact: string): Promise<StoredMessage | undefined> {
  const msgs = await getMessages(contact);
  return msgs[msgs.length - 1];
}

/** One message, decrypted (text is "" for tombstoned/deleted). */
export async function getMessage(id: string): Promise<StoredMessage | undefined> {
  const row = await (await db()).get("messages", id);
  return row ? toStored(row) : undefined;
}

/** Edit a message's text in place (author only — caller enforces). */
export async function editStoredMessage(id: string, newText: string): Promise<boolean> {
  const d = await db();
  const m = await d.get("messages", id);
  if (!m) return false;
  await d.put("messages", { ...m, text: encField(newText), edited: true });
  return true;
}

/** Tombstone a message (deleted for everyone) — clears its content. */
export async function tombstoneStoredMessage(id: string): Promise<boolean> {
  const d = await db();
  const m = await d.get("messages", id);
  if (!m) return false;
  await d.put("messages", { ...m, deleted: true, text: encField(""), mediaEnc: undefined });
  return true;
}

/** Remove a message locally (delete for me). */
export async function removeStoredMessage(id: string): Promise<void> {
  await (await db()).delete("messages", id);
}

/** Toggle a reactor's emoji reaction on a message. */
export async function applyReaction(
  id: string,
  emoji: string,
  reactor: string,
  remove: boolean,
): Promise<boolean> {
  const d = await db();
  const m = await d.get("messages", id);
  if (!m) return false;
  const reactions = { ...(m.reactions ?? {}) };
  const set = new Set(reactions[emoji] ?? []);
  if (remove) set.delete(reactor);
  else set.add(reactor);
  if (set.size) reactions[emoji] = [...set];
  else delete reactions[emoji];
  await d.put("messages", { ...m, reactions });
  return true;
}

/** Full-text search over the decrypted local store (newest first). */
export async function searchMessages(query: string): Promise<StoredMessage[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await (await db()).getAll("messages");
  return rows
    .map(toStored)
    .filter((m) => !m.deleted && m.text.toLowerCase().includes(q))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 50);
}

// --- media cache (decrypted media, encrypted at rest) ---
export async function cacheMedia(blobId: string, bytes: Uint8Array, mime: string): Promise<void> {
  await (await db()).put("media", { blobId, cipher: encBytes(bytes), mime });
}

export async function getCachedMedia(blobId: string): Promise<Uint8Array | undefined> {
  const rec = await (await db()).get("media", blobId);
  return rec ? decBytes(rec.cipher) : undefined;
}

/** Wipe all on-device data (used on sign-out). */
export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear("messages");
  await d.clear("contacts");
  await d.clear("media");
  dataKey = null;
}

/**
 * The SDK persistence port (`Store`), backed by this encrypted IndexedDB store.
 * The client uses only these operations; the query helpers above (getContacts,
 * getMessages, searchMessages, …) are for the UI.
 */
export const store: Store = {
  addMessage,
  getMessage,
  setMessageStatus,
  editStoredMessage,
  tombstoneStoredMessage,
  removeStoredMessage,
  applyReaction,
  upsertContact,
  cacheMedia,
  getCachedMedia,
};
