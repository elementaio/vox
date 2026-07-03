// Many participants in ONE browser page: each is a real SDK Client with its own
// identity + socket to the relay, but they share one Chromium's WebRTC stack.
// Lets us probe the fan-out TOPOLOGY at high N without N browser processes.
import * as sdk from '../../packages/sdk/src/index.ts';

// Tiny video for all — the topology is what's under test, not pixels.
const VIDEO = { width: 48, height: 36, frameRate: 5 };
{
  const _gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => (c && c.video ? _gum({ ...c, video: VIDEO }) : _gum(c));
}
// Cap every video sender's bitrate so relayed fan-out stays tiny on the wire.
const NativePC = window.RTCPeerConnection;
let allFramesDecoded = () => 0;
const pcs = [];
window.RTCPeerConnection = class extends NativePC {
  constructor(...a) {
    super(...a);
    pcs.push(this);
    this.addEventListener('signalingstatechange', () => {
      if (this.signalingState !== 'stable') return;
      for (const s of this.getSenders()) {
        if (s.track?.kind === 'video') {
          const p = s.getParameters();
          if (!p.encodings?.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = 60_000;
          s.setParameters(p).catch(() => {});
        }
      }
    });
  }
};

function makeStore() {
  const m = new Map(), c = new Map(), md = new Map();
  return {
    async addMessage(x) { m.set(x.id, x); }, async getMessage(id) { return m.get(id); },
    async setMessageStatus(id, s) { const x = m.get(id); if (x) x.status = s; },
    async editStoredMessage() { return true; }, async tombstoneStoredMessage() { return true; },
    async removeStoredMessage(id) { m.delete(id); }, async applyReaction() { return true; },
    async upsertContact(x) { c.set(x.pubkey, x); },
    async cacheMedia(id, b, mime) { md.set(id, { b, mime }); }, async getCachedMedia(id) { return md.get(id)?.b; },
  };
}

window.harnessMany = {
  async run(httpBase, socketUrl, n, forwarders) {
    window.__VOXPOOLDEBUG = window.__POOLDBG === true; // pool trace when asked
    const nodes = [];
    for (let i = 0; i < n; i++) {
      const identity = sdk.createIdentity();
      const st = { peers: new Set(), callState: 'idle', events: [] };
      const events = {
        onStatus() {}, onMessage() {}, onMessageUpdated() {}, onMessageRemoved() {},
        onReceipt() {}, onTyping() {}, onContact() {}, onPresence() {},
        onIncomingCall: (contact, name, callId) => {
          st.events.push('incoming');
          client.acceptCall(callId).catch((e) => st.events.push('acc-err:' + e));
        },
        onCallState: (s) => { st.callState = s; },
        onLocalStream() {}, onRemoteStream() {},
        onPeerStream: (pk, name, stream) => { if (stream) st.peers.add(pk); else st.peers.delete(pk); },
      };
      const client = new sdk.Client({ socketUrl, httpBase, identity, store: makeStore(), events, deviceId: `dev-${i}` });
      client.connect([]);
      nodes.push({ i, identity, client, st, pubkey: identity.publicKeyHex });
    }
    await new Promise((r) => setTimeout(r, 800)); // sockets join

    // Everyone becomes a contact of the caller (P0), who rings the room.
    const tokens = nodes.map((nd) => sdk.inviteToken(nd.identity, httpBase));
    for (let i = 1; i < n; i++) {
      const c = sdk.parseInvite(tokens[i]);
      if (c) await nodes[0].client.addContact(c);
    }

    const ids = nodes.map((nd) => nd.pubkey);
    const opts = forwarders === 0 ? undefined
      : forwarders === 1 ? { forward: true }
      : { forwarders: ids.slice(0, forwarders) };

    const started = Date.now();
    await nodes[0].client.startGroupCall(ids.slice(1), true, opts);

    // Poll until everyone sees n-1 peers, or 90s.
    let doneAt = null;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const full = nodes.filter((nd) => nd.st.peers.size >= n - 1).length;
      if (full === n) { doneAt = Date.now(); break; }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // fps: sample total decoded frames over 4s across all PCs.
    const sample = async () => {
      let f = 0, inbound = 0;
      for (const pc of pcs) {
        try { (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') { f += s.framesDecoded || 0; inbound++; } }); } catch {}
      }
      return { f, inbound };
    };
    const a = await sample();
    await new Promise((r) => setTimeout(r, 4000));
    const b = await sample();

    const peerCounts = nodes.map((nd) => nd.st.peers.size);
    return {
      n, forwarders,
      complete: doneAt != null,
      joinMs: doneAt ? doneAt - started : null,
      fullPeers: peerCounts.filter((c) => c >= n - 1).length,
      minPeers: Math.min(...peerCounts),
      medPeers: peerCounts.sort((x, y) => x - y)[Math.floor(n / 2)],
      inboundStreams: b.inbound,
      aggFps: +((b.f - a.f) / 4).toFixed(0),
      fpsPerStream: b.inbound ? +(((b.f - a.f) / 4) / b.inbound).toFixed(1) : 0,
      // Per-node topology ground truth: who each node actually sees (origin pubkeys).
      peerSets: nodes.map((nd) => ({
        pk: nd.pubkey.slice(0, 6),
        role: forwarders >= 1 && ids.slice(0, Math.max(1, forwarders)).includes(nd.pubkey) ? 'FWD' : 'leaf',
        sees: [...nd.st.peers].map((p) => p.slice(0, 6)).sort(),
        count: nd.st.peers.size,
      })),
    };
  },
};
window.__ready = true;
