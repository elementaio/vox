// Drive many-per-browser conference tests: ONE Chromium, N SDK clients.
//   node scripts/stress/run-many.mjs 12 16 20 30    # N values (forwarders auto ~N/5)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

execFileSync(path.join(ROOT, 'apps/web/node_modules/.bin/esbuild'),
  ['scripts/stress/harness-many-src.mjs', '--bundle', '--format=esm', '--outfile=scripts/stress/bundle-many.js', '--log-level=warning'],
  { cwd: ROOT });

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' }[path.extname(f)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8898, '127.0.0.1', r));

const page_html = `<!doctype html><meta charset=utf-8><script type=module src=./bundle-many.js></script>`;
fs.writeFileSync(path.join(ROOT, 'scripts/stress/many.html'), page_html);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--js-flags=--max-old-space-size=2048'],
});

const Ns = process.argv.slice(2).map(Number).filter(Boolean);
if (!Ns.length) Ns.push(8, 12, 16, 20);
const DBG = !!process.env.POOLDBG; // POOLDBG=1 → pool trace + per-node topology

const results = [];
for (const n of Ns) {
  const fwd = n <= 4 ? 0 : Math.max(1, Math.ceil(n / 5));
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [N=${n}] pageerror: ${e.message}`));
  if (DBG) {
    await page.addInitScript(() => {
      window.__POOLDBG = true;
      window.addEventListener('unhandledrejection', (e) => console.log('[POOL] REJECT ' + (e.reason?.message || e.reason)));
    });
    page.on('console', (m) => { const t = m.text(); if (t.startsWith('[POOL]')) console.log('  ' + t); });
  }
  await page.goto('http://127.0.0.1:8898/scripts/stress/many.html');
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  try {
    const r = await page.evaluate(([http_, ws, n_, f_]) => window.harnessMany.run(http_, ws, n_, f_),
      ['http://127.0.0.1:4000', 'ws://127.0.0.1:4000/socket', n, fwd]);
    results.push(r);
    console.log(`N=${String(n).padStart(3)} fwd=${fwd}  ${r.complete ? '✓ full mesh' : '✗ partial'}  fullPeers=${r.fullPeers}/${n} medPeers=${r.medPeers} join=${r.joinMs ?? '—'}ms streams=${r.inboundStreams} fps/stream=${r.fpsPerStream}`);
    if (DBG && r.peerSets) for (const ps of r.peerSets) console.log(`    ${ps.role} ${ps.pk} sees ${ps.count}: ${ps.sees.join(' ')}`);
  } catch (e) {
    console.log(`N=${n}: ERROR ${e.message}`);
    results.push({ n, error: e.message });
  }
  await ctx.close();
}

console.log('\n════ MANY-IN-ONE-BROWSER ENVELOPE ════');
for (const r of results) {
  if (r.error) { console.log(`N=${r.n}: ${r.error}`); continue; }
  console.log(`N=${String(r.n).padStart(3)} fwd=${r.forwarders} ${r.complete ? 'OK  ' : 'PART'} full=${r.fullPeers}/${r.n} join=${r.joinMs ?? '—'}ms fps/stream=${r.fpsPerStream} streams=${r.inboundStreams}`);
}
await browser.close();
server.close();
