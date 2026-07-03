# Distributed stress rig

The single-laptop harness (`run.mjs`) can't distinguish a real negotiation
deadlock from CPU starvation — N Chromium WebRTC stacks on one machine choke,
and the failures look identical to a protocol bug. This rig spreads peers across
**many machines** so the numbers are trustworthy. It's the prerequisite for
landing the multi-forwarder (`wip/two-pc-glare-fix`) work on real evidence.

Cheap way to run it: a handful of small **DigitalOcean droplets**. Each has a
public IP, so peers connect **directly P2P — no TURN needed** for the test.

## Pieces

- `coordinator.mjs` — a rendezvous + aggregation server. Runs on **one** box.
  Peers register, it hands back the roster + forwarder plan, barriers everyone to
  a synchronized start, then collects stats and prints a report.
- `run-distributed.mjs` — runs on **each** droplet. Launches `PEERS` real Chromium
  peers pointed at a public relay, coordinates through the coordinator.

## 1. Pick a relay

Any reachable Vox relay. Either the live one, or a throwaway one on a droplet:

```
# on a relay droplet
docker run -d -p 4000:4000 -e SECRET_KEY_BASE=$(openssl rand -base64 48) \
  -e PHX_HOST=RELAY_IP elementaio/vox:latest
# → RELAY_HTTP=http://RELAY_IP:4000  RELAY_WS=ws://RELAY_IP:4000/socket
```

To test the **two-PC multi-forwarder** build, that relay must run engine ≥0.3.0
(the `broadcast_ephemeral` delivery fix) — the current `elementaio/vox:latest`
predates it, so build the image from `wip/two-pc-glare-fix` for a real v2 test.

## 2. Start the coordinator (one box)

```
N=6 FWD=2 VIDEO=1 node scripts/stress/coordinator.mjs
```

- `N` — total peers across all droplets; the call forms once this many register.
- `FWD` — forwarders: `0` mesh, `1` single, `≥2` multi-forwarder (the v2 case,
  e.g. `N=6 FWD=2` = dual6, `N=16 FWD=3` = n16f3).
- `VIDEO` — `1` video / `0` voice. `PORT` — default `9000`.

## 3. Per-droplet setup (once)

```
git clone <repo> && cd vox
pnpm install --filter web            # playwright + esbuild
node apps/web/node_modules/.bin/playwright install --with-deps chromium
```

## 4. Run peers on each droplet

Same command on every droplet, unique `LABEL`, `PEERS` summing to `N`:

```
COORDINATOR=http://COORD_IP:9000 \
RELAY_HTTP=http://RELAY_IP:4000 RELAY_WS=ws://RELAY_IP:4000/socket \
PEERS=3 LABEL=nyc1 TINY=1 node scripts/stress/run-distributed.mjs
```

- `PEERS` — peers to launch here (2–4 per small droplet; `TINY=1` shrinks the
  fake camera so a droplet hosts more cheaply).
- `LABEL` — unique per droplet (used for peer ids). Peers auto-accept the ring;
  only the roster's peer `0` initiates.

The coordinator prints the report once all `N` peers report:

```
━━ DISTRIBUTED n=6 fwd=2 ✓ all media flowing
   nyc1#0     peers= 5 fps= 19.1 out=4.8Mbps join=3200ms
   ...
   minFps=16.2 medianFps=18.7 maxJoin=4100ms
```

`GET http://COORD:9000/report` returns the same as JSON (with per-peer phase
timings + last events for any incomplete peer).

## What to look for

- **`✓ all media flowing`** across a *fresh* fleet, with no multi-second stalls
  in the per-peer `events`, means the two-PC deadlock was the laptop, not the code
  → land it. Recurring `reneg-DEFER` / `negotiating` stalls with idle CPU means a
  real race → keep it on the branch.
- Push `FWD` up (`N=16 FWD=3`, `N=20 FWD=4`) to find the multi-forwarder ceiling
  the mesh can't reach on one machine.
