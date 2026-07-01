# Pochta — your mail, not their archive

*Pochta* (почта — Russian for "post office"): open, private, self-owned messaging
where the server is a **post office, not an archive** — it carries sealed messages
only until delivery, then forgets them.

> **This README is written to be a complete context document.** Paste it into an
> LLM (or hand it to a new contributor) and it should be enough to reason about
> the product and suggest improvements. Detailed phase history lives in
> [ROADMAP.md](ROADMAP.md); the client/relay wire contract is in
> [PROTOCOL.md](PROTOCOL.md); the reusable client SDK is
> [`@pochta-chat/sdk`](apps/web/src/sdk).

A WhatsApp-style chat + voice/video app where **your content stays end-to-end
encrypted**, **your account belongs to you (a keypair, not an email/company)**,
and **anyone can host the server**. The server is a dumb relay: it brokers the
WebRTC handshake, holds *encrypted* messages only until delivered (a bounded
buffer, not an archive), and serves the web client. History and keys live on the
device.

Not trying to replace WhatsApp — an **option** for people (a family, a company, a
community) who want a chat app they can trust and **self-host**, off the global
network.

## Core principles

1. **Content is end-to-end encrypted.** Every message/receipt is signed by the
   sender and sealed to the recipient. The relay only ever sees ciphertext.
2. **The server is a post office, not an archive.** It relays signaling + queues
   sealed messages until delivered, then GCs them (default 30-day window).
3. **Your account is a keypair on your device.** Identity = an Ed25519 key; a
   12-word phrase is the only backup. No email, no password server. A friendly
   `@name`/display name is just a label pointing at the key.
4. **Anyone can host.** The relay is one self-contained process (serves the
   client + relays + stores in SQLite). A family/company runs their own.
5. **Not blockchain.** Chat needs no global ledger; self-ownership comes from
   public-key crypto.

## Current status — what works today (all automated-tested)

- **Identity**: on-device Ed25519 keypair from a 12-word phrase; **encrypted at
  rest** under a passphrase (PBKDF2→AES-GCM); unlock on open.
- **Auth**: signature challenge (`sign(pubkey|encKey|ts)`), verified server-side
  with Erlang `:crypto`. No passwords.
- **E2E messaging**: sign-then-seal (Ed25519 + X25519 ECDH + XChaCha20-Poly1305).
- **Contacts + on-device history**: add by invite link/QR; messages + contacts
  persisted in **IndexedDB, encrypted at rest** (key derived from identity).
- **Reliable delivery**: store-and-forward on `chat_engine` — live when online,
  **durable cursor catch-up** (exactly-once, ordered) on reconnect.
- **Multi-device**: link a device with the same 12 words; sent messages are
  carbon-copied to your own inbox, received ones fan out — a new device
  reconstructs the full conversation from catch-up, and gets live updates.
- **Message states + typing**: sent · delivered · read ticks; typing indicator.
- **Presence**: online / last-seen.
- **Message ops**: edit (with marker), delete-for-everyone (tombstone) +
  delete-for-me, emoji reactions, reply/quote — all author-checked where it
  matters, multi-device consistent.
- **Media**: image attachments via a **content-blind encrypted blob store** (file
  encrypted on-device; only ciphertext uploaded; key travels inside the sealed
  message).
- **Voice/video calls**: 1:1 over WebRTC, signaled through the sealed inbox;
  media flows peer-to-peer.
- **Self-host**: relay serves the bundled client and connects same-origin; a
  `mix release` bundles ERTS + SPA + SQLite (no Elixir/Node needed to run).
- **Storage**: SQLite (default, plug-and-play) or Postgres — same
  dialect-agnostic Ecto adapters; contract-verified on both; durable across
  restart; retention GC.

## Tech stack

- **Relay (backend)**: Elixir + Phoenix (channels for signaling/inbox; a small
  HTTP surface for media blobs + serving the SPA). Bandit server.
