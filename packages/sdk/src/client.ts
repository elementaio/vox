import { open, seal, type SealedEnvelope } from "./crypto";
import { downloadAndDecrypt, encryptAndUpload } from "./blobs";
import type { Identity } from "./identity";
import { randomId } from "./util";
import { PhoenixTransport, type Transport } from "./transport";
import type {
  Body,
  ClientEvents,
  MediaBody,
  MediaRef,
  RosterEntry,
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
  socketUrl: string; // ws(s)://relay/socket (used to build the default PhoenixTransport)
  httpBase: string; // http(s)://relay (for /config, /blobs, relay hints)
  identity: Identity;
  store: Store;
  events: ClientEvents;
  deviceId: string; // stable per-device id (for the delivery cursor)
  transport?: Transport; // override the messaging backend (default: relay over Phoenix)
}

interface ActiveCall {
  callId: string;
  contact: string;
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  localStream: MediaStream;
}

/** One remote leg of a group call (mesh: one peer connection per participant). */
interface RoomPeer {
  pubkey: string;
  pc: RTCPeerConnection;
  fwded: Set<string>; // origin pubkeys already relayed onto this peer's PC
  negotiating: boolean; // a (re)negotiation offer of mine is in flight
  renegPending: boolean; // more tracks were added while negotiating → renegotiate after
  renegTimer: ReturnType<typeof setTimeout> | null; // debounce: coalesce a burst of addTrack into ONE offer
  polite: boolean; // perfect negotiation: on a glare, the polite peer yields
  makingOffer: boolean; // I'm mid-way creating an offer to this peer
  // Forwarder side only: one stable send-slot PER origin I relay to this peer.
  pool: PeerPool | null;
}

/** One relay slot: a fixed stream whose id is the call-fwd attribution key, and the
 *  audio/video transceivers bound to it. The slot is added the first time an origin
 *  is relayed (already carrying its track, so a small initial offer stays small and
 *  connections form as reliably as the mesh path); if that origin later churns, its
 *  slot is reused via replaceTrack — the m-line order and stream id never move. */
interface PoolSlot {
  rs: MediaStream;
  v: RTCRtpTransceiver;
  a: RTCRtpTransceiver;
}
interface PeerPool {
  byOrigin: Map<string, PoolSlot>;
}

/**
 * A group call is a mesh of 1:1 legs sharing a callId. `dir` is the participant
 * directory (how to reach + name each), so people who aren't each other's
 * contacts can still connect. Rule that avoids glare: for each pair, the LOWER
 * pubkey is the offerer (see onCallJoin); the other only answers.
 */
interface GroupCall {
  callId: string;
  video: boolean;
  localStream: MediaStream;
  peers: Map<string, RoomPeer>;
  dir: Map<string, { enc: string; name: string; relay?: string }>;
  pendingIce: Map<string, RTCIceCandidateInit[]>;
  // Empty = mesh. One = single SFU. Many = a CASCADE: the forwarders mesh among
  // themselves and each serves a cluster of participants.
  forwarders: string[];
  // Participant side: which forwarder I attach to (undefined if I'm a forwarder / mesh).
  myForwarder?: string;
  // Forwarder side: every participant's media I know, keyed by ORIGIN pubkey.
  // `local` = one of MY cluster → relay to peer forwarders too; else remote (came
  // from a peer forwarder) → relay only to my own locals, never back (no loops).
  origins: Map<string, { stream: MediaStream; name: string; local: boolean }>;
  // streamId → origin attribution (from call-fwd), + streams buffered until it lands.
  fwd: Map<string, { from: string; name: string }>;
  pending: Map<string, MediaStream>;
}

/** Above this many participants, a group call elects a forwarder instead of meshing. */
const MESH_MAX = 4;
// A forwarder waits this long after the first added track before offering, so a
// burst of origins (a late joiner receiving everyone, or many people joining at
// once) folds into a single SDP exchange rather than one round-trip per origin.
const RENEG_COALESCE_MS = 80;

const short = (id: string) => id.slice(0, 6);

