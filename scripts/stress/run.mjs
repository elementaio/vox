// Vox conference stress harness — validates the architecture claim:
// mesh for small calls, elected forwarder beyond, MORE PARTICIPANTS → MORE
// FORWARDER HOSTS. Real Chromium, real WebRTC (fake camera), real relay.
//
//   node scripts/stress/run.mjs                    # full ladder
//   node scripts/stress/run.mjs mesh4 fwd8         # chosen scenarios
//
// Requires: the relay running on :4000 (cd apps/server && mix phx.server)
// and playwright's chromium installed (apps/web has the dep).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Rebuild the harness bundle from source so it always matches the SDK.
import { execFileSync } from 'node:child_process';
execFileSync(
  path.join(ROOT, 'apps/web/node_modules/.bin/esbuild'),
  ['scripts/stress/harness-src.mjs', '--bundle', '--format=esm', '--outfile=scripts/stress/bundle.js', '--log-level=warning'],
  { cwd: ROOT }
);
const RELAY_HTTP = 'http://127.0.0.1:4000';
const RELAY_WS = 'ws://127.0.0.1:4000/socket';
const HARNESS_PORT = 8899;

// ── tiny static server over the repo (harness page + sdk dist) ───────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(HARNESS_PORT, '127.0.0.1', r));
const HARNESS_URL = `http://127.0.0.1:${HARNESS_PORT}/scripts/stress/harness.html`;