- **Messaging core**: **`chat_engine`** — a separate Elixir library (the user's
  own project) providing ordering (gap-free `seq`), per-device cursors,
  exactly-once catch-up, presence, fan-out, and clustering behind pluggable
  *ports*. Depended on via path today.
- **Storage**: Ecto adapters implementing the engine's ports, over **SQLite**
  (`ecto_sqlite3`, default) or **Postgres** (`postgrex`). Chosen by config.
- **Client (frontend)**: React + Vite + TypeScript.
- **Crypto (client)**: `@noble/curves` (ed25519 + x25519), `@noble/ciphers`
  (xchacha20poly1305), `@noble/hashes`, `@scure/bip39`. WebCrypto (PBKDF2/AES-GCM)
  for the identity vault.
- **Realtime**: WebRTC (RTCPeerConnection, media + could-be DataChannel), STUN
  (Google public in dev; self/TURN later).
- **On-device storage**: IndexedDB (`idb`), encrypted at rest.

## Architecture

```
┌─────────────── device (browser / later desktop+mobile) ───────────────┐
│ React UI                                                                │
│  identity.ts  vault (passphrase→AES-GCM), Ed25519+X25519 keys           │
│  crypto.ts    sign-then-seal envelopes                                  │
│  db.ts        IndexedDB, encrypted at rest (messages, contacts, media)  │
│  client.ts    ONE socket → inbox channel; all app logic                 │
│  blobs.ts     encrypt→upload / download→decrypt media                   │
│  server.ts    which relay to talk to (same-origin default + override)   │
└───────────┬───────────────────────────────────────────┬────────────────┘
            │ WebSocket (Phoenix)                         │ HTTP (media blobs)
            ▼                                             ▼
┌──────────────────────── relay (Elixir/Phoenix) ────────────────────────┐
│ UserSocket    signature auth (Ed25519 via :crypto)                      │
│ InboxChannel  per-identity mailbox: send/deliver, receipts, typing,     │
│               presence query, AND call signaling — all opaque/sealed    │
│ EngineTransport → chat_engine (Session per device, cursor catch-up)     │
│ Ports.Db.*    Ecto adapters (SQLite default | Postgres) implement the   │
│               engine's Persistence/Cursor/Conversation/Receipt/Presence │
│ BlobController content-blind encrypted media store                      │
│ Retention     GC messages+blobs older than the window                   │
│ PageController serves the bundled SPA (single self-hosted deployable)   │
└─────────────────────────────────────────────────────────────────────────┘
  once two peers connect ──► direct P2P WebRTC media for calls (no server)
```

**Model that ties it together — the per-identity inbox.** Each account's inbox is
a single-member `chat_engine` conversation keyed by the public key. Sending to a
contact = `inject` a sealed envelope into *their* inbox; each of their devices is
a `Session` with its own cursor and catches up. Text, receipts, typing, reactions,
edits, media refs, and call signaling are all sealed payloads through this one
path. Calls then establish direct WebRTC media.

## Repo map

```
apps/web/src/
  sdk/            @pochta-chat/sdk — framework- & storage-agnostic client core:
    crypto.ts       seal()/open() — sign-then-seal (pure)
    identity.ts     keys, 12-word phrase, Vault(kv) — encrypted vault + device id
    client.ts       the messaging client (socket, inbox, all ops, calls); injects Store+URLs
    blobs.ts        media encrypt+upload / download+decrypt
    invite.ts enroll.ts protocol.ts types.ts   invites, private-relay enroll, wire consts, model+Store port
    index.ts        barrel export
  lib/            thin BROWSER bindings over the SDK (keep the app's imports stable):
    identity.ts     Vault(localStorage)
    db.ts           IndexedDB (encrypted at rest) implementing the SDK `Store`
    client.ts       injects the IndexedDB store + relay URLs into the SDK Client
    server.ts       relay URL selection (self-host)  ·  invite.ts / enroll.ts wrap SDK with httpBase()
  Welcome.tsx Unlock.tsx Messenger.tsx App.tsx AdminPanel.tsx   UI
apps/server/lib/
  signaling_web/channels/user_socket.ex     signature auth
  signaling_web/channels/inbox_channel.ex   the mailbox (+ call signaling)
  signaling_web/engine_transport.ex         engine → channel bridge
  signaling_web/controllers/blob_controller.ex, page_controller.ex
  signaling/ports/db/*.ex                    Ecto port adapters (SQLite/PG)
  signaling/retention.ex                     delivery-buffer GC
  signaling/migrations/*, release.ex         schema + boot migrate
../../db/engine                              chat_engine (separate library)
```

