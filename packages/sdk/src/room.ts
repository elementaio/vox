import { Socket, type Channel } from "phoenix";
import { authParams, type Identity } from "./identity";
import { seal, open, type SealedEnvelope } from "./crypto";
import { randomId } from "./util";

/**
 * A MEETING ROOM — "join by link", for full end-to-end group calls with people
 * who aren't your contacts (guests with a throwaway identity, no account).
 *
 * It's a self-contained WebRTC MESH (each pair a direct peer connection), kept
 * separate from the contact-call/forwarder code on purpose: rooms have their own
 * signaling transport (the relay's RoomChannel) and their own peer discovery
 * (the room roster), so they don't entangle the crown-jewel forwarder work.
 *
 * End-to-end: every signaling message is SEALED to the recipient's key and only
 * routed by the relay — media flows peer-to-peer, the relay never sees it. Glare
 * is impossible: for each pair the LOWER pubkey is the sole offerer.
 *
 * Scale: a mesh is right for small/medium meetings; a forwarder/tree upgrade
 * (shared with the contact-call scale work) is a later step.
 */

export interface RoomEvents {
  onStatus(status: string): void;
  onLocalStream(stream: MediaStream): void;
  /** A peer's media arrived (stream) or they left (null). */
  onPeer(pubkey: string, name: string, stream: MediaStream | null): void;
  /** Current participant count including yourself. */
  onCount(n: number): void;
}

export interface RoomConfig {
  socketUrl: string;
  httpBase: string;
  identity: Identity; // the user's identity, or an ephemeral one for a guest
  roomId: string;
  name: string;
  video: boolean;
  events: RoomEvents;
}

type Signal =
  | { t: "offer"; sdp: string }
  | { t: "answer"; sdp: string }
  | { t: "ice"; candidate: RTCIceCandidateInit };

interface Meta {
  metas?: Array<{ pubkey: string; enc: string; name: string }>;
}
type PresenceList = Record<string, Meta>;
interface PresenceDiff {
  joins?: PresenceList;
  leaves?: PresenceList;
}
interface SignalMsg {
  from: string;
  to: string;
  envelope: SealedEnvelope;
}

interface Peer {
  pc: RTCPeerConnection;
  name: string;
  pendingIce: RTCIceCandidateInit[];
}

/** A fresh, unguessable room id for a new meeting link. */
export function newRoomId(): string {
  return randomId() + randomId();
}

export class RoomCall {
  private cfg: RoomConfig;
  private me: string;
  private socket: Socket;
  private channel: Channel | null = null;
  private local: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  private roster = new Map<string, { enc: string; name: string }>();
  private peers = new Map<string, Peer>();

  constructor(cfg: RoomConfig) {
    this.cfg = cfg;
    this.me = cfg.identity.publicKeyHex;
    this.socket = new Socket(cfg.socketUrl, { params: authParams(cfg.identity) });
  }

  async join(): Promise<void> {
    try {
      const c = await fetch(`${this.cfg.httpBase}/config`).then((r) => r.json());
      this.iceServers = (c as { ice_servers?: RTCIceServer[] }).ice_servers ?? [];
    } catch {
      /* no operator ICE config — host candidates only */
    }

    this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.cfg.video });
    this.cfg.events.onLocalStream(this.local);

    this.socket.onOpen(() => this.cfg.events.onStatus("connected"));
    this.socket.onError(() => this.cfg.events.onStatus("reconnecting…"));
    this.socket.onClose(() => this.cfg.events.onStatus("offline"));
    this.socket.connect();

    const ch = this.socket.channel(`room:${this.cfg.roomId}`, { name: this.cfg.name });
    this.channel = ch;
    ch.on("roster", (r: PresenceList) => this.onRoster(r));
    ch.on("presence_diff", (d: PresenceDiff) => this.onDiff(d));
    ch.on("signal", (m: SignalMsg) => void this.onSignal(m));
    ch.join()
      .receive("ok", () => this.cfg.events.onStatus("in-room"))
      .receive("error", (e) => this.cfg.events.onStatus(`room error: ${JSON.stringify(e)}`));
  }

  leave(): void {
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.local?.getTracks().forEach((t) => t.stop());
    this.channel?.leave();
    this.socket.disconnect();
  }

  /** Local mic/camera control — flips track.enabled (peer keeps the track). */
  setMic(on: boolean): void {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = on));
  }
  setCam(on: boolean): void {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = on));
  }

  // ── roster / peer discovery ─────────────────────────────────────────────
  private onRoster(list: PresenceList): void {
    for (const [pk, entry] of Object.entries(list)) {
      const meta = entry.metas?.[0];
      if (meta && pk !== this.me) this.learn(pk, meta.enc, meta.name);
    }
    this.cfg.events.onCount(this.roster.size + 1);
  }

  private onDiff(diff: PresenceDiff): void {
    for (const [pk, entry] of Object.entries(diff.joins ?? {})) {
      const meta = entry.metas?.[0];
      if (meta && pk !== this.me) this.learn(pk, meta.enc, meta.name);
    }
    for (const pk of Object.keys(diff.leaves ?? {})) {
      if (pk !== this.me) this.drop(pk);
    }
    this.cfg.events.onCount(this.roster.size + 1);
  }

  private learn(pk: string, enc: string, name: string): void {
    if (this.roster.has(pk)) return;
    this.roster.set(pk, { enc, name });
    // Lower pubkey is the sole offerer for the pair → no glare.
    if (this.me < pk) void this.offer(pk);
  }

  private drop(pk: string): void {
    this.roster.delete(pk);
    const p = this.peers.get(pk);
    if (p) {
      p.pc.close();
      this.peers.delete(pk);
    }
    this.cfg.events.onPeer(pk, "", null);
  }

  // ── peer connections ────────────────────────────────────────────────────
  private pcFor(pk: string): Peer {
    const existing = this.peers.get(pk);
    if (existing) return existing;
    const info = this.roster.get(pk)!;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    for (const t of this.local!.getTracks()) pc.addTrack(t, this.local!);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(pk, { t: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => this.cfg.events.onPeer(pk, info.name, e.streams[0]);
    const peer: Peer = { pc, name: info.name, pendingIce: [] };
    this.peers.set(pk, peer);
    return peer;
  }

  private async offer(pk: string): Promise<void> {
    const p = this.pcFor(pk);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.send(pk, { t: "offer", sdp: offer.sdp! });
  }

  // ── sealed signaling over the room channel ──────────────────────────────
  private send(pk: string, body: Signal): void {
    const enc = this.roster.get(pk)?.enc;
    if (!enc || !this.channel) return;
    const envelope = seal(this.cfg.identity.privateKey, this.me, enc, body, Date.now());
    this.channel.push("signal", { to: pk, envelope });
  }

  private async onSignal(m: SignalMsg): Promise<void> {
    if (m.to !== this.me || !this.roster.has(m.from)) return;
    let body: Signal;
    try {
      body = open<Signal>(this.cfg.identity.encPrivateKey, this.cfg.identity.encPublicKeyHex, m.envelope).body;
    } catch {
      return; // unreadable/forged
    }
    const p = this.pcFor(m.from);
    if (body.t === "offer") {
      await p.pc.setRemoteDescription({ type: "offer", sdp: body.sdp });
      await this.flushIce(p);
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      this.send(m.from, { t: "answer", sdp: answer.sdp! });
    } else if (body.t === "answer") {
      await p.pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
      await this.flushIce(p);
    } else {
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(body.candidate).catch(() => {});
      else p.pendingIce.push(body.candidate);
    }
  }

  private async flushIce(p: Peer): Promise<void> {
    for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }
}
