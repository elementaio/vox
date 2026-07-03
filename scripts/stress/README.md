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

## Caveat

All N browsers run on ONE machine, each encoding video — so at high N the box's
CPU, not the protocol, can be the limit. The **relative** comparison at a fixed N
(1 forwarder vs 2) is the valid signal; absolute join times are inflated by
single-host contention. A true test spreads participants across machines.