export class Client {
  private transport: Transport;
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
  private room: GroupCall | null = null;
  // Joins that arrived before we entered the room for their callId — replayed
  // when beginGroupRoom completes (closes the forwarder-mesh race where a peer
  // forwarder's join reaches us before we've begun).
  private earlyJoins = new Map<string, { from: string; body: Extract<Body, { t: "call-join" }> }[]>();
  private pendingInvite:
    | { callId: string; from: string; name: string; video: boolean; roster: RosterEntry[]; forwarder?: string; forwarders?: string[]; callerEnc: string; callerRelay?: string }
    | null = null;
  // Initiator: host-offers out to co-forwarders; ring participants once all ack.
  private pendingStart:
    | { callId: string; video: boolean; roster: RosterEntry[]; forwarders: string[]; assign: Map<string, string>; awaiting: Set<string> }
    | null = null;

  constructor(cfg: ClientConfig) {
    this.identity = cfg.identity;
    this.store = cfg.store;
    this.events = cfg.events;
    this.httpBase = cfg.httpBase;
    this.transport = cfg.transport ?? new PhoenixTransport(cfg.socketUrl, cfg.identity, cfg.deviceId);
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

    this.transport.connect({
      onEnvelope: (env) => this.handleEnvelope(env),
      onStatus: (s) => this.events.onStatus(s),
      onReady: () => {
        this.pollPresence();
        this.presenceTimer = setInterval(() => this.pollPresence(), 20000);
      },
    });
  }

