import { Socket, type Channel } from "phoenix";
import { authParams, type Identity } from "./identity";
import { open, seal, type SealedEnvelope } from "./crypto";
import { downloadAndDecrypt, encryptAndUpload } from "./blobs";
import { EVENTS, inboxTopic } from "./protocol";
import type {
  Body,
  ClientEvents,
  MediaBody,
  MediaRef,
  Store,
  StoredContact,
  StoredMessage,
} from "./types";

/**
 * The Pochta messenger client. One persistent connection to the relay's inbox.
 *
 * Text is addressed to a CONTACT (their public key) and flows through the relay
 * inbox: delivered live when they're online, queued when they're not — always
 * sealed, so the relay only sees ciphertext. Messages/receipts persist on THIS
 * device (via the injected `Store`); the server keeps no history.
 *
 * Calls (voice/video) reuse the SAME sealed inbox for signaling: offer/answer/
 * ICE ride as *ephemeral* sealed messages (live-only, never queued). Once the
 * handshake completes, media flows directly peer-to-peer over WebRTC — the
 * server never sees or relays it.
 *
 * Framework- and storage-agnostic: the host injects the relay URLs, a `Store`
 * for durable history, its device id, and UI callbacks (`ClientEvents`).
 */

/** Everything the client needs from its host to run. */
export interface ClientConfig {
  socketUrl: string; // ws(s)://relay/socket
  httpBase: string; // http(s)://relay (for /config, /blobs, relay hints)
  identity: Identity;
  store: Store;
  events: ClientEvents;
  deviceId: string; // stable per-device id (for the delivery cursor)
}

interface ActiveCall {
  callId: string;
  contact: string;
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  localStream: MediaStream;
}

const short = (id: string) => id.slice(0, 6);

export class Client {
  private socket: Socket;
  private inbox: Channel;
  private events: ClientEvents;
  private identity: Identity;
  private store: Store;
  private httpBase: string;
  private contacts = new Map<string, StoredContact>();
  private unread = new Map<string, Set<string>>();
  private seen = new Set<string>();
  private active: string | null = null;

  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private iceServers: RTCIceServer[] = [];
  private call: ActiveCall | null = null;
  private pendingOffer:
    | { callId: string; contact: string; sdp: string; video: boolean; enc: string; ice: RTCIceCandidateInit[] }
    | null = null;

  constructor(cfg: ClientConfig) {
    this.identity = cfg.identity;
    this.store = cfg.store;
    this.events = cfg.events;
    this.httpBase = cfg.httpBase;
    this.socket = new Socket(cfg.socketUrl, { params: authParams(cfg.identity) });
    this.inbox = this.socket.channel(inboxTopic(cfg.identity.publicKeyHex), {
      device_id: cfg.deviceId,
    });
  }

  connect(seedContacts: StoredContact[]): void {
    for (const c of seedContacts) this.contacts.set(c.pubkey, c);

    // Ask the relay which ICE servers to use (operator-controlled; may be empty).
    fetch(`${this.httpBase}/config`)
      .then((r) => r.json())
      .then((c: { ice_servers?: RTCIceServer[] }) => {
        this.iceServers = c.ice_servers ?? [];
      })
      .catch(() => {});

    this.socket.onOpen(() => this.events.onStatus("connected"));
    this.socket.onError(() => this.events.onStatus("reconnecting…"));
    this.socket.onClose(() => this.events.onStatus("offline"));
    this.socket.connect();

    this.inbox.on(EVENTS.message, (m: { envelope: SealedEnvelope }) =>
      this.handleEnvelope(m.envelope),
    );
    this.inbox
      .join()
      .receive("ok", () => {
        this.events.onStatus("connected");
        this.pollPresence();
        this.presenceTimer = setInterval(() => this.pollPresence(), 20000);
      })
      .receive("error", (e) => this.events.onStatus(`inbox error: ${JSON.stringify(e)}`));
  }

  /** Ask the relay who's online / last-seen for the given contacts. */
  queryPresence(pubkeys: string[]): void {
    if (pubkeys.length === 0) return;
    this.inbox
      .push(EVENTS.presence, { of: pubkeys })
      .receive("ok", (resp: { presence: Record<string, { online: boolean; last_seen: number | null }> }) => {
        for (const [pk, info] of Object.entries(resp.presence)) {
          this.events.onPresence(pk, { online: info.online, lastSeen: info.last_seen });
        }
      });
  }

  private pollPresence(): void {
    this.queryPresence([...this.contacts.keys()]);
  }

