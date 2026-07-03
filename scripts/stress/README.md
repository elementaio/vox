# Conference stress harness

Validates the zero-server group-call architecture (mesh → elected forwarder →
multi-forwarder sharding) with **real headless Chromium + real WebRTC** (fake
camera) against a running relay. Each participant is a browser page driving
`@pochta-chat/sdk` directly (no UI); the harness taps every RTCPeerConnection's
`getStats()` for framerate/bandwidth and tracks join latency.

## Run

    cd apps/server && mix phx.server         # relay on :4000 (one terminal)
    node scripts/stress/run.mjs              # full ladder
    node scripts/stress/run.mjs mesh4 dual10 # chosen scenarios

Needs Playwright's chromium (`apps/web` has the dep:
`apps/web/node_modules/.bin/playwright install chromium`).

## What it measures per scenario

- **all media flowing?** every peer receives every other peer's video stream
- **fps/stream, in/out Mbps** (5s getStats sample, per participant)
- **join latency** (all-streams-connected − call-start)
- **forwarder fan-out** (its PeerConnection count + upload Mbps — the ceiling)

## Tiny-video mode (probe higher N on one machine)

    TINY=1 node scripts/stress/run.mjs n12f2 n16f3 n20f4

`TINY=1` forces a few-pixel, low-fps camera + a hard bitrate cap, so one machine
can run many encoders. Quality is irrelevant to the fan-out **topology** under
test; this just removes the video-encode CPU that otherwise starves a single
laptop. Effect measured: fwd6 all-media-connected dropped from ~27 s (normal
fake camera) to **<1 s** — proving the join latency was CPU-encode, not protocol.

## Node-WebRTC scale harness (no browsers at all)

    node scripts/stress/node-scale.mjs 20 50 100

Runs N real SDK clients in ONE Node process via @roamhq/wrtc (RTCPeerConnection
+ synthetic tiny video), no Chromium. The shim (`node-shim.mjs`) installs the
WebRTC globals, a fake getUserMedia, and — critically — a **relay bridge**:
wrtc can't forward a received track to another PeerConnection (browsers can), so
the shim transparently pipes remote tracks through RTCVideoSink→RTCVideoSource,
making the forwarder topology work headless. Verified: N=6 forwarder → full 6/6,
exactly 30 relayed streams. This is the path to N=50-100 on one machine (peers
are objects, not processes); for N in the hundreds, shard across worker_threads.

## Empirical ceiling on ONE laptop

- **N ≤ 6, tiny video: rock solid** — all peers, all streams, sub-second.
- **N ≈ 10–12: marginal** — partial media, dominated by the rig.
- **N > 12: untestable here** — the wall becomes *running 12+ full Chromium
  instances* (memory + launch serialization), not the conference. Tell: at
  n=16–20 the forwarder upload reads ~0 Mbps (media never starts) — a resource
  collapse, not bandwidth saturation. Real large-N validation needs peers spread
  across machines/containers.

## Caveat

All N browsers run on ONE machine, each encoding video — so at high N the box's
CPU, not the protocol, can be the limit. The **relative** comparison at a fixed N
(1 forwarder vs 2) is the valid signal; absolute join times are inflated by
single-host contention. A true test spreads participants across machines.