  /** Ask who's online / last-seen for the given contacts (via the transport). */
  queryPresence(pubkeys: string[]): void {
    if (pubkeys.length === 0) return;
    this.transport.queryPresence(pubkeys, (rows) => {
      for (const r of rows) this.events.onPresence(r.pubkey, { online: r.online, lastSeen: r.lastSeen });
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
    const id = randomId();
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
    if (c) this.sealTo(c.pubkey, c.enc, { t: "typing", on }, `t-${randomId()}`, true);
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
    const id = randomId();
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
    this.sealTo(c.pubkey, c.enc, body, `${tag}-${randomId()}`, false);
    this.sealTo(
      this.identity.publicKeyHex,
      this.identity.encPublicKeyHex,
      body,
      `${tag}-carbon-${randomId()}`,
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
    if (this.room) this.endRoom("ended");
    this.transport.leave();
  }

  // --- calls -------------------------------------------------------

  async startCall(contact: string, video: boolean): Promise<void> {
    const c = this.contacts.get(contact);
    if (!c || this.call || this.room) return;
    const callId = randomId();
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
    if (this.pendingInvite && this.pendingInvite.callId === callId) return this.acceptInvite();
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
      return;
    }
    const inv = this.pendingInvite;
    if (inv && inv.callId === callId) {
      this.sealPeer(inv.from, inv.callerEnc, inv.callerRelay, { t: "call-decline", callId }, `dec-${callId}`, true);
      this.pendingInvite = null;
      this.events.onCallState("ended", "declined");
    }
  }

  hangup(): void {
    if (this.call) {
      const c = this.contacts.get(this.call.contact);
      if (c) this.sealTo(c.pubkey, c.enc, { t: "call-hangup", callId: this.call.callId }, `hup-${this.call.callId}`, true);
      this.endCall("ended");
    } else if (this.room) {
      this.endRoom("ended");
    } else if (this.pendingInvite) {
      const inv = this.pendingInvite;
      this.sealPeer(inv.from, inv.callerEnc, inv.callerRelay, { t: "call-decline", callId: inv.callId }, `dec-${inv.callId}`, true);
      this.pendingInvite = null;
      this.events.onCallState("ended", "declined");
    } else if (this.pendingStart) {
      this.pendingStart = null;
      this.events.onCallState("ended");
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
          `ice-${callId}-${randomId()}`, true);
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

  // --- group calls (mesh) ------------------------------------------
  //
  // A group call is a mesh of 1:1 legs sharing one callId, coordinated entirely
  // over the sealed inbox — no relay changes. The ring (`call-invite`) carries a
  // roster directory so participants who aren't each other's contacts can still
  // connect. Glare is avoided deterministically: for each pair the LOWER pubkey
  // offers (a `call-join` from the higher peer triggers the offer; a higher peer
  // receiving a join answers with a join-back so the lower one offers). Verified
  // with a 3-peer live mesh test. Larger calls will later elect a forwarder (SFU)
  // instead of full mesh — same signaling.

  /**
   * Start a group call. Small calls mesh; larger ones (or when `opts.forward` is
   * set) elect a FORWARDER everyone routes through. If the forwarder is someone
   * else, we offer them the role first and only ring once they accept.
   */
  async startGroupCall(
    contacts: string[],
    video: boolean,
    opts?: { forward?: boolean; forwarder?: string; forwarders?: string[] },
  ): Promise<void> {
    if (this.call || this.room || this.pendingStart) return;
    const invitees = contacts
      .map((pk) => this.contacts.get(pk))
      .filter((c): c is StoredContact => !!c);
    if (invitees.length === 0) return;

    const me = this.identity.publicKeyHex;
    const callId = randomId();
    const roster: RosterEntry[] = [
      { pk: me, enc: this.identity.encPublicKeyHex, name: this.identity.name, relay: this.httpBase },
      ...invitees.map((c) => ({ pk: c.pubkey, enc: c.enc, name: c.name, relay: c.relay })),
    ];

    // Forwarder set: explicit list wins; else a single forwarder (named or me) when
    // asked / when the call is too big; else mesh.
    let forwarders: string[] = [];
    if (opts?.forwarders?.length) forwarders = [...opts.forwarders];
    else if (opts?.forwarder) forwarders = [opts.forwarder];
    else if (opts?.forward || roster.length > MESH_MAX) forwarders = [me];

    if (forwarders.length === 0) {
      await this.beginGroupRoom(callId, video, roster, [], undefined, true); // mesh
      return;
    }

    // Assign each non-forwarder participant to a forwarder (round-robin).
    const assign = new Map<string, string>();
    let i = 0;
    for (const r of roster) {
      if (!forwarders.includes(r.pk)) assign.set(r.pk, forwarders[i++ % forwarders.length]);
    }

    // Co-forwarders (all but me) must accept the host role before we ring.
    const coForwarders = forwarders.filter((f) => f !== me);
    if (coForwarders.length === 0) {
      await this.beginGroupRoom(callId, video, roster, forwarders, undefined, true, assign);
      return;
    }
    this.pendingStart = { callId, video, roster, forwarders, assign, awaiting: new Set(coForwarders) };
    this.events.onCallState("calling");
    for (const f of coForwarders) {
      const c = invitees.find((x) => x.pubkey === f);
      if (c) this.sealPeer(c.pubkey, c.enc, c.relay, { t: "call-host-offer", callId, video, roster, forwarders }, `hostoff-${callId}-${f}`, true);
    }
  }

  /**
   * Build my room and optionally ring the others. `forwarders` empty = mesh; one =
   * single SFU; many = a cascade. If I'm in `forwarders` I'm a host (connect to peer
   * forwarders, await participant joins); if `myForwarder` is set I'm a participant
   * (join only that host); a mesh joiner joins everyone.
   */
  private async beginGroupRoom(
    callId: string,
    video: boolean,
    roster: RosterEntry[],
    forwarders: string[],
    myForwarder: string | undefined,
    ring: boolean,
    assign?: Map<string, string>,
  ): Promise<void> {
    const me = this.identity.publicKeyHex;
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    const dir = new Map<string, { enc: string; name: string; relay?: string }>();
    for (const r of roster) if (r.pk !== me) dir.set(r.pk, { enc: r.enc, name: r.name, relay: r.relay });
    this.room = {
      callId, video, localStream, peers: new Map(), dir, pendingIce: new Map(),
      forwarders, myForwarder, origins: new Map(), fwd: new Map(), pending: new Map(),
    };
    this.events.onLocalStream(localStream);
    this.events.onCallState(ring ? "calling" : "connecting");
    const amForwarder = forwarders.includes(me);

    const join = (pk: string) => {
      const info = dir.get(pk);
      if (info) this.sealPeer(pk, info.enc, info.relay, { t: "call-join", callId, enc: this.identity.encPublicKeyHex, name: this.identity.name, relay: this.httpBase }, `join-${callId}-${pk}-${randomId()}`, true);
    };

    if (ring) {
      // Ring each participant with their assigned host + the full set. Forwarders
      // aren't rung (they were host-offered).
      for (const r of roster) {
        if (r.pk === me || forwarders.includes(r.pk)) continue;
        this.sealPeer(r.pk, r.enc, r.relay, { t: "call-invite", callId, video, roster, forwarder: assign?.get(r.pk), forwarders }, `inv-${callId}-${r.pk}`, true);
      }
    }

    if (amForwarder) {
      for (const f of forwarders) if (f !== me) join(f); // mesh among forwarders (glare picks offerer)
    } else if (myForwarder) {
      join(myForwarder); // star/cascade participant → attach to my host only
    } else if (forwarders.length === 0 && !ring) {
      for (const pk of dir.keys()) join(pk); // mesh joiner
    }

    // Replay any joins that reached us before this room existed.
    const buffered = this.earlyJoins.get(callId);
    if (buffered) {
      this.earlyJoins.delete(callId);
      for (const { from, body } of buffered) void this.onCallJoin(from, body);
    }
  }

  /** Accept a group invite: set up my room (star/cascade → join my host; mesh → all). */
  private async acceptInvite(): Promise<void> {
    const inv = this.pendingInvite!;
    this.pendingInvite = null;
    const forwarders = inv.forwarders ?? (inv.forwarder ? [inv.forwarder] : []);
    const amForwarder = forwarders.includes(this.identity.publicKeyHex);
    await this.beginGroupRoom(inv.callId, inv.video, inv.roster, forwarders, amForwarder ? undefined : inv.forwarder, false);
  }

  /** Offer to a peer (used by the forwarder for each joiner, and by the mesh rule). */
  private async offerTo(pk: string): Promise<void> {
    const room = this.room!;
    const info = room.dir.get(pk)!;
    const pc = this.newPeerPc(pk);
    const peer = room.peers.get(pk)!;
    peer.negotiating = true; // serialize (re)negotiations to this peer
    // As a forwarder, my own media rides this first offer → attribute it to me.
    if (room.forwarders.includes(this.identity.publicKeyHex)) {
      peer.fwded.add(this.identity.publicKeyHex);
      this.sealPeer(pk, info.enc, info.relay, {
        t: "call-fwd", callId: room.callId, streamId: room.localStream.id,
        from: this.identity.publicKeyHex, name: this.identity.name,
      }, `fwdself-${room.callId}-${pk}`, true);
    }
    peer.makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    peer.makingOffer = false;
    this.sealPeer(pk, info.enc, info.relay, {
      t: "call-offer", callId: room.callId, sdp: offer.sdp!, video: room.video,
      enc: this.identity.encPublicKeyHex, name: this.identity.name,
    }, `offer-${room.callId}-${pk}`, true);
  }

  private newPeerPc(pk: string): RTCPeerConnection {
    const room = this.room!;
    const info = room.dir.get(pk)!;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    for (const track of room.localStream.getTracks()) pc.addTrack(track, room.localStream);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sealPeer(pk, info.enc, info.relay, { t: "call-ice", callId: room.callId, candidate: e.candidate.toJSON() },
          `ice-${room.callId}-${pk}-${randomId()}`, true);
      }
    };
    pc.ontrack = (e) => this.onTrackFrom(pk, e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.events.onCallState("connected");
      else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.dropPeer(pk);
    };
    // Forwarders keep a per-origin slot map (populated lazily, on first relay), so
    // the initial offer carries only my own media — a small offer that connects as
    // reliably as the mesh path, unlike a big pre-negotiated empty pool.
    const pool: PeerPool | null =
      room.forwarders.includes(this.identity.publicKeyHex) ? { byOrigin: new Map() } : null;
    room.peers.set(pk, {
      pubkey: pk, pc, fwded: new Set(), negotiating: false, renegPending: false,
      renegTimer: null,
      polite: this.identity.publicKeyHex > pk, // higher pubkey yields on a glare
      makingOffer: false,
      pool,
    });
    return pc;
  }


  /** A relay slot for `origin`, added ACTIVE (transceivers already carry the tracks)
   *  so the m-line negotiates on straight away — no empty-then-activate two-step. */
  private newPoolSlot(pc: RTCPeerConnection, stream: MediaStream): PoolSlot {
    const rs = new MediaStream();
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];
    return {
      rs,
      v: vt ? pc.addTransceiver(vt, { direction: "sendonly", streams: [rs] })
            : pc.addTransceiver("video", { direction: "sendonly", streams: [rs] }),
      a: at ? pc.addTransceiver(at, { direction: "sendonly", streams: [rs] })
            : pc.addTransceiver("audio", { direction: "sendonly", streams: [rs] }),
    };
  }

