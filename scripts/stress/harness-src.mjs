import * as sdk from '../../packages/sdk/src/index.ts';

  // TINY video mode (window.__tinyVideo, set by run.mjs from TINY=1): a few
  // pixels at low fps so ONE machine can run many encoders and we can probe the
  // fan-out TOPOLOGY at higher participant counts. Quality is irrelevant to the
  // topology under test — pixels are just the CPU cost that otherwise starves a
  // single-laptop rig. Default (unset) uses the browser's normal fake camera.
  const VIDEO = { width: 48, height: 36, frameRate: 5 };
  if (window.__tinyVideo) {
    const _gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => {
      if (c && c.video) c = { ...c, video: VIDEO };
      return _gum(c);
    };
  }

  // Track every RTCPeerConnection the SDK creates — the measurement tap.
  const pcs = [];
  const NativePC = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePC {
    constructor(...args) {
      super(...args);
      pcs.push(this);
      this.addEventListener('negotiationneeded', () => {});
      if (window.__tinyVideo) {
        const capBitrate = () => {
          for (const sender of this.getSenders()) {
            if (sender.track && sender.track.kind === 'video') {
              const p = sender.getParameters();
              if (!p.encodings || !p.encodings.length) p.encodings = [{}];
              p.encodings[0].maxBitrate = 60_000; // 60 kbps/stream
              sender.setParameters(p).catch(() => {});
            }
          }
        };
        this.addEventListener('signalingstatechange', () => { if (this.signalingState === 'stable') capBitrate(); });
      }
    }
  };

  
  // Minimal in-memory Store (the SDK's persistence port).
  const mem = { msgs: new Map(), contacts: new Map(), media: new Map() };
  const store = {
    async addMessage(m) { mem.msgs.set(m.id, m); },
    async getMessage(id) { return mem.msgs.get(id); },
    async setMessageStatus(id, s) { const m = mem.msgs.get(id); if (m) m.status = s; },
    async editStoredMessage(id, t) { const m = mem.msgs.get(id); if (m) { m.text = t; return true; } return false; },
    async tombstoneStoredMessage(id) { return mem.msgs.delete(id); },
    async removeStoredMessage(id) { mem.msgs.delete(id); },
    async applyReaction() { return true; },
    async upsertContact(c) { mem.contacts.set(c.pubkey, c); },
    async cacheMedia(id, bytes, mime) { mem.media.set(id, { bytes, mime }); },
    async getCachedMedia(id) { return mem.media.get(id)?.bytes; },
  };

  const state = {
    name: null, client: null, identity: null,
    callState: 'idle', incoming: null, accepted: false,
    peerStreams: new Map(),           // pubkey -> has live stream
    events: [],
    pageLoadAt: Date.now(), socketAt: 0, ringAt: 0,
    joinStartedAt: 0, connectedAt: 0, firstStreamAt: 0, allStreamsAt: 0,
    expectedPeers: 0,
  };

  const log = (e) => state.events.push(`${Date.now() % 100000} ${e}`);

  window.harness = {
    async init(httpBase, socketUrl, name, deviceId) {
      state.name = name;
      state.identity = sdk.createIdentity();
      const events = {
        onStatus: (s) => { if (s === 'connected' && !state.socketAt) state.socketAt = Date.now(); log(`status:${s}`); },
        onMessage() {}, onMessageUpdated() {}, onMessageRemoved() {},
        onReceipt() {}, onTyping() {}, onContact() {}, onPresence() {},
        onIncomingCall: (contact, cname, callId, video) => {
          log(`incoming:${callId}`);
          if (!state.ringAt) state.ringAt = Date.now();
          state.incoming = { callId };
          // Auto-accept the ring.
          state.client.acceptCall(callId).then(() => { state.accepted = true; log('accepted'); })
            .catch((err) => log(`accept-error:${err}`));
        },
        onCallState: (s, info) => {
          log(`call:${s}${info ? ':' + info : ''}`);
          state.callState = s;
          if (s === 'connected' && !state.connectedAt) state.connectedAt = Date.now();
        },
        onLocalStream() {}, onRemoteStream() {},
        onPeerStream: (pk, pname, stream) => {
          if (stream) {
            state.peerStreams.set(pk, true);
            if (!state.firstStreamAt) state.firstStreamAt = Date.now();
            if (state.expectedPeers && state.peerStreams.size >= state.expectedPeers && !state.allStreamsAt) {
              state.allStreamsAt = Date.now();
            }
          } else {
            state.peerStreams.delete(pk);
          }
          log(`peerstream:${pname}:${stream ? 'on' : 'off'} (${state.peerStreams.size})`);
        },
      };
      state.client = new sdk.Client({
        socketUrl, httpBase, identity: state.identity, store, events, deviceId,
      });
      state.client.connect([]);
      await new Promise((r) => setTimeout(r, 400)); // let the socket join
      return { pubkey: state.identity.publicKeyHex };
    },

    token(httpBase) { return sdk.inviteToken(state.identity, httpBase); },

    async addContacts(tokens) {
      for (const t of tokens) {
        const c = sdk.parseInvite(t);
        if (c) await state.client.addContact(c);
      }
      return true;
    },

    async start(pks, video, opts, expectedPeers) {
      state.expectedPeers = expectedPeers;
      state.joinStartedAt = Date.now();
      await state.client.startGroupCall(pks, video, opts || undefined);
      return true;
    },

    expect(n) { state.expectedPeers = n; if (state.peerStreams.size >= n && !state.allStreamsAt) state.allStreamsAt = Date.now(); },
    markJoinStart() { state.joinStartedAt = Date.now(); },

    async stats() {
      let inboundVideo = 0, framesDecoded = 0, framesEncoded = 0,
          bytesIn = 0, bytesOut = 0, connected = 0;
      for (const pc of pcs) {
        if (pc.connectionState === 'connected') connected++;
        let report;
        try { report = await pc.getStats(); } catch { continue; }
        report.forEach((s) => {
          if (s.type === 'inbound-rtp' && s.kind === 'video') {
            inboundVideo++; framesDecoded += s.framesDecoded || 0; bytesIn += s.bytesReceived || 0;
          }
          if (s.type === 'outbound-rtp' && s.kind === 'video') {
            framesEncoded += s.framesEncoded || 0; bytesOut += s.bytesSent || 0;
          }
        });
      }
      return {
        name: state.name,
        callState: state.callState,
        pcs: pcs.length, connectedPcs: connected,
        peersWithStream: state.peerStreams.size,
        inboundVideo, framesDecoded, framesEncoded, bytesIn, bytesOut,
        joinMs: state.allStreamsAt && state.joinStartedAt ? state.allStreamsAt - state.joinStartedAt : null,
        phases: {
          loadToSocket: state.socketAt ? state.socketAt - state.pageLoadAt : null,
          startToRing: state.ringAt && state.joinStartedAt ? state.ringAt - state.joinStartedAt : null,
          ringToFirst: state.firstStreamAt && state.ringAt ? state.firstStreamAt - state.ringAt : null,
          firstToAll: state.allStreamsAt && state.firstStreamAt ? state.allStreamsAt - state.firstStreamAt : null,
        },
        events: state.events.slice(-8),
      };
    },
  };
  window.__ready = true;