## Key design decisions (the "why")

- **Text goes through the relay, not P2P.** Offline delivery + multi-device need
  a fan-out/queue point; text is tiny so P2P buys nothing. WebRTC is reserved for
  **calls** (where P2P media matters). Standard messenger split.
- **Per-recipient sealing** (not a shared group key) — simple and correct for
  1:1. Trade-off: group chat will want sender-keys/MLS.
- **Server = bounded encrypted buffer.** Retention GC (30d) keeps it from being
  an archive; the durable truth is on devices.
- **No "primary" device.** Multi-device truth is the union of devices; because
  messages are immutable + id'd + `seq`-ordered, merges are conflict-free.
- **Storage behind ports** — SQLite for plug-and-play self-host, Postgres for
  scale, zero code change (proves `chat_engine`'s design).

## Known limitations & open questions (good topics to improve)

1. **Multi-device history beyond the retention window** — a device linked after
   messages are GC'd won't get them. Need **device-to-device sync** (WebRTC,
   `seq`-union) and/or an optional encrypted backup. *(designed, not built)*
2. **Per-device keys** — today all devices share one keypair (link via 12 words).
   Per-device keys would allow revoking a lost device without rotating identity.
3. **Group chat** — 1:1 today. Groups at scale want **sender-keys/MLS** (one
   ciphertext per message) and **group calls need an SFU** (media server).
4. **NAT/calls** — no **TURN** yet (calls fail on ~10–20% strict/cellular NATs).
5. **Media** — ✅ images, voice notes, and file attachments all work, with a
   **persistent encrypted on-device cache** (media survives past the server
   window). Remaining caveat: the blob store has no per-user authz (relies on an
   unguessable id + E2E encryption of the bytes).
6. **Packaging** — ✅ **Docker image works** (`docker build` → a ~168 MB
   self-contained relay; `chat_engine` is now vendored into the repo, so builds
   need no external paths). Remaining: a Burrito single-exe (double-click) for
   hosts who won't install Docker.
7. **Federation** — ✅ **relay-to-relay works and is hardened**: people on
   different self-hosted relays message each other. The home-relay hint rides in
   the invite + inside sealed bodies (replies federate; relay can't read
   anything). Forwards are **signed by a per-relay Ed25519 key** (verified +
   timestamp-checked; **unsigned/forged pushes are rejected**), gated by a
   **trust policy** (`:open` / `:allowlist` / `:tofu`, with revocation), and go
   through a **durable retry queue** (survive a peer being briefly down).
   Plus **origin binding**: on first contact the receiver reverse-fetches the
   claimed `/federation/identity` and confirms the pubkey — so no relay can
   impersonate another (trusting DNS+TLS). *Verified: two relays interoperate,
   unsigned push → 401, spoofed-origin push → 401, and a message sent while the
   peer was down is delivered when it returns.* Remaining: key rotation and the
   bigger **volunteer-mesh** (untrusted-node gossip/discovery/replication —
   `:syn` assumes trusted nodes).
8. **Human-readable @names** (Zooko's triangle) — the plan, both honest tiers:
   **local** `@raj:company.chat` (unique per relay, no registry — matches
   self-host, Slack/Matrix style) and **opt-in global** via DNS `.well-known`
   (Nostr NIP-05 / Bluesky — rent DNS's existing namespace). **Mobility** ("where's
   my inbox now") = a signed home-relay pointer (a `.well-known` record), v2.
9. **Mobile** — Capacitor/React Native + push (APNs/FCM via the engine's
   `OfflineQueue.Port` "doorbell"), CallKit, keychain key storage.
10. **Forward secrecy** — the recipient encryption key is long-lived; a Double
    Ratchet would add forward secrecy.

## Does the `chat_engine` need changes? (assessment)

Short answer: **no blockers — it's carrying the load well.** Nice-to-haves from
integrating it:

- **Presence change subscription.** We poll presence every 20s; a
  subscribe/notify-on-change API would remove the polling.
- **First-class "mailbox" pattern.** The engine is conversation-centric; our
  per-identity single-member inbox works but bypasses its group features
  (seen-by-N receipts, membership). A documented mailbox mode would fit E2E apps.
- **DX guardrails.** `append/2` (persist only) vs `inject/2` (persist + fan out)
  is an easy footgun; and the in-memory adapter accepts non-binary payloads while
  SQL adapters need binary — enforcing binary everywhere would fail fast.
- **Retention hook.** The engine has no log GC (bodies do it, as we did) — an
  optional retention policy per conversation would be handy.
- **Big one (future):** untrusted-node federation for the volunteer-relay vision
  (see open question #7) — a major feature, not a fix.

## Air-gap / private-network deployment (no global connection)

The system can run **fully self-contained** on a private network — no internet,
no third parties:

- **No CDN / web-fonts / external assets** — the client bundles everything.
- **ICE servers are relay-provided** (`GET /config`), operator-controlled. Set
  `config :signaling, :ice_servers, []` for a LAN (peers connect via local host
  candidates — **verified: calls connect with zero STUN**), or self-host **coturn**
  for cross-site STUN/TURN. Nothing is hardcoded to the outside.
- **Storage is local** (SQLite file). **TLS** via a private/internal CA (WebRTC +
  `getUserMedia` need a secure context off-localhost).
- The **only** unavoidable external dependency is **mobile background push**
  (APNs/FCM) — and it's optional: skip it for air-gap (foreground delivery), or
  use **UnifiedPush** (self-hostable) on Android. iOS can't do background push
  without APNs.

**Honest "how secure" framing** (so you can reason about real deployments):
- ✅ **Content is E2E** — the relay only ever holds ciphertext; it can't read
  messages or media.
- ✅ **Self-contained & auditable** — open source, no external calls required, you
  own every component.
- ⚠️ **The relay operator sees metadata** — who talks to whom, when, sizes,
  presence. In a family/company/government-*operator* deployment that's *their*
  server, so this is acceptable; it is **not** anonymity from the operator.
- ⚠️ **"100% secure" isn't a real claim.** Endpoint/device compromise is out of
  scope; a lost passphrase loses the account; and formal **government
  certification** (FIPS-validated crypto modules, Common Criteria, a security
  audit) is a *process* beyond the architecture — our crypto (Ed25519 / X25519 /
  XChaCha20-Poly1305 via audited `@noble` libs) is strong but **not FIPS-certified**.
  The design *supports* a hardened, certifiable deployment; certification is work.

## Self-host it

Easiest path is Docker — one image bundles the web client, the relay, and an
on-disk SQLite store, with **no Elixir/Node/pnpm on the host** and no external
paths (the messaging engine is vendored into the repo):

```sh
# build once, run anywhere Docker runs (Linux/Mac/Windows, a spare PC, a NAS…)
docker build -t pochta-relay .
docker run -p 4000:4000 -v chat-data:/data \
  -e SECRET_KEY_BASE=$(openssl rand -base64 48) \
  pochta-relay
# open http://localhost:4000 — the relay serves the client same-origin.
# The named volume `chat-data` persists the SQLite buffer + the relay's identity key.

# fully-PRIVATE, invite-only network (org/gov) — same image, three env vars:
docker run -p 4000:4000 -v chat-data:/data \
  -e SECRET_KEY_BASE=$(openssl rand -base64 48) \
  -e MEMBERSHIP_MODE=invite -e FEDERATION_MODE=closed \
  -e ADMIN_TOKEN=$(openssl rand -hex 16) \
  pochta-relay
# then open http://your-host/admin, sign in with ADMIN_TOKEN, and mint join tokens.
```

Put a TLS reverse proxy (Caddy/nginx) in front for anything off-localhost —
WebRTC/media need HTTPS. *(Verified: the image builds to ~168 MB; the container
boots, serves the client + `/admin` panel, enforces admin auth, and persists to
`/data`; the in-browser SPA completes a full admin round-trip against it.)*

### Without Docker

`pnpm build` bundles the client into the relay; run `mix phx.server` (dev) or a
`mix release` (prod, self-contained). The relay serves the client and connects
same-origin; the in-app server picker can target any relay (`wss://chat.myfamily.com`).

```sh
# dev (needs Elixir + Node)
pnpm build
cd apps/server && mix phx.server            # http://localhost:4000

# production release (no Elixir/Node needed to RUN it)
cd apps/server && MIX_ENV=prod mix release
SECRET_KEY_BASE=$(mix phx.gen.secret) PHX_SERVER=true PORT=4000 \
  PHX_HOST=chat.example.com DATABASE_PATH=/data/chat.db \
  _build/prod/rel/signaling/bin/signaling start
# put a TLS reverse proxy (Caddy/nginx) in front — WebRTC/media need HTTPS off-localhost

# fully-PRIVATE, invite-only network (org/gov): a sealed island, only enrolled members
MEMBERSHIP_MODE=invite FEDERATION_MODE=closed ADMIN_TOKEN=$(openssl rand -hex 16) \
  SECRET_KEY_BASE=... PHX_SERVER=true PORT=4000 DATABASE_PATH=/data/chat.db \
  _build/prod/rel/signaling/bin/signaling start
#  • no federation in/out (FEDERATION_MODE=closed → /federation/* return 403)
#  • only enrolled pubkeys connect (MEMBERSHIP_MODE=invite)
#  • admin mints a join token at https://relay/admin (web panel, sign in with ADMIN_TOKEN)
#  • member redeems it in-app via "Join private network", then connects
#  • run behind a firewall with ice_servers:[] (LAN) or self-hosted coturn → nothing leaves
```

### Operating a relay (admin)

Two ways to manage members, join tokens, and federated peers — pick whichever
fits the operator.

**Web panel (for non-technical admins).** Set an `ADMIN_TOKEN` on the relay and
open **`https://your-relay/admin`** in a browser. Sign in with the token; you get
a point-and-click UI to mint join tokens, add/remove members, and allow/revoke
federated peers — no shell required. The panel is the same self-hosted bundle
(served at `/admin`) and talks to a Bearer-guarded `/admin/*` JSON API; if
`ADMIN_TOKEN` is unset the API is disabled and the panel can't sign in.

**CLI (for operators on the box).** The same operations via `Signaling.Admin` —
`bin/signaling rpc "..."` on a release, or `mix relay.*` in dev (these open only
the DB, so they're safe to run while the server is live):

```sh
mix relay.token                     # mint a one-time join token to hand a member
mix relay.members                   # list members
mix relay.members add <pubkey>      # add / remove a member
mix relay.members remove <pubkey>
mix relay.peers                     # list federated peer relays + trust state
mix relay.peers allow <origin>      # trust a peer relay (fetches + binds its key)
mix relay.peers revoke <pubkey>     # revoke a peer
# release equivalents, e.g.:  bin/signaling rpc "Signaling.Admin.mint_token()"
```

## Run in development

```sh
pnpm install
pnpm setup:server        # mix deps.get (first time)
pnpm dev:server          # relay on :4000  (SQLite file, no external DB)
pnpm dev:web             # web on :5173/:5180 (Vite, talks to :4000)
```

Open two browsers, create an account in each, share the invite link, and chat.

## Reference designs worth studying

- **Nostr** — keypair identity, dumb interchangeable relays (closest to the
  vision).
- **Signal** — E2E, sealed sender, per-device keys, Double Ratchet.
- **Matrix** — federated self-hostable servers.
- **Bluesky / AT Protocol** — DID (key) + human-friendly `@handle` on top.

## License

MIT © Emad Jumaah