  /**
   * A stream arrived on a peer connection. Cases:
   *  - forwarder, from a local participant → origin is that peer (mine to relay).
   *  - forwarder, from a peer forwarder → origin comes from its call-fwd (relay to
   *    my locals only — never back to forwarders, so no loops).
   *  - star/cascade participant → attribute via the host's call-fwd.
   *  - mesh → the stream is from `pk` directly.
   */
  private onTrackFrom(pk: string, stream: MediaStream): void {
    const room = this.room;
    if (!room) return;
    const me = this.identity.publicKeyHex;
    const name = room.dir.get(pk)?.name ?? pk.slice(0, 6);

    if (room.forwarders.includes(me)) {
      if (room.forwarders.includes(pk)) {
        const attr = room.fwd.get(stream.id); // relayed from a peer forwarder
        if (!attr) room.pending.set(stream.id, stream); // wait for its call-fwd
        else this.learnOrigin(attr.from, attr.name, stream, false);
      } else {
        this.learnOrigin(pk, name, stream, true); // my own local participant
      }
      return;
    }

    if (room.myForwarder) {
      const attr = room.fwd.get(stream.id);
      if (attr) this.events.onPeerStream(attr.from, attr.name, stream);
      else room.pending.set(stream.id, stream); // wait for its call-fwd
      return;
    }

    this.events.onPeerStream(pk, name, stream); // mesh
  }

