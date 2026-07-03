// Vox distributed stress rig — PER-DROPLET RUNNER.
//
// Launches PEERS real Chromium peers on THIS machine, points them at a public
// relay, and coordinates with coordinator.mjs so peers spread across many
// droplets form ONE call. Run the same command on each droplet (unique LABEL):
//
//   COORDINATOR=http://COORD:9000 \
//   RELAY_HTTP=https://vox.server.jadwal.io RELAY_WS=wss://vox.server.jadwal.io/socket \
//   PEERS=3 LABEL=nyc1 node scripts/stress/run-distributed.mjs
//
// Setup per droplet (once): pnpm install in apps/web, then
//   node apps/web/node_modules/.bin/playwright install --with-deps chromium
// TINY=1 shrinks the fake camera so a droplet can host more peers cheaply.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const COORDINATOR = process.env.COORDINATOR || 'http://127.0.0.1:9000';
const RELAY_HTTP = process.env.RELAY_HTTP || 'http://127.0.0.1:4000';
const RELAY_WS = process.env.RELAY_WS || 'ws://127.0.0.1:4000/socket';
const PEERS = +(process.env.PEERS || 1);
const LABEL = process.env.LABEL || os.hostname().split('.')[0];
const HARNESS_PORT = +(process.env.HARNESS_PORT || 8899);
const SETTLE = +(process.env.SETTLE || 8000);
const SAMPLE = 5000;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'apps/web/package.json'));
const { chromium } = require('playwright');

// Rebuild the harness bundle so it always matches the SDK source.
execFileSync(
  path.join(ROOT, 'apps/web/node_modules/.bin/esbuild'),
  ['scripts/stress/harness-src.mjs', '--bundle', '--format=esm', '--outfile=scripts/stress/bundle.js', '--log-level=warning'],
  { cwd: ROOT },
);

// Static server (harness page + bundle) — local to this droplet.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(HARNESS_PORT, '127.0.0.1', r));
const HARNESS_URL = `http://127.0.0.1:${HARNESS_PORT}/scripts/stress/harness.html`;

const api = async (method, route, payload) => {
  const res = await fetch(`${COORDINATOR}${route}`, {
    method,
    headers: payload ? { 'content-type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return res.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`[${LABEL}] launching ${PEERS} peer(s) → relay ${RELAY_HTTP}, coordinator ${COORDINATOR}`);
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});

// ── bring up local peers + register ─────────────────────────────────────────
const local = []; // { peerId, page, pubkey, index }
for (let i = 0; i < PEERS; i++) {
  const peerId = `${LABEL}#${i}`;
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${peerId}] pageerror: ${e.message}`));
  await page.addInitScript((tiny) => { window.__tinyVideo = tiny; }, process.env.TINY === '1');
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
  const { pubkey } = await page.evaluate(
    ([h, w, name, dev]) => window.harness.init(h, w, name, dev),
    [RELAY_HTTP, RELAY_WS, peerId, peerId],
  );
  const token = await page.evaluate((h) => window.harness.token(h), RELAY_HTTP);
  const reg = await api('POST', '/register', { peerId, pubkey, token });
  console.log(`  [${peerId}] registered index=${reg.index} (${reg.have}/${reg.n})`);
  local.push({ peerId, page, pubkey, index: reg.index });
}

// ── wait for the full roster ────────────────────────────────────────────────
let roster;
for (;;) {
  roster = await api('GET', '/roster');
  if (roster.ready) break;
  process.stdout.write(`\r[${LABEL}] waiting for peers… ${roster.peers.length}/${roster.n}   `);
  await sleep(1000);
}
console.log(`\n[${LABEL}] roster ready: n=${roster.n} fwd=${roster.fwd} initiator=${roster.initiator}`);

const allTokens = roster.peers.map((p) => p.token);
const allPubkeys = roster.peers.map((p) => p.pubkey);

// ── build the contact graph, then arm ───────────────────────────────────────
for (const p of local) {
  const others = allTokens.filter((_, i) => allPubkeys[i] !== p.pubkey);
  await p.page.evaluate((ts) => window.harness.addContacts(ts), others);
  await p.page.evaluate((k) => window.harness.expect(k), roster.n - 1);
  await api('POST', '/arm', { peerId: p.peerId });
}

// ── barrier: wait for GO, then the initiator starts; all mark join start ─────
for (;;) {
  const g = await api('GET', '/go');
  if (g.go) break;
  process.stdout.write(`\r[${LABEL}] armed, waiting for GO… ${g.armed}/${g.n}   `);
  await sleep(500);
}
console.log(`\n[${LABEL}] GO`);

for (const p of local) await p.page.evaluate(() => window.harness.markJoinStart());
const initiator = local.find((p) => p.peerId === roster.initiator);
if (initiator) {
  const others = allPubkeys.filter((pk) => pk !== initiator.pubkey);
  console.log(`  [${initiator.peerId}] I am the initiator — starting the call`);
  await initiator.page.evaluate(
    ([pks, video, opts, exp]) => window.harness.start(pks, video, opts, exp),
    [others, roster.video, roster.opts, roster.n - 1],
  );
}

// ── settle, sample twice, report ────────────────────────────────────────────
await sleep(SETTLE);
const s1 = await Promise.all(local.map((p) => p.page.evaluate(() => window.harness.stats())));
await sleep(SAMPLE);
const s2 = await Promise.all(local.map((p) => p.page.evaluate(() => window.harness.stats())));

for (let i = 0; i < local.length; i++) {
  const s = s2[i], prev = s1[i], p = local[i];
  const dFrames = s.framesDecoded - prev.framesDecoded;
  const streams = Math.max(s.inboundVideo, 1);
  const row = {
    peerId: p.peerId,
    name: p.peerId,
    index: p.index,
    pcs: s.pcs,
    peers: s.peersWithStream,
    fpsPerStream: +(dFrames / (SAMPLE / 1000) / streams).toFixed(1),
    inMbps: +(((s.bytesIn - prev.bytesIn) * 8) / SAMPLE / 1000).toFixed(1),
    outMbps: +(((s.bytesOut - prev.bytesOut) * 8) / SAMPLE / 1000).toFixed(1),
    joinMs: s.joinMs,
    phases: s.phases,
    events: s.events,
  };
  await api('POST', '/stats', { peerId: p.peerId, row });
  console.log(`  [${p.peerId}] peers=${row.peers} fps=${row.fpsPerStream} out=${row.outMbps}Mbps join=${row.joinMs ?? '—'}ms`);
}

console.log(`[${LABEL}] done — GET ${COORDINATOR}/report for the aggregate.`);
await browser.close();
server.close();