  setActive(contact: string | null): void {
    this.active = contact;
  }

  async addContact(c: StoredContact): Promise<void> {
    this.contacts.set(c.pubkey, c);
    await this.store.upsertContact(c);
    this.events.onContact(c);
    this.queryPresence([c.pubkey]);
  }

  async sendText(
    contact: string,
    text: string,
    replyTo?: string,
  ): Promise<StoredMessage | null> {
    const c = this.contacts.get(contact);
    if (!c) return null;
    const id = crypto.randomUUID();
    const ts = Date.now();
    this.sealTo(c.pubkey, c.enc, {
      t: "msg",
      id,
      text,
      enc: this.identity.encPublicKeyHex,
      name: this.identity.name,
      relay: this.httpBase,
      replyTo,
    }, id, false);
    // Carbon-copy to my own account inbox so my OTHER devices see this sent
    // message too (and reconstruct it on catch-up). Sealed to myself.
    this.sealTo(this.identity.publicKeyHex, this.identity.encPublicKeyHex, {
      t: "carbon",
      id,
      to: c.pubkey,
      toName: c.name,
      toEnc: c.enc,
      text,
      replyTo,
    }, `carbon-${id}`, false);
    const msg: StoredMessage = {
      id,
      contact,
      from: this.identity.publicKeyHex,
      text,
      ts,
      mine: true,
      status: "sent",
      replyTo,
    };
    this.seen.add(id);
    await this.store.addMessage(msg);
    this.events.onMessage(contact, msg);
    return msg;
  }

  setTyping(contact: string, on: boolean): void {
    const c = this.contacts.get(contact);
    if (c) this.sealTo(c.pubkey, c.enc, { t: "typing", on }, `t-${crypto.randomUUID()}`, true);
  }

  /** Encrypt+upload a file and send it as a media message (E2E; relay can't read it). */
  async sendMedia(
    contact: string,
    bytes: Uint8Array,
    mime: string,
    mkind: "image" | "audio" | "file",
    name?: string,
  ): Promise<StoredMessage | null> {
    const c = this.contacts.get(contact);
    if (!c) return null;
    const { blobId, key } = await encryptAndUpload(this.httpBase, bytes);
    const id = crypto.randomUUID();
    const ts = Date.now();
    const m: MediaBody = { blobId, key, mime, mkind, name };
    this.sealTo(c.pubkey, c.enc, {
      t: "media",
      id,
      enc: this.identity.encPublicKeyHex,
      sender: this.identity.name,
      relay: this.httpBase,
      ...m,
    }, id, false);
    this.sealTo(this.identity.publicKeyHex, this.identity.encPublicKeyHex, {
      t: "cmedia",
      id,
      to: c.pubkey,
      toName: c.name,
      toEnc: c.enc,
      ...m,
    }, `cmedia-${id}`, false);
    const msg: StoredMessage = {
      id,
      contact,
      from: this.identity.publicKeyHex,
      text: "",
      ts,
      mine: true,
      status: "sent",
      media: { ...m },
    };
    this.seen.add(id);
    // Cache my own outgoing media locally so it persists without re-download.
    await this.store.cacheMedia(blobId, bytes, mime);
    await this.store.addMessage(msg);
    this.events.onMessage(contact, msg);
    return msg;
  }

  /** Media bytes for rendering — from the on-device cache, else download+cache. */
  async fetchMedia(media: MediaRef): Promise<Uint8Array> {
    const cached = await this.store.getCachedMedia(media.blobId);
    if (cached) return cached;
    const bytes = await downloadAndDecrypt(this.httpBase, media.blobId, media.key);
    await this.store.cacheMedia(media.blobId, bytes, media.mime);
    return bytes;
  }

  /** Edit one of MY messages; propagates to the peer and my other devices. */
  async editText(contact: string, targetId: string, newText: string): Promise<void> {
    const c = this.contacts.get(contact);
    if (!c) return;
    this.emitOp(c, { t: "edit", targetId, text: newText }, `edit-${targetId}`);
    await this.store.editStoredMessage(targetId, newText);
    await this.emitUpdated(targetId);
  }

  /** Delete for everyone (author only) — peer + my devices tombstone it. */
  async deleteForEveryone(contact: string, targetId: string): Promise<void> {
    const c = this.contacts.get(contact);
    if (!c) return;
    this.emitOp(c, { t: "del", targetId }, `del-${targetId}`);
    await this.store.tombstoneStoredMessage(targetId);
    await this.emitUpdated(targetId);
  }

