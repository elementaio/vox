// Node-WebRTC scale harness: N real SDK clients in ONE Node process (no
// browsers), each a synthetic-media peer against the running relay. Probes the
// fan-out TOPOLOGY at counts a laptop full of Chromiums can't reach.
//
//   node scripts/stress/node-scale.mjs 20 50 100     # N values
//
// Needs the relay on :4000 and @roamhq/wrtc (installed at the repo root).
import './node-shim.mjs';
const sdk = await import('../../packages/sdk/dist/index.js');

const RELAY_HTTP = 'http://127.0.0.1:4000';
const RELAY_WS = 'ws://127.0.0.1:4000/socket';

function makeStore() {
  const m = new Map();
  return {
    async addMessage(x) { m.set(x.id, x); }, async getMessage(id) { return m.get(id); },
    async setMessageStatus(id, s) { const x = m.get(id); if (x) x.status = s; },
    async editStoredMessage() { return true; }, async tombstoneStoredMessage() { return true; },
    async removeStoredMessage(id) { m.delete(id); }, async applyReaction() { return true; },
    async upsertContact() {}, async cacheMedia() {}, async getCachedMedia() { return undefined; },
  };
}

const pcs = [];
const NativePC = globalThis.RTCPeerConnection;
globalThis.RTCPeerConnection = class extends NativePC {
  constructor(...a) { super(...a); pcs.push(this); }
};

async function runN(n) {
  const fwd = n <= 4 ? 0 : Math.max(1, Math.ceil(n / 6)); // ~1 host per 6 leaves
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const identity = sdk.createIdentity();
    const st = { peers: new Set() };
    const events = {
      onStatus() {}, onMessage() {}, onMessageUpdated() {}, onMessageRemoved() {},
      onReceipt() {}, onTyping() {}, onContact() {}, onPresence() {},
      onIncomingCall: (c, name, callId) => client.acceptCall(callId).catch(() => {}),
      onCallState() {}, onLocalStream() {}, onRemoteStream() {},
      onPeerStream: (pk, name, stream) => { stream ? st.peers.add(pk) : st.peers.delete(pk); },
    };
    const client = new sdk.Client({ socketUrl: RELAY_WS, httpBase: RELAY_HTTP, identity, store: makeStore(), events, deviceId: `n${i}` });
    client.connect([]);
    nodes.push({ i, identity, client, st, pubkey: identity.publicKeyHex });
    if (i % 20 === 19) await new Promise((r) => setTimeout(r, 200)); // stagger socket joins
  }
  await new Promise((r) => setTimeout(r, Math.max(1500, n * 40)));

  const tokens = nodes.map((nd) => sdk.inviteToken(nd.identity, RELAY_HTTP));
  for (let i = 1; i < n; i++) { const c = sdk.parseInvite(tokens[i]); if (c) await nodes[0].client.addContact(c); }

  const ids = nodes.map((nd) => nd.pubkey);
  const opts = fwd === 0 ? undefined : fwd === 1 ? { forward: true } : { forwarders: ids.slice(0, fwd) };
  const t0 = Date.now();
  await nodes[0].client.startGroupCall(ids.slice(1), true, opts);

  let doneAt = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const full = nodes.filter((nd) => nd.st.peers.size >= n - 1).length;
    if (full === n) { doneAt = Date.now(); break; }
    await new Promise((r) => setTimeout(r, 1500));
  }

  // fps over 4s across all PCs.
  const sample = async () => {
    let f = 0, inbound = 0;
    for (const pc of pcs) { try { (await pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') { f += s.framesDecoded || 0; inbound++; } }); } catch {} }
    return { f, inbound };
  };
  const a = await sample(); await new Promise((r) => setTimeout(r, 4000)); const b = await sample();
  const counts = nodes.map((nd) => nd.st.peers.size);
  const r = {
    n, fwd, complete: doneAt != null, joinMs: doneAt ? doneAt - t0 : null,
    full: counts.filter((c) => c >= n - 1).length,
    medPeers: counts.sort((x, y) => x - y)[Math.floor(n / 2)],
    streams: b.inbound, fpsPerStream: b.inbound ? +(((b.f - a.f) / 4) / b.inbound).toFixed(1) : 0,
  };
  for (const nd of nodes) try { nd.client.endCall?.('ended'); } catch {}
  pcs.length = 0;
  await new Promise((r) => setTimeout(r, 800));
  return r;
}

const Ns = process.argv.slice(2).map(Number).filter(Boolean);
if (!Ns.length) Ns.push(10, 20, 50);
const out = [];
for (const n of Ns) {
  try {
    const r = await runN(n);
    console.log(`N=${String(n).padStart(3)} fwd=${r.fwd} ${r.complete ? '✓ full' : '✗ part'} full=${r.full}/${n} medPeers=${r.medPeers} join=${r.joinMs ?? '—'}ms streams=${r.streams} fps/stream=${r.fpsPerStream}`);
    out.push(r);
  } catch (e) { console.log(`N=${n}: ERROR ${e.message}`); out.push({ n, error: e.message }); }
}
console.log('\n════ NODE-WEBRTC SCALE ENVELOPE ════');
for (const r of out) console.log(r.error ? `N=${r.n}: ${r.error}` : `N=${String(r.n).padStart(3)} fwd=${r.fwd} ${r.complete ? 'OK  ' : 'PART'} full=${r.full}/${r.n} join=${r.joinMs ?? '—'}ms fps/stream=${r.fpsPerStream} streams=${r.streams}`);
process.exit(0);
