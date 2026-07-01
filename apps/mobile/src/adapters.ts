import { MMKV } from "react-native-mmkv";
import type { KVStore, Store, StoredContact, StoredMessage, MessageStatus } from "@pochta-chat/sdk";

/**
 * Native adapters that plug the (platform-agnostic) SDK into React Native.
 *
 * The SDK's `KVStore` is synchronous, so we back it with MMKV (fast, synchronous,
 * and encrypted at rest) rather than the async AsyncStorage/SecureStore. The same
 * MMKV instance backs a simple `Store` for message/contact history — enough to run
 * the messenger; swap in expo-sqlite for large histories later.
 */

// Encrypted key-value store. (In production, derive the encryptionKey from the
// device keychain instead of a constant — see the README.)
const mmkv = new MMKV({ id: "pochta", encryptionKey: "pochta-mmkv-v1" });

/** KVStore for the SDK identity vault + device id. */
export const kv: KVStore = {
  getItem: (k) => mmkv.getString(k) ?? null,
  setItem: (k, v) => mmkv.set(k, v),
  removeItem: (k) => mmkv.delete(k),
};

// --- a minimal Store over MMKV (JSON blobs keyed by id) --------------------
const MSG = (id: string) => `msg:${id}`;
const CONTACT = (pk: string) => `contact:${pk}`;
const readJSON = <T>(k: string): T | undefined => {
  const s = mmkv.getString(k);
  return s ? (JSON.parse(s) as T) : undefined;
};

export const store: Store = {
  async addMessage(m) {
    mmkv.set(MSG(m.id), JSON.stringify(m));
  },
  async getMessage(id) {
    return readJSON<StoredMessage>(MSG(id));
  },
  async setMessageStatus(id, status: MessageStatus) {
    const m = readJSON<StoredMessage>(MSG(id));
    if (m && m.mine) {
      const rank = { sent: 0, delivered: 1, read: 2 } as const;
      if (!m.status || rank[status] > rank[m.status]) {
        mmkv.set(MSG(id), JSON.stringify({ ...m, status }));
      }
    }
  },
  async editStoredMessage(id, newText) {
    const m = readJSON<StoredMessage>(MSG(id));
    if (!m) return false;
    mmkv.set(MSG(id), JSON.stringify({ ...m, text: newText, edited: true }));
    return true;
  },
  async tombstoneStoredMessage(id) {
    const m = readJSON<StoredMessage>(MSG(id));
    if (!m) return false;
    mmkv.set(MSG(id), JSON.stringify({ ...m, deleted: true, text: "", media: undefined }));
    return true;
  },
  async removeStoredMessage(id) {
    mmkv.delete(MSG(id));
  },
  async applyReaction(id, emoji, reactor, remove) {
    const m = readJSON<StoredMessage>(MSG(id));
    if (!m) return false;
    const reactions = { ...(m.reactions ?? {}) };
    const set = new Set(reactions[emoji] ?? []);
    remove ? set.delete(reactor) : set.add(reactor);
    if (set.size) reactions[emoji] = [...set];
    else delete reactions[emoji];
    mmkv.set(MSG(id), JSON.stringify({ ...m, reactions }));
    return true;
  },
  async upsertContact(c: StoredContact) {
    mmkv.set(CONTACT(c.pubkey), JSON.stringify(c));
  },
  // Media cache: a first cut keeps blobs out of MMKV; wire expo-file-system next.
  async cacheMedia() {},
  async getCachedMedia() {
    return undefined;
  },
};