// ── scenario runner ───────────────────────────────────────────────────────────
async function runScenario(browser, { label, n, forwarders: fwdCount, video = true, settleMs = 8000 }) {
  const t0 = Date.now();
  const pages = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [${label} P${i}] pageerror: ${e.message}`));
    await page.addInitScript((tiny) => { window.__tinyVideo = tiny; }, process.env.TINY === '1');
    await page.goto(HARNESS_URL);
    await page.waitForFunction('window.__ready === true');
    pages.push(page);
  }

  // Init every participant, collect pubkeys + invite tokens.
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = await pages[i].evaluate(
      ([http_, ws, name, dev]) => window.harness.init(http_, ws, name, dev),
      [RELAY_HTTP, RELAY_WS, `P${i}`, `dev-${i}`]
    );
    ids.push(id.pubkey);
  }
  const tokens = [];
  for (let i = 0; i < n; i++) {
    tokens.push(await pages[i].evaluate((h) => window.harness.token(h), RELAY_HTTP));
  }

  // The caller (P0) knows everyone.
  await pages[0].evaluate((ts) => window.harness.addContacts(ts), tokens.slice(1));

  // Everyone expects n-1 peer streams; mark join start.
  for (let i = 0; i < n; i++) {
    await pages[i].evaluate((k) => { window.harness.expect(k); window.harness.markJoinStart(); }, n - 1);
  }

  // Kick the call.
  const opts = fwdCount === 0 ? null
    : fwdCount === 1 ? { forward: true }
    : { forwarders: [ids[0], ...ids.slice(1, fwdCount)] };
  await pages[0].evaluate(
    ([pks, video_, opts_]) => window.harness.start(pks, video_, opts_, pks.length),
    [ids.slice(1), video, opts]
  );

  // Wait until every page sees all peers (or timeout).
  const deadline = Date.now() + 60_000;
  let ok = false;
  while (Date.now() < deadline) {
    const counts = [];
    for (const p of pages) counts.push(await p.evaluate(() => window.harness.stats().then((s) => s.peersWithStream)));
    if (counts.every((c) => c >= n - 1)) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Let media settle, then sample twice for fps.
  await new Promise((r) => setTimeout(r, settleMs));
  const s1 = [];
  for (const p of pages) s1.push(await p.evaluate(() => window.harness.stats()));
  const SAMPLE = 5000;
  await new Promise((r) => setTimeout(r, SAMPLE));
  const s2 = [];
  for (const p of pages) s2.push(await p.evaluate(() => window.harness.stats()));

  const rows = s2.map((s, i) => {
    const dFrames = s.framesDecoded - s1[i].framesDecoded;
    const streams = Math.max(s.inboundVideo, 1);
    return {
      name: s.name,
      pcs: s.pcs,
      peers: s.peersWithStream,
      fpsPerStream: +(dFrames / (SAMPLE / 1000) / streams).toFixed(1),
      inMbps: +(((s.bytesIn - s1[i].bytesIn) * 8) / SAMPLE / 1000).toFixed(1),
      outMbps: +(((s.bytesOut - s1[i].bytesOut) * 8) / SAMPLE / 1000).toFixed(1),
      joinMs: s.joinMs,
      phases: s.phases,
    };
  });

  const fpss = rows.map((r) => r.fpsPerStream);
  const joins = rows.map((r) => r.joinMs).filter((x) => x != null);
  const summary = {
    label, n, forwarders: fwdCount, allConnected: ok,
    minFps: Math.min(...fpss), medianFps: fpss.sort((a, b) => a - b)[Math.floor(fpss.length / 2)],
    maxJoinMs: joins.length ? Math.max(...joins) : null,
    forwarderOutMbps: rows[0].outMbps, forwarderPcs: rows[0].pcs,
    wallMs: Date.now() - t0,
  };

  console.log(`\n━━ ${label}: n=${n} forwarders=${fwdCount} ${ok ? '✓ all media flowing' : '✗ INCOMPLETE'}`);
  for (const r of rows) {
    const ph = r.phases;
    console.log(`   ${r.name.padEnd(4)} peers=${String(r.peers).padStart(2)} fps=${String(r.fpsPerStream).padStart(5)} out=${r.outMbps}Mbps  | sock=${ph.loadToSocket}ms ring=${ph.startToRing}ms firstMedia=${ph.ringToFirst}ms allMedia=${ph.firstToAll}ms`);
  }
  if (!ok) {
    for (let i = 0; i < pages.length; i++) {
      const ev = await pages[i].evaluate(() => window.harness.stats().then((s) => s.events));
      console.log(`   [debug P${i}]`, ev.join(' | '));
    }
  }

  for (const p of pages) await p.context().close();
  return summary;
}

// ── the ladder ────────────────────────────────────────────────────────────────
const SCENARIOS = {
  mesh3:  { label: 'mesh3',  n: 3,  forwarders: 0 },
  mesh4:  { label: 'mesh4',  n: 4,  forwarders: 0 },
  fwd6:   { label: 'fwd6',   n: 6,  forwarders: 1 },
  fwd8:   { label: 'fwd8',   n: 8,  forwarders: 1 },
  fwd10:  { label: 'fwd10',  n: 10, forwarders: 1 },
  dual10: { label: 'dual10', n: 10, forwarders: 2 },
  fwd12:  { label: 'fwd12',  n: 12, forwarders: 1 },
  dual12: { label: 'dual12', n: 12, forwarders: 2 },
  n12f2:  { label: 'n12f2',  n: 12, forwarders: 2 },
  n16f3:  { label: 'n16f3',  n: 16, forwarders: 3 },
  n20f4:  { label: 'n20f4',  n: 20, forwarders: 4 },
  n24f5:  { label: 'n24f5',  n: 24, forwarders: 5 },
  n30f6:  { label: 'n30f6',  n: 30, forwarders: 6 },
};
const picked = process.argv.slice(2);
const runs = picked.length ? picked.map((k) => SCENARIOS[k]).filter(Boolean) : Object.values(SCENARIOS);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});

const results = [];
for (const sc of runs) {
  try {
    results.push(await runScenario(browser, sc));
  } catch (e) {
    console.log(`\n━━ ${sc.label}: CRASHED — ${e.message}`);
    results.push({ label: sc.label, crashed: e.message });
  }
}

console.log('\n══════════ ENVELOPE ══════════');
for (const r of results) {
  if (r.crashed) { console.log(`${r.label}: CRASHED ${r.crashed}`); continue; }
  console.log(
    `${r.label.padEnd(7)} n=${String(r.n).padStart(2)} fwd=${r.forwarders} ` +
    `${r.allConnected ? 'OK ' : 'FAIL'} minFps=${r.minFps} medFps=${r.medianFps} ` +
    `joinMax=${r.maxJoinMs}ms fwdOut=${r.forwarderOutMbps}Mbps fwdPcs=${r.forwarderPcs}`
  );
}

await browser.close();
server.close();
