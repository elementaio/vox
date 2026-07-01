/**
 * The client's data model and its persistence port.
 *
 * These types are the SDK's contract: they describe messages/contacts/media as
 * the app sees them, the wire `Body` union the relay carries (sealed), and the
 * `Store` interface a host supplies so the SDK stays storage-agnostic (browser
 * IndexedDB, React-Native SQLite, a Node bot's memory — all just implement
 * `Store`). The SDK itself never imports a storage engine.
 */

export type MessageStatus = "sent" | "delivered" | "read";

export interface StoredContact {
  pubkey: string; // Ed25519 identity — the contact id
  enc: string; // X25519 key we seal messages to
  name: string;
  relay?: string; // home-relay hint (http base) for cross-server delivery
  addedAt: number;
}

export interface MediaRef {
  blobId: string; // id on the relay's blob store
  key: string; // hex key to decrypt the blob (sensitive → store encrypted at rest)
  mime: string;
  mkind: "image" | "audio" | "file";
  name?: string; // original filename (for generic files)
}

export interface StoredMessage {
  id: string;
  contact: string; // the other party's pubkey (the conversation key)
  from: string; // sender pubkey
  text: string;
  ts: number;
  mine: boolean;
  status?: MessageStatus;
  edited?: boolean;
  deleted?: boolean; // tombstone (deleted for everyone)
  reactions?: Record<string, string[]>; // emoji → reactor pubkeys
  replyTo?: string; // id of the message this one replies to
  media?: MediaRef;
}

/** The media fields carried inside a sealed media/carbon-media body. */
export type MediaBody = {
  blobId: string;
  key: string;
  mime: string;
  mkind: "image" | "audio" | "file";
  name?: string;
};

/**
 * The sealed application payload (`body` inside an envelope). The relay never
 * sees any of this — it's inside the E2E ciphertext. `relay` on outward-facing
 * bodies is the sender's home-relay hint, so replies can federate back.
 */
export type Body =
  | { t: "msg"; id: string; text: string; enc: string; name: string; relay?: string; replyTo?: string }
  | {
      t: "carbon";
      id: string;
      to: string;
      toName: string;
      toEnc: string;
      text: string;
      replyTo?: string;
    }
  | ({ t: "media"; id: string; enc: string; sender: string; relay?: string } & MediaBody)
  | ({ t: "cmedia"; id: string; to: string; toName: string; toEnc: string } & MediaBody)
  | { t: "edit"; targetId: string; text: string }
  | { t: "del"; targetId: string }
  | { t: "react"; targetId: string; emoji: string; remove: boolean }
  | { t: "rcpt"; id: string; state: "delivered" | "read" }
  | { t: "typing"; on: boolean }
  | { t: "call-offer"; callId: string; sdp: string; video: boolean; enc: string; name: string; relay?: string }
  | { t: "call-answer"; callId: string; sdp: string }
  | { t: "call-ice"; callId: string; candidate: RTCIceCandidateInit }
  | { t: "call-decline"; callId: string }
  | { t: "call-hangup"; callId: string };

export type CallState = "calling" | "ringing" | "connecting" | "connected" | "ended";

export interface PresenceInfo {
  online: boolean;
  lastSeen: number | null;
}

/** Callbacks the host UI supplies; the SDK invokes them as things happen. */
export interface ClientEvents {
  onStatus: (s: string) => void;
  onMessage: (contact: string, msg: StoredMessage) => void;
  onMessageUpdated: (contact: string, msg: StoredMessage) => void;
  onMessageRemoved: (contact: string, id: string) => void;
  onReceipt: (contact: string, id: string, state: "delivered" | "read") => void;
  onTyping: (contact: string, on: boolean) => void;
  onContact: (contact: StoredContact) => void;
  onPresence: (contact: string, info: PresenceInfo) => void;
  onIncomingCall: (contact: string, name: string, callId: string, video: boolean) => void;
  onCallState: (state: CallState, info?: string) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
}

/**
 * Persistence port. The host implements this over whatever durable store it has;
 * the SDK calls it to record/read the local message history (the source of truth
 * lives on the device, never the relay). All ops are async so a host can back
 * them with IndexedDB/SQLite/etc.
 */
export interface Store {
  addMessage(m: StoredMessage): Promise<void>;
  getMessage(id: string): Promise<StoredMessage | undefined>;
  setMessageStatus(id: string, status: MessageStatus): Promise<void>;
  editStoredMessage(id: string, newText: string): Promise<boolean>;
  tombstoneStoredMessage(id: string): Promise<boolean>;
  removeStoredMessage(id: string): Promise<void>;
  applyReaction(id: string, emoji: string, reactor: string, remove: boolean): Promise<boolean>;
  upsertContact(c: StoredContact): Promise<void>;
  cacheMedia(blobId: string, bytes: Uint8Array, mime: string): Promise<void>;
  getCachedMedia(blobId: string): Promise<Uint8Array | undefined>;
}