  /** Delete for me — local only. */
  async deleteForMe(contact: string, targetId: string): Promise<void> {
    await this.store.removeStoredMessage(targetId);
    this.events.onMessageRemoved(contact, targetId);
  }

  /** Toggle an emoji reaction on any message (mine or theirs). */
  async react(contact: string, targetId: string, emoji: string): Promise<void> {
    const c = this.contacts.get(contact);
    const m = await this.store.getMessage(targetId);
    if (!c || !m) return;
    const remove = (m.reactions?.[emoji] ?? []).includes(this.identity.publicKeyHex);
    this.emitOp(c, { t: "react", targetId, emoji, remove }, `react-${targetId}-${emoji}`);
    await this.store.applyReaction(targetId, emoji, this.identity.publicKeyHex, remove);
    await this.emitUpdated(targetId);
  }

  // Send an op to the peer AND carbon it to my own account inbox (other devices).
  private emitOp(c: StoredContact, body: Body, tag: string): void {
    this.sealTo(c.pubkey, c.enc, body, `${tag}-${crypto.randomUUID()}`, false);
    this.sealTo(
      this.identity.publicKeyHex,
      this.identity.encPublicKeyHex,
      body,
      `${tag}-carbon-${crypto.randomUUID()}`,
      false,
    );
  }

  private async emitUpdated(id: string): Promise<void> {
    const m = await this.store.getMessage(id);
    if (m) this.events.onMessageUpdated(m.contact, m);
  }

  async markRead(contact: string): Promise<void> {
    const set = this.unread.get(contact);
    const c = this.contacts.get(contact);
    if (!set || !c) return;
    for (const id of set) this.sealTo(c.pubkey, c.enc, { t: "rcpt", id, state: "read" }, `r-${id}-read`, false);
    this.unread.delete(contact);
  }

  leave(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.endCall("ended");
    this.inbox.leave();
    this.socket.disconnect();
  }

  // --- calls -------------------------------------------------------

  async startCall(contact: string, video: boolean): Promise<void> {
    const c = this.contacts.get(contact);
    if (!c || this.call) return;
    const callId = crypto.randomUUID();
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    const pc = this.newCallPc(c.pubkey, c.enc, callId, localStream);
    this.call = { callId, contact, pc, pendingIce: [], localStream };
    this.events.onLocalStream(localStream);
    this.events.onCallState("calling");

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sealTo(c.pubkey, c.enc, {
      t: "call-offer",
      callId,
      sdp: offer.sdp!,
      video,
      enc: this.identity.encPublicKeyHex,
      name: this.identity.name,
      relay: this.httpBase,
    }, `offer-${callId}`, true);
  }