  /** Forwarder: record an origin's media and fan it out to everyone who should see it. */
  private learnOrigin(origin: string, name: string, stream: MediaStream, local: boolean): void {
    const room = this.room;
    if (!room || origin === this.identity.publicKeyHex) return; // my own rides PCs directly
    room.origins.set(origin, { stream, name, local });
    this.events.onPeerStream(origin, name, stream); // I (the forwarder) see the origin
    for (const peer of room.peers.values()) this.pushOrigin(peer, origin);
    // If the origin is one of my local participants, it just connected as a
    // destination too → give it every other origin I already hold.
    if (local && room.peers.has(origin)) {
      const dest = room.peers.get(origin)!;
      for (const o of room.origins.keys()) if (o !== origin) this.pushOrigin(dest, o);
    }
  }

  /** Put `origin`'s media onto `peer`'s connection (with attribution).
   * Local origins go to everyone; remote origins never go back to a forwarder (loops). */
  private pushOrigin(peer: RoomPeer, origin: string): void {
    const room = this.room;
    if (!room || peer.pubkey === origin || peer.fwded.has(origin)) return;
    const o = room.origins.get(origin);
    if (!o) return;
    if (room.forwarders.includes(peer.pubkey) && !o.local) return; // don't loop remote origins
    peer.fwded.add(origin);
    const info = room.dir.get(peer.pubkey)!;

    if (peer.pool) {
      let slot = peer.pool.byOrigin.get(origin);
      if (slot) {
        // Reuse this origin's slot (it churned): swap tracks, m-line stays put.
        void slot.v.sender.replaceTrack(o.stream.getVideoTracks()[0] ?? null);
        void slot.a.sender.replaceTrack(o.stream.getAudioTracks()[0] ?? null);
      } else {
        slot = this.newPoolSlot(peer.pc, o.stream); // added active → one negotiation
        peer.pool.byOrigin.set(origin, slot);
      }
      this.sealPeer(peer.pubkey, info.enc, info.relay, {
        t: "call-fwd", callId: room.callId, streamId: slot.rs.id, from: origin, name: o.name,
      }, `fwd-${room.callId}-${peer.pubkey}-${origin}`, true);
      this.scheduleReneg(peer);
      return;
    }

    // Mesh / non-forwarder fallback: direct addTrack + renegotiate per origin.
    for (const track of o.stream.getTracks()) peer.pc.addTrack(track, o.stream);
    this.sealPeer(peer.pubkey, info.enc, info.relay, {
      t: "call-fwd", callId: room.callId, streamId: o.stream.id, from: origin, name: o.name,
    }, `fwd-${room.callId}-${peer.pubkey}-${origin}`, true);
    this.scheduleReneg(peer);
  }

