// Vox distributed stress rig — RENDEZVOUS COORDINATOR.
//
// The single-laptop harness (run.mjs) can't tell a real deadlock from CPU
// starvation: N Chromium WebRTC stacks on one machine choke. This coordinator
// lets peers run across MANY machines (DigitalOcean droplets, each with a public
// IP → direct P2P, no TURN needed) and form ONE call, so the numbers are real.
//
// Run this on ONE box the droplets can reach:
//   N=6 FWD=2 VIDEO=1 node scripts/stress/coordinator.mjs
//     N     total peers across all droplets (call forms when this many register)
//     FWD   forwarders (0 = mesh, 1 = single, ≥2 = multi-forwarder — the v2 case)
//     VIDEO 1 video / 0 voice
//     PORT  listen port (default 9000)
//
// Each droplet runs run-distributed.mjs pointed at COORDINATOR=http://THIS:9000.
// Flow: peers /register → once N in, /roster returns the graph + forwarder plan →
// each peer adds contacts, then /arm → once all armed, /go flips → the initiator
// starts the call, everyone auto-accepts → peers /stats → GET /report aggregates.
import http from 'node:http';

const N = +(process.env.N || 6);
const FWD = +(process.env.FWD || 0);
const VIDEO = process.env.VIDEO !== '0';
const PORT = +(process.env.PORT || 9000);

/** @type {Map<string,{peerId:string,index:number,pubkey:string,token:string}>} */
const peers = new Map();
const armed = new Set();
const stats = new Map();
let go = false;
let order = []; // peerIds in registration order (stable roster indexing)

function roster() {
  const list = order.map((pid) => peers.get(pid));
  const pubkeys = list.map((p) => p.pubkey);
  // Same forwarder plan as run.mjs: index 0 is the initiator; forwarders are the
  // first FWD peers. opts null = mesh, {forward:true} = single, {forwarders:[…]}.
  const opts =
    FWD === 0 ? null : FWD === 1 ? { forward: true } : { forwarders: pubkeys.slice(0, FWD) };
  return {
    ready: peers.size >= N,
    n: N,
    fwd: FWD,
    video: VIDEO,
    initiator: order[0] ?? null,
    peers: list.map((p) => ({ peerId: p.peerId, index: p.index, pubkey: p.pubkey, token: p.token })),
    opts,
  };
}

function body(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/register') {
    const { peerId, pubkey, token } = await body(req);
    if (!peerId || !pubkey || !token) return json(res, 400, { error: 'peerId, pubkey, token required' });
    if (!peers.has(peerId)) {
      if (peers.size >= N) return json(res, 409, { error: `already ${N} peers registered` });
      peers.set(peerId, { peerId, index: order.length, pubkey, token });
      order.push(peerId);
      console.log(`register ${peerId}  (${peers.size}/${N})`);
    }
    return json(res, 200, { ok: true, index: peers.get(peerId).index, have: peers.size, n: N });
  }
  if (req.method === 'GET' && url.pathname === '/roster') return json(res, 200, roster());
  if (req.method === 'POST' && url.pathname === '/arm') {
    const { peerId } = await body(req);
    if (peers.has(peerId)) armed.add(peerId);
    if (!go && armed.size >= N) {
      go = true;
      console.log(`ARMED ${armed.size}/${N} → GO`);
    }
    return json(res, 200, { go, armed: armed.size, n: N });
  }
  if (req.method === 'GET' && url.pathname === '/go') return json(res, 200, { go, armed: armed.size, n: N });
  if (req.method === 'POST' && url.pathname === '/stats') {
    const { peerId, row } = await body(req);
    if (peerId && row) {
      stats.set(peerId, row);
      console.log(`stats ${peerId}  peers=${row.peers} fps=${row.fpsPerStream} out=${row.outMbps}Mbps`);
    }
    if (stats.size >= N) printReport();
    return json(res, 200, { ok: true, have: stats.size, n: N });
  }
  if (req.method === 'GET' && url.pathname === '/report') return json(res, 200, report());
  if (req.method === 'GET' && url.pathname === '/') return json(res, 200, { n: N, fwd: FWD, registered: peers.size, armed: armed.size, go, stats: stats.size });
  json(res, 404, { error: 'not found' });
});

function report() {
  const rows = [...stats.values()];
  const fpss = rows.map((r) => r.fpsPerStream).filter((x) => x != null);
  const joins = rows.map((r) => r.joinMs).filter((x) => x != null);
  const complete = rows.filter((r) => r.peers >= N - 1).length;
  return {
    n: N,
    fwd: FWD,
    reported: rows.length,
    allMediaFlowing: complete === N && rows.length === N,
    peersComplete: `${complete}/${N}`,
    minFps: fpss.length ? Math.min(...fpss) : null,
    medianFps: fpss.length ? fpss.slice().sort((a, b) => a - b)[Math.floor(fpss.length / 2)] : null,
    maxJoinMs: joins.length ? Math.max(...joins) : null,
    rows: rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
  };
}

let printed = false;
function printReport() {
  if (printed) return;
  printed = true;
  const r = report();
  console.log(`\n━━ DISTRIBUTED n=${N} fwd=${FWD} ${r.allMediaFlowing ? '✓ all media flowing' : '✗ INCOMPLETE ' + r.peersComplete}`);
  for (const row of r.rows) {
    console.log(
      `   ${String(row.name ?? row.peerId).padEnd(10)} peers=${String(row.peers).padStart(2)} ` +
        `fps=${String(row.fpsPerStream).padStart(5)} out=${row.outMbps}Mbps join=${row.joinMs ?? '—'}ms`,
    );
  }
  console.log(`   minFps=${r.minFps} medianFps=${r.medianFps} maxJoin=${r.maxJoinMs}ms\n`);
  console.log('GET /report for JSON. Ctrl-C to stop.');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Vox coordinator on :${PORT}  — waiting for N=${N} peers (fwd=${FWD}, video=${VIDEO}).`);
  console.log(`Point droplets at COORDINATOR=http://<this-host>:${PORT}`);
});