  async acceptCall(callId: string): Promise<void> {
    const po = this.pendingOffer;
    if (!po || po.callId !== callId) return;
    this.pendingOffer = null;
    const c = this.contacts.get(po.contact)!;
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: po.video });
    const pc = this.newCallPc(c.pubkey, c.enc, callId, localStream);
    this.call = { callId, contact: po.contact, pc, pendingIce: [...po.ice], localStream };
    this.events.onLocalStream(localStream);
    this.events.onCallState("connecting");

    await pc.setRemoteDescription({ type: "offer", sdp: po.sdp });
    await this.flushCallIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sealTo(c.pubkey, c.enc, { t: "call-answer", callId, sdp: answer.sdp! }, `ans-${callId}`, true);
  }

  declineCall(callId: string): void {
    const po = this.pendingOffer;
    if (po && po.callId === callId) {
      this.sealTo(po.contact, po.enc, { t: "call-decline", callId }, `dec-${callId}`, true);
      this.pendingOffer = null;
      this.events.onCallState("ended", "declined");
    }
  }

  hangup(): void {
    if (this.call) {
      const c = this.contacts.get(this.call.contact);
      if (c) this.sealTo(c.pubkey, c.enc, { t: "call-hangup", callId: this.call.callId }, `hup-${this.call.callId}`, true);
      this.endCall("ended");
    } else if (this.pendingOffer) {
      this.declineCall(this.pendingOffer.callId);
    }
  }

  private newCallPc(
    pubkey: string,
    enc: string,
    callId: string,
    localStream: MediaStream,
  ): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sealTo(pubkey, enc, { t: "call-ice", callId, candidate: e.candidate.toJSON() },
          `ice-${callId}-${crypto.randomUUID()}`, true);
      }
    };
    pc.ontrack = (e) => this.events.onRemoteStream(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.events.onCallState("connected");
      else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.endCall("ended");
      }
    };
    return pc;
  }

  private async flushCallIce(): Promise<void> {
    if (!this.call) return;
    for (const cand of this.call.pendingIce.splice(0)) {
      await this.call.pc.addIceCandidate(cand).catch(() => {});
    }
  }

  private endCall(reason: string): void {
    if (this.call) {
      this.call.localStream.getTracks().forEach((t) => t.stop());
      this.call.pc.close();
      this.call = null;
      this.events.onLocalStream(null);
      this.events.onRemoteStream(null);
      this.events.onCallState("ended", reason);
    }
    this.pendingOffer = null;
  }

  // --- inbound -----------------------------------------------------

  private async handleEnvelope(env: SealedEnvelope): Promise<void> {
    let opened;
    try {
      opened = open<Body>(this.identity.encPrivateKey, this.identity.encPublicKeyHex, env);
    } catch {
      console.warn("dropped an unreadable/forged message");
      return;
    }

    const from = opened.from;
    const body = opened.body;

    switch (body.t) {
      case "msg":
        return this.onMsg(from, body, opened.ts);
      case "carbon":
        return this.onCarbon(from, body, opened.ts);
      case "media":
        return this.onMedia(from, body, opened.ts);
      case "cmedia":
        return this.onCarbonMedia(from, body, opened.ts);
      case "edit":
        return this.onEditOp(from, body);
      case "del":
        return this.onDelOp(from, body);
      case "react":
        return this.onReactOp(from, body);
      case "rcpt":
        await this.store.setMessageStatus(body.id, body.state);
        return this.events.onReceipt(from, body.id, body.state);
      case "typing":
        return this.events.onTyping(from, body.on);
      case "call-offer":
        return this.onCallOffer(from, body);
      case "call-answer":
        return this.onCallAnswer(body);
      case "call-ice":
        return this.onCallIce(body);
      case "call-decline":
        return this.endCall("declined");
      case "call-hangup":
        return this.endCall("ended");
    }
  }

  private async onMsg(
    from: string,
    body: Extract<Body, { t: "msg" }>,
    ts: number,
  ): Promise<void> {
    await this.ensureContact(from, body.enc, body.name, body.relay);
    if (this.seen.has(body.id)) return;
    this.seen.add(body.id);

    const msg: StoredMessage = {
      id: body.id,
      contact: from,
      from,
      text: body.text,
      ts,
      mine: false,
      replyTo: body.replyTo,
    };
    await this.store.addMessage(msg);
    this.events.onMessage(from, msg);
    this.afterReceive(from, body.id);
  }

  private async onMedia(from: string, body: Extract<Body, { t: "media" }>, ts: number): Promise<void> {
    await this.ensureContact(from, body.enc, body.sender, body.relay);
    if (this.seen.has(body.id)) return;
    this.seen.add(body.id);
    const msg: StoredMessage = {
      id: body.id,
      contact: from,
      from,
      text: "",
      ts,
      mine: false,
      media: { blobId: body.blobId, key: body.key, mime: body.mime, mkind: body.mkind, name: body.name },
    };
    await this.store.addMessage(msg);
    this.events.onMessage(from, msg);
    this.afterReceive(from, body.id);
  }

  private async onCarbonMedia(
    from: string,
    body: Extract<Body, { t: "cmedia" }>,
    ts: number,
  ): Promise<void> {
    if (from !== this.identity.publicKeyHex) return;
    await this.ensureContact(body.to, body.toEnc, body.toName);
    if (this.seen.has(body.id)) return;
    this.seen.add(body.id);
    const msg: StoredMessage = {
      id: body.id,
      contact: body.to,
      from: this.identity.publicKeyHex,
      text: "",
      ts,
      mine: true,
      status: "sent",
      media: { blobId: body.blobId, key: body.key, mime: body.mime, mkind: body.mkind, name: body.name },
    };
    await this.store.addMessage(msg);
    this.events.onMessage(body.to, msg);
  }

  // Send a delivered receipt, track unread, and read-if-focused.
  private afterReceive(from: string, id: string): void {
    this.sealTo(from, this.contacts.get(from)!.enc, { t: "rcpt", id, state: "delivered" },
      `r-${id}-delivered`, false);
    const set = this.unread.get(from) ?? new Set<string>();
    set.add(id);
    this.unread.set(from, set);
    if (this.active === from && typeof document !== "undefined" && document.hasFocus()) {
      void this.markRead(from);
    }
  }

  // A carbon of a message I sent from another device → show it here as "sent".
  private async onCarbon(
    from: string,
    body: Extract<Body, { t: "carbon" }>,
    ts: number,
  ): Promise<void> {
    if (from !== this.identity.publicKeyHex) return; // only accept my own carbons
    await this.ensureContact(body.to, body.toEnc, body.toName);
    if (this.seen.has(body.id)) return; // e.g. the sending device's own echo
    this.seen.add(body.id);
    const msg: StoredMessage = {
      id: body.id,
      contact: body.to,
      from: this.identity.publicKeyHex,
      text: body.text,
      ts,
      mine: true,
      status: "sent",
      replyTo: body.replyTo,
    };
    await this.store.addMessage(msg);
    this.events.onMessage(body.to, msg);
  }

  private async onEditOp(from: string, body: Extract<Body, { t: "edit" }>): Promise<void> {
    const target = await this.store.getMessage(body.targetId);
    if (!target || target.from !== from) return; // orphan, or not the author
    await this.store.editStoredMessage(body.targetId, body.text);
    await this.emitUpdated(body.targetId);
  }

  private async onDelOp(from: string, body: Extract<Body, { t: "del" }>): Promise<void> {
    const target = await this.store.getMessage(body.targetId);
    if (!target || target.from !== from) return; // only the author can delete for all
    await this.store.tombstoneStoredMessage(body.targetId);
    await this.emitUpdated(body.targetId);
  }

  private async onReactOp(from: string, body: Extract<Body, { t: "react" }>): Promise<void> {
    // reactor is the op's signed sender; anyone in the conversation may react.
    if (await this.store.applyReaction(body.targetId, body.emoji, from, body.remove)) {
      await this.emitUpdated(body.targetId);
    }
  }

  private async onCallOffer(from: string, body: Extract<Body, { t: "call-offer" }>): Promise<void> {
    await this.ensureContact(from, body.enc, body.name, body.relay);
    if (this.call || this.pendingOffer) {
      this.sealTo(from, body.enc, { t: "call-decline", callId: body.callId }, `dec-${body.callId}`, true);
      return;
    }
    this.pendingOffer = {
      callId: body.callId,
      contact: from,
      sdp: body.sdp,
      video: body.video,
      enc: body.enc,
      ice: [],
    };
    this.events.onCallState("ringing");
    this.events.onIncomingCall(from, this.contacts.get(from)!.name, body.callId, body.video);
  }

  private async onCallAnswer(body: Extract<Body, { t: "call-answer" }>): Promise<void> {
    if (!this.call || this.call.callId !== body.callId) return;
    await this.call.pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
    await this.flushCallIce();
    this.events.onCallState("connecting");
  }

  private async onCallIce(body: Extract<Body, { t: "call-ice" }>): Promise<void> {
    if (this.call && this.call.callId === body.callId) {
      if (this.call.pc.remoteDescription) {
        await this.call.pc.addIceCandidate(body.candidate).catch(() => {});
      } else {
        this.call.pendingIce.push(body.candidate);
      }
    } else if (this.pendingOffer && this.pendingOffer.callId === body.callId) {
      this.pendingOffer.ice.push(body.candidate); // buffer until accepted
    }
  }

  // --- helpers -----------------------------------------------------

  private sealTo(pubkey: string, enc: string, body: Body, id: string, ephemeral: boolean): void {
    const envelope = seal(this.identity.privateKey, this.identity.publicKeyHex, enc, body, Date.now());
    // The recipient's home-relay hint (if on another server) so our relay can
    // forward there. Absent/same-relay ⇒ delivered locally.
    const relay = this.contacts.get(pubkey)?.relay;
    this.inbox.push(EVENTS.send, { to: pubkey, envelope, id, ephemeral, relay });
  }

  private async ensureContact(
    pubkey: string,
    enc: string,
    name?: string,
    relay?: string,
  ): Promise<void> {
    const existing = this.contacts.get(pubkey);
    if (existing && existing.enc === enc && existing.name && (!relay || existing.relay === relay)) {
      return;
    }
    const contact: StoredContact = {
      pubkey,
      enc,
      name: name || existing?.name || short(pubkey),
      relay: relay || existing?.relay,
      addedAt: existing?.addedAt ?? Date.now(),
    };
    this.contacts.set(pubkey, contact);
    await this.store.upsertContact(contact);
    this.events.onContact(contact);
    this.queryPresence([pubkey]);
  }
}