  // Coalesce renegotiations: several origins added to a peer in the same tick (or
  // within RENEG_COALESCE_MS) fold into ONE offer instead of a serial round-trip
  // each. This is what makes a forwarder scale to tens of participants — a late
  // joiner receives everyone in a single exchange, and a burst of simultaneous
  // joins is batched per peer.
  private scheduleReneg(peer: RoomPeer): void {
    if (peer.renegTimer) return;
    peer.renegTimer = setTimeout(() => {
      peer.renegTimer = null;
      void this.renegotiate(peer);
    }, RENEG_COALESCE_MS);
  }

  /** Send a fresh offer to a peer (serialized so we never have two offers in flight). */
  private async renegotiate(peer: RoomPeer): Promise<void> {
    const room = this.room;
    if (!room) return;
    // Defer if a negotiation of ours is already in flight OR the connection is
    // mid-inbound-offer (`have-remote-offer`): calling setLocalDescription(offer)
    // then is an illegal-state crash. Only offer from a `stable` connection —
    // the missing half of perfect negotiation on the multi-forwarder path.
    if (peer.negotiating || peer.pc.signalingState !== "stable") {
      peer.renegPending = true;
      return;
    }
    peer.negotiating = true;
    peer.makingOffer = true;
    const info = room.dir.get(peer.pubkey)!;
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    peer.makingOffer = false;
    this.sealPeer(peer.pubkey, info.enc, info.relay, {
      t: "call-offer", callId: room.callId, sdp: offer.sdp!, video: room.video,
      enc: this.identity.encPublicKeyHex, name: this.identity.name,
    }, `reneg-${room.callId}-${peer.pubkey}-${randomId()}`, true);
  }

  private async drainPeerIce(pk: string): Promise<void> {
    const room = this.room;
    const peer = room?.peers.get(pk);
    if (!room || !peer) return;
    const pending = room.pendingIce.get(pk);
    if (!pending) return;
    room.pendingIce.delete(pk);
    for (const cand of pending) await peer.pc.addIceCandidate(cand).catch(() => {});
  }

  private dropPeer(pk: string): void {
    const room = this.room;
    if (!room) return;
    const dp = room.peers.get(pk);
    if (dp?.renegTimer) clearTimeout(dp.renegTimer);
    dp?.pc.close();
    room.peers.delete(pk);
    room.pendingIce.delete(pk);
    this.events.onPeerStream(pk, "", null);
  }

  private endRoom(reason: string): void {
    const room = this.room;
    if (!room) return;
    for (const [pk, info] of room.dir) {
      this.sealPeer(pk, info.enc, info.relay, { t: "call-leave", callId: room.callId }, `lv-${room.callId}-${pk}`, true);
    }
    for (const peer of room.peers.values()) peer.pc.close();
    room.localStream.getTracks().forEach((t) => t.stop());
    this.room = null;
    this.events.onLocalStream(null);
    this.events.onCallState("ended", reason);
  }

  private async onCallInvite(from: string, body: Extract<Body, { t: "call-invite" }>): Promise<void> {
    const caller = body.roster.find((r) => r.pk === from);
    if (this.call || this.room || this.pendingOffer || this.pendingInvite || this.pendingStart) {
      if (caller) this.sealPeer(from, caller.enc, caller.relay, { t: "call-decline", callId: body.callId }, `dec-${body.callId}`, true);
      return;
    }
    this.pendingInvite = {
      callId: body.callId,
      from,
      name: caller?.name ?? from.slice(0, 6),
      video: body.video,
      roster: body.roster,
      forwarder: body.forwarder,
      forwarders: body.forwarders,
      callerEnc: caller?.enc ?? "",
      callerRelay: caller?.relay,
    };
    this.events.onCallState("ringing");
    this.events.onIncomingCall(from, this.pendingInvite.name, body.callId, body.video, body.roster.map((r) => r.pk));
  }

  private async onCallHostOffer(from: string, body: Extract<Body, { t: "call-host-offer" }>): Promise<void> {
    const caller = body.roster.find((r) => r.pk === from);
    const busy = this.call || this.room || this.pendingOffer || this.pendingInvite || this.pendingStart;
    // "Offered, not forced": v1 accepts if free (a user consent prompt is a thin
    // layer to add here); a busy node declines and the initiator hosts it itself.
    if (caller) {
      this.sealPeer(from, caller.enc, caller.relay, { t: "call-host-ack", callId: body.callId, accept: !busy }, `hostack-${body.callId}`, true);
    }
    if (busy) return;
    // I'm one of the forwarders → set up as a host (I'll mesh with peer forwarders
    // and serve my assigned participants).
    await this.beginGroupRoom(body.callId, body.video, body.roster, body.forwarders, undefined, false);
  }

