# Pochta deployment — self-host any part, choose your quality

Pochta ships **every service as a ready-to-host building block.** You choose which
ones to run — and that choice *is* your network's quality and independence. Nothing
depends on a central company: a "provider" is just a *full* deployment that others
can optionally borrow the heavy, content-blind pieces from. Run all of it, run one
piece, or mix — your call.

## The building blocks

| Service | What it does | Sees messages? | Weight |
|---|---|---|---|
| **Chat relay** (Pochta / Elixir) | signaling + sealed store-and-forward + serves the client + federation + media blobs | **No** — ciphertext only | light · **required** |
| **STUN** | peers discover their public address for a call | No — an IP query | tiny |
| **TURN** | relays call **media** when direct P2P fails (strict/cellular NAT) | **No** — media is SRTP-encrypted | **bandwidth-heavy** |
| **Push gateway** | "wake device X" → an APNs/FCM push | **No** — contentless ping | tiny |

**STUN + TURN are one daemon ([coturn](https://github.com/coturn/coturn)).** So the
full stack is **three processes**: relay, coturn, push.

**All four are content-blind** — so you can self-host the chat relay for full data
ownership *and* borrow someone's STUN/TURN/push without breaking E2E. The only thing
you share with a borrowed service is metadata (IPs/timing); a maximum-privacy org
self-hosts coturn (and push) too.

## Choose your quality

Every row is a self-host choice. Add services as you want more reach — combine freely.

| You run… | Calls work… | Mobile push | Good for |
|---|---|---|---|
| **Relay only** | same LAN / VPN only | none (foreground only) | air-gap, a home/office LAN, testing |
| **+ STUN** (public or your own) | most of the internet | none | small groups across the internet |
| **+ TURN** (your coturn) | **everywhere**, incl. strict/cellular NAT | none | reliable calls for everyone |
| **+ Push** (your app's APNs/FCM) | everywhere | **background notifications** | a real mobile product |

"Quality" = how many of your users' calls connect and whether phones get woken in
the background. You dial it in by choosing services — no code changes, just what you
deploy and what `GET /config` advertises.

## One server, or several?

**One good VPS runs the whole stack** (relay + coturn + push) for small/medium use —
see [`deploy/docker-compose.fullstack.yml`](deploy/docker-compose.fullstack.yml).
Split onto separate servers only at scale, **TURN first** (it relays every fallback
call's media = the bandwidth hog); then run several chat relays behind a load
balancer (they cluster; move the DB to Postgres). Push stays tiny anywhere.

Ports to open:

| Port | Proto | Service |
|---|---|---|
| 4000 (or 443 via proxy) | TCP | chat relay (HTTP/WS) |
| 3478 | UDP + TCP | STUN + TURN |
| 5349 | TCP | TURN over TLS |
| 49160–49200 | UDP | TURN media relay range |

## Public vs. self-host

- **STUN — public is fine.** Google's `stun.l.google.com:19302` is the default; or
  point at your own coturn.
- **TURN — no free public option exists** (it costs bandwidth). Self-host coturn
  (packaged here) or pay a TURN provider (Twilio/Cloudflare/Metered/Xirsys).
- **Push — needs your own app's store credentials** (Apple Developer + a published
  app). If you ship your own app with the [SDK](packages/sdk), you get your own
  APNs/FCM → your own push. Otherwise borrow a backbone's (contentless, so privacy
  holds), or skip it.

The relay hardcodes none of this — when you set `TURN_URLS` + `TURN_SECRET`, it hands
each client **time-limited TURN credentials** (coturn's REST scheme), so the shared
secret never ships to a client.

## Ready setups

### Full stack — own everything
Chat relay + coturn (STUN/TURN), on one box. This is what a **provider** runs and
what any **developer/org** runs to be fully independent (add your own push once you
ship an app).

```sh
cd deploy
cp .env.example .env      # set SECRET_KEY_BASE, TURN_SECRET, PHX_HOST, PUBLIC_URL
docker compose -f docker-compose.fullstack.yml up -d
```

### Relay only — lean, borrow a backbone
Run just the chat relay (own your data + E2E) and point calls at a backbone's TURN
(or none). Content-blind, so E2E is intact.

```sh
cd deploy
cp .env.example .env      # SECRET_KEY_BASE (+ TURN_URLS/TURN_SECRET to use a TURN)
docker compose -f docker-compose.relay-only.yml up -d
```

### Regular user — no Docker
A self-contained release (~33 MB, no Elixir/Node) + one launcher; borrow a backbone
for STUN/TURN/push.

```sh
cd apps/server && MIX_ENV=prod mix release       # one-time build (needs Elixir)
./scripts/pochta-server.sh                        # http://localhost:4000  (Windows: .bat)
```

## Push notifications (the one that needs store credentials)

Mobile OSes kill background sockets, so a **push wakes the app**, which then pulls
the sealed message from its inbox and decrypts on-device. The push is a **contentless
ping** (with sealed-sender, not even who-from).

The **push gateway** holds the APNs (Apple) + FCM (Google) credentials and does one
job: "wake device X." It's the one service that isn't freely self-hostable *unless you
publish your own app* — because APNs/FCM require an Apple/Google account tied to a
store app. Since a developer using the SDK ships their own app anyway, they also get
their own push. Others borrow a backbone's push (contentless) or use Android's
self-hostable **UnifiedPush**. Engine hook: `OfflineQueue.Port.notify/3`.
*(Status: designed; built with the mobile apps, which supply the store creds.)*

## Donor nodes (reserved for the future)

Today the backbone stack is **ours**, and any developer/org can self-host the same
stack. The next tier is **donors** — volunteers who lend a computer + bandwidth to
strengthen the network (the "donate your machine" model), the way Tor/IPFS nodes do.

**Safe to donate — the whole reason this works.** Every service is content-blind, so
a donor only ever handles **ciphertext**. They can't read messages, can't be asked to
moderate content, and carry little liability — which is exactly what makes strangers'
machines usable.

**What a donor can actually run** (ranked by value / fit):

| Donor runs | Why it's the best fit | Content-blind? |
|---|---|---|
| **TURN relay** (coturn) | the single most **expensive** piece (call media = bandwidth); trivial to add to a pool; donating it directly funds free calls | yes — encrypted media only |
| **Relay node** (store-and-forward) | more relays = redundancy + geographic reach + no single point; the "donate your computer" node | yes — sealed queue |
| **Encrypted blob storage** | disk for media too big to inline (content-addressed, redundant, IPFS-style) | yes — encrypted blobs |
| **STUN / bootstrap node** | cheap; helps new nodes and clients discover the network | yes — just IP queries |

**What a donor *can't* do** — and that's a feature: **read or moderate content**
(E2E forbids it), or **send push** (APNs/FCM need the app owner's store credentials).
So push stays with whoever publishes the app; donors handle the content-blind bulk.

**What's still needed (Phase 4 mesh):** a donor node is just a packaged relay/coturn
that **federates** in (signed, origin-bound, revocable). To lean on *untrusted*
donors at scale we still need gossip discovery, **message replication across several
nodes** for uptime, node identity + reputation (so a flaky/malicious donor is routed
around), and NAT hole-punching for home machines. The content-blind + signed-federation
foundation is built to grow into this; the mesh layer is the remaining work.

So: provider stack now → self-hostable by anyone → donor mesh later, with nothing in
today's architecture blocking that path.

## In one line

Everything is packaged to self-host. Pick the services that match the quality you
want; a backbone exists for whoever doesn't want to run the heavy bits — but never
as a dependency — and donor nodes have a reserved place in the network's future.