  private async onCallHostAck(from: string, body: Extract<Body, { t: "call-host-ack" }>): Promise<void> {
    const ps = this.pendingStart;
    if (!ps || ps.callId !== body.callId || !ps.awaiting.has(from)) return;
    if (!body.accept) {
      // Declined → drop it from the set and reassign its participants to the rest
      // (or to me if no forwarders remain).
      ps.forwarders = ps.forwarders.filter((f) => f !== from);
      const remaining = ps.forwarders.length ? ps.forwarders : [this.identity.publicKeyHex];
      let i = 0;
      for (const [p, f] of ps.assign) if (f === from) ps.assign.set(p, remaining[i++ % remaining.length]);
    }
    ps.awaiting.delete(from);
    if (ps.awaiting.size > 0) return; // wait for the remaining co-forwarders
    this.pendingStart = null;
    const me = this.identity.publicKeyHex;
    const myFwd = ps.forwarders.includes(me) ? undefined : ps.assign.get(me);
    await this.beginGroupRoom(ps.callId, ps.video, ps.roster, ps.forwarders, myFwd, true, ps.assign);
  }

  private async onCallJoin(from: string, body: Extract<Body, { t: "call-join" }>): Promise<void> {
    const room = this.room;
    if (!room || room.callId !== body.callId) {
      // Not in this room yet: hold the join and replay it once we begin, so a
      // co-forwarder that joined us early isn't lost.
      const q = this.earlyJoins.get(body.callId) ?? [];
      if (!q.some((e) => e.from === from)) q.push({ from, body });
      this.earlyJoins.set(body.callId, q);
      return;
    }
    room.dir.set(from, { enc: body.enc, name: body.name, relay: body.relay });
    if (room.peers.has(from)) return; // already connecting/connected
    const me = this.identity.publicKeyHex;

    if (room.forwarders.includes(me)) {
      // I'm a forwarder. A peer forwarder → connect via the glare rule (lower
      // offers). A local participant → I'm their host, so I always offer.
      if (room.forwarders.includes(from)) {
        if (me < from) await this.offerTo(from);
        else this.sealPeer(from, body.enc, body.relay, { t: "call-join", callId: room.callId, enc: this.identity.encPublicKeyHex, name: this.identity.name, relay: this.httpBase }, `fjb-${room.callId}-${from}-${randomId()}`, true);
      } else {
        await this.offerTo(from);
      }
      return;
    }
    if (room.forwarders.length) return; // participant in a star/cascade → ignore joins

    // Mesh: the LOWER pubkey offers (glare-free). If that's me, offer; otherwise
    // send a join-back so THEY offer — which also repairs the race where my
    // earlier join reached them before they had entered the room.
    if (me < from) {
      await this.offerTo(from);
    } else {
      this.sealPeer(from, body.enc, body.relay, {
        t: "call-join", callId: room.callId, enc: this.identity.encPublicKeyHex,
        name: this.identity.name, relay: this.httpBase,
      }, `joinback-${room.callId}-${from}`, true);
    }
  }

  private async onRoomOffer(from: string, body: Extract<Body, { t: "call-offer" }>): Promise<void> {
    const room = this.room!;
    if (!room.dir.has(from)) room.dir.set(from, { enc: body.enc, name: body.name, relay: body.relay });
    const pc = room.peers.get(from)?.pc ?? this.newPeerPc(from);
    const peer = room.peers.get(from)!;

    // Perfect negotiation: if their offer collides with one of mine (both forwarders
    // relay to each other at once), the impolite peer ignores it — its own offer
    // wins — and the polite peer rolls its offer back and takes theirs.
    const collision = peer.makingOffer || pc.signalingState !== "stable";
    if (collision && !peer.polite) return;
    if (collision && peer.polite) {
      await pc.setLocalDescription({ type: "rollback" });
      peer.negotiating = false;
    }

    // A forwarder answering a peer forwarder → attribute my own media so it relays it on.
    if (room.forwarders.includes(this.identity.publicKeyHex) && !peer.fwded.has(this.identity.publicKeyHex)) {
      peer.fwded.add(this.identity.publicKeyHex);
      this.sealPeer(from, body.enc, body.relay, {
        t: "call-fwd", callId: room.callId, streamId: room.localStream.id,
        from: this.identity.publicKeyHex, name: this.identity.name,
      }, `fwdself-${room.callId}-${from}`, true);
    }
    await pc.setRemoteDescription({ type: "offer", sdp: body.sdp });
    await this.drainPeerIce(from);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const info = room.dir.get(from)!;
    this.sealPeer(from, info.enc, info.relay, { t: "call-answer", callId: room.callId, sdp: answer.sdp! }, `ans-${room.callId}-${from}`, true);

    // If I yielded a pending offer, re-send my tracks now that we're stable again.
    if (peer.renegPending) {
      peer.renegPending = false;
      void this.renegotiate(peer);
    }
  }

  private async onRoomAnswer(from: string, body: Extract<Body, { t: "call-answer" }>): Promise<void> {
    const peer = this.room?.peers.get(from);
    if (!peer) return;
    await peer.pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
    await this.drainPeerIce(from);
    peer.negotiating = false;
    if (peer.renegPending) {
      peer.renegPending = false;
      void this.renegotiate(peer);
    }
  }

  private async onRoomIce(from: string, body: Extract<Body, { t: "call-ice" }>): Promise<void> {
    const room = this.room!;
    const peer = room.peers.get(from);
    if (peer && peer.pc.remoteDescription) {
      await peer.pc.addIceCandidate(body.candidate).catch(() => {});
    } else {
      const list = room.pendingIce.get(from) ?? [];
      list.push(body.candidate);
      room.pendingIce.set(from, list);
    }
  }

  /** A relayed stream's origin was announced. A participant just displays it; a
   * forwarder learns it as a remote origin and relays it on to its own cluster. */
  private onCallFwd(body: Extract<Body, { t: "call-fwd" }>): void {
    const room = this.room;
    if (!room || room.callId !== body.callId) return;
    room.fwd.set(body.streamId, { from: body.from, name: body.name });
    const buffered = room.pending.get(body.streamId);
    if (!buffered) return;
    room.pending.delete(body.streamId);
    if (room.forwarders.includes(this.identity.publicKeyHex)) {
      this.learnOrigin(body.from, body.name, buffered, false);
    } else {
      this.events.onPeerStream(body.from, body.name, buffered);
    }
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
        if (this.room && this.room.callId === body.callId) return this.onRoomOffer(from, body);
        return this.onCallOffer(from, body);
      case "call-answer":
        if (this.room && this.room.callId === body.callId) return this.onRoomAnswer(from, body);
        return this.onCallAnswer(body);
      case "call-ice":
        if (this.room && this.room.callId === body.callId) return this.onRoomIce(from, body);
        return this.onCallIce(body);
      case "call-decline":
        if (this.room && this.room.callId === body.callId) return; // an invitee declined; the room continues
        return this.endCall("declined");
      case "call-hangup":
        return this.endCall("ended");
      case "call-invite":
        return this.onCallInvite(from, body);
      case "call-join":
        return this.onCallJoin(from, body);
      case "call-leave":
        if (this.room && this.room.callId === body.callId) this.dropPeer(from);
        return;
      case "call-host-offer":
        return this.onCallHostOffer(from, body);
      case "call-host-ack":
        return this.onCallHostAck(from, body);
      case "call-fwd":
        return this.onCallFwd(body);
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
    if (this.call || this.pendingOffer || this.room || this.pendingInvite) {
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
    this.transport.send({ to: pubkey, envelope, id, ephemeral, relay });
  }

  /** Seal to an explicit (enc, relay) — for group-call peers who may not be contacts. */
  private sealPeer(pubkey: string, enc: string, relay: string | undefined, body: Body, id: string, ephemeral: boolean): void {
    const envelope = seal(this.identity.privateKey, this.identity.publicKeyHex, enc, body, Date.now());
    this.transport.send({ to: pubkey, envelope, id, ephemeral, relay: relay ?? this.contacts.get(pubkey)?.relay });
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
