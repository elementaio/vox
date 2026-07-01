# Roadmap

**Pochta** (почта — Russian for "post office"). The name encodes the core
principle: the relay is a **post office, not an archive** — it carries sealed
messages and holds them only until delivery, then forgets them.

The guiding constraint: **every phase keeps the door open to full
decentralization.** The one decision that makes this possible is made in Phase 2
— identity is a device-generated keypair, and you connect to people by link/QR,
with human-friendly names layered on top as *pointers*, never as the account
itself. Get that right and everything after it is evolution, not rewrite.

---

## Phase 1 — P2P over one relay ✅ (done)

- Monorepo: Phoenix signaling relay + React/WebRTC client.
- Room-based signaling: share a room name, everyone who joins connects.
- WebRTC mesh: direct P2P text chat + optional voice/video (small groups).
- Server relays signaling only; never sees content.

**Proven:** headless test confirms the relay routes signaling correctly and
never loops a message back to its sender.

---

## Phase 2 — Self-owned identity (next)

The decision that unlocks decentralization. Nothing here is centralized.

- **Identity = an Ed25519 keypair generated on-device.** The public key *is* the
  account. The private key never leaves the device.
- **Recovery = a 12-word seed phrase** (like a crypto wallet), shown as
  "Save my account." The only way to move/restore an account — no company reset,
  because no company holds it.
- **Auth by signature, not passwords.** The client signs a challenge; the relay
  verifies it against the claimed public key. No password store, no email-owned
  account.
- **Connect by link/QR (the grandma path).** An invite carries the inviter's
  identity; tap it and you're connected — no names to type, impossible to
  impersonate.
- **Friendly display name** derived deterministically from the key (e.g.
  `moon-otter-4821`) so people see *who*, not a hex string.

---

## Phase 2.5 — End-to-end message security ✅ (done)

Every chat message is **signed then sealed**:

- **Sign** with the sender's Ed25519 identity key → verifiable authorship
  (blocks impersonation, even inside a group).
- **Seal** to the recipient with X25519 ECDH + XChaCha20-Poly1305 → only the
  recipient can read it; any relay or middle box sees only ciphertext.
- The encryption key is **bound to the identity** (we sign `pubkey|enc|ts`), so
  a malicious relay can't swap in its own key to MITM.

This is what makes relayed/offline delivery safe (Phase 3/4): the server carries
sealed envelopes it cannot read, forge, or tamper.

**Verified:** round-trip decrypt, tampered-ciphertext rejected, non-recipient
blocked, author-mismatch caught; full socket path passes.

*Future hardening:* Double Ratchet for forward secrecy (today the recipient key
is long-lived); group keys for large rooms.

---

## Phase 3 — Store-and-forward, many relays, @names

Split into buildable steps (start simple, test, move forward):

### 3a — Offline delivery (store-and-forward) ← the backbone

The piece everything else hangs off (push, media, multi-relay). Today messages
only flow P2P when both peers are online; if the recipient is offline the message
is lost. 3a adds an **identity-addressed mailbox** on the relay:

- Each user has a private **inbox** keyed by their public key. A socket may only
  join its *own* inbox (enforced by the authenticated pubkey).
- Sending: if a live **P2P DataChannel** is open → send direct (fast, private).
  If not → send the **sealed envelope** to the recipient's inbox; the relay
  delivers it live if they're online, or **queues** it until they reconnect,
  then **drops it after delivery**.
- The relay only ever holds **ciphertext** (Phase 2.5 sealing) — it can't read,
  forge, or reorder. This is the "post office, not archive" model, realized.
- **✅ Now backed by `chat_engine`.** The hand-rolled queue was replaced by the
  engine: each identity's inbox is a single-member conversation, each device runs
  a `Chat.Session` (cursor catch-up on reconnect), and senders `inject` sealed
  envelopes. We get gap-free `seq`, exactly-once cursor catch-up, presence, and
  clustering-readiness — verified: durable catch-up across reconnect, no
  re-delivery of seen messages, ordered by seq. Still in-memory adapters (lost on
  restart); swapping to Postgres adapters is config-only, no code change.

**Regular chat features (built on the same sealed transport):**

- **Message states — sent · delivered · read.** Each message carries an id.
  *Sent* = the relay/peer accepted it. *Delivered* = the recipient's device got
  it (it sends back a signed `delivered` receipt). *Read* = the recipient viewed
  it (`read` receipt). Receipts are themselves tiny sealed+signed messages, so
  they're authentic and private (maps to the engine's `ReceiptStore`).
- **Typing indicator.** An **ephemeral** signal — delivered live to online peers,
  never queued (if you're offline, "typing" is meaningless). Matches the engine's
  `:ephemeral` kind (live-only, no persistence).
- Users get a privacy toggle for read receipts / typing, like other messengers.

### 3a.1 — Messenger UX & on-device history ✅ (done)

Turned the room prototype into a real messenger:

- **Contacts, not rooms.** You add people by opening their invite link (carries
  their public + encryption key + name); an incoming message auto-adds the
  sender. Conversation list with previews, unread badges, and live typing.
- **History lives on the device** (IndexedDB) — messages and contacts persist
  across reloads; the server keeps nothing. Verified: reload restores the
  conversation.
- **Text flows through the engine inbox** uniformly (live when online, queued
  when offline) — always sealed. Per-message sent/delivered/read ticks + typing.
- Verified end-to-end in a real browser (Playwright): two users onboard, connect
  by invite, exchange messages, receipts go blue on read, and history survives a
  reload.

### 3a.2 — Voice & video calls ✅ (done)

1:1 audio/video calls over WebRTC, **signaled through the sealed inbox** — no
separate signaling channel:

- Call offer/answer/ICE ride as **ephemeral sealed messages** (live-only, never
  queued) addressed to the contact. Once the handshake completes, **media flows
  directly peer-to-peer** (DTLS-SRTP) — the server never sees or relays it.
- Incoming-call banner (accept/decline), in-call overlay with local + remote
  video, hang-up. Reused for voice (audio-only) and video.
- This let us **retire the room-mesh entirely** — the inbox is now the whole
  client-facing surface (messages, receipts, typing, and calls). `room.ts` /
  `RoomChannel` were removed.
- Verified end-to-end in real Chrome (fake media): call connects on both sides,
  **real video frames flow P2P**, hang-up tears down cleanly.

*Next for calls:* TURN fallback for strict/cellular NAT; group calls (mesh over
inbox signaling).

### 3a.3 — Secure, durable on-device storage ✅ (done)

The device store is the **only** copy of your data (the relay keeps nothing), so
it must be both durable and secure:

- **Encrypted at rest.** The seed phrase is sealed under a **passphrase**
  (PBKDF2-SHA256 → AES-GCM); you unlock on open. Message text and contact names
  in IndexedDB are sealed with XChaCha20-Poly1305 under a key derived from the
  identity. Public keys/timestamps stay clear so the store is still
  indexable/sortable, but **content is unreadable on disk without the account**.
- **Durable.** `navigator.storage.persist()` asks the browser not to evict;
  history survives reloads.
- **Sign-out wipes** the account vault + local history.
- Verified in-browser: message text is **ciphertext on disk**, localStorage
  holds **no plaintext seed**, reload **requires the passphrase**, a wrong
  passphrase is rejected, and history **decrypts + restores** after unlock.

*Desktop/mobile later:* hold the key in the OS keychain (biometric unlock) for a
smoother-yet-secure experience.

## Multi-device: delivery durability & sync (cross-cutting)

Multi-device is non-negotiable for a modern chat app. The design that makes it
work **without** turning the server into an archive:

**There is no "primary" device.** The source of truth is the **union of all your
devices**. Because every message is **immutable, uniquely id'd, and `seq`-ordered
by the engine**, merging two devices' histories is a conflict-free union+dedup by
id. No election, no "main" device.

**The server is a bounded, encrypted *delivery buffer* — not an archive.**
- An account (identity) has **many devices**, each a `device_id` with its **own
  engine cursor**. The relay fans each sealed message out to **every** device and
  catches each up on reconnect (this is exactly what the engine's per-device
  cursors are for — the "unused" part now earns its keep).
- Retain each sealed message only until **all registered devices have acked it**
  (min-cursor GC), with a **bounded backstop window** (e.g. 30 days) for a device
  that stays offline. It's always ciphertext; the server can't read it. This is
  what everyone (Signal/WhatsApp) does — the objection to "server retention" is
  really an objection to *plaintext + forever*, and we do neither.

**The account inbox doubles as the multi-device sync log.** Received messages,
**carbon copies of your sent messages**, and receipts all flow through your
account inbox. So a device catches up the *full* conversation history (sent +
received + status) from the account-inbox log via its cursor — within the
retention window. Delivery *and* history sync both fall out of this.

**Beyond the window / cold-start:** two of your devices, when online together,
**sync device-to-device** (WebRTC data channel, `seq`-union merge) to fill gaps
and bootstrap a fresh device. Fallbacks: "history from now" (Signal's choice) or
an **optional encrypted backup** blob for seamless new-device history.

**Device identity:** start with a **shared key** (link a device by 12-words / QR
— same identity decrypts the same sealed messages). Later, **per-device keys**
(Signal-style) so a lost device can be revoked without rotating the account.

Build order: **(1) carbon sent-messages → all devices see sent + received ✅**
→ **(2) retention GC (all-acked + window)** → **(3) device-to-device seq-union
sync** → **(4) per-device keys / encrypted backup**.

**✅ (1) done.** A message you send is carbon-copied (sealed to yourself) into
your own account inbox; received messages and receipts already fan out there. So
a second device — linked by restoring the same 12 words — **reconstructs the full
conversation (sent + received) from the account-inbox catch-up**, and sees new
messages live. Verified end-to-end in the browser with two same-identity devices.

**✅ (2) retention GC done.** `Signaling.Retention` sweeps messages older than the
retention window (default 30 days) — the "bounded encrypted delivery buffer, not
an archive" made real. Verified (unit test: expired dropped, recent kept).
Remaining: device-to-device sync beyond the window, per-device keys.

## Modern chat features (edit / delete / reactions / replies …) ✅ (done)

These fit the E2E + append-only model cleanly: they are **not mutations** but new
**typed ops that reference a target message id**, sealed and delivered like any
message, and applied by every device (so they stay multi-device consistent).

**✅ Built & verified in-browser:** edit (with "edited" marker), delete-for-
everyone (tombstone) + delete-for-me (local), emoji reactions (toggle, counts),
reply/quote, and **on-device search** (over the decrypted local store — the
server can't search ciphertext) — all propagate to the peer *and* carbon to your
own devices, with **author-only** enforcement on edit/delete. Remaining from this
family: forward, pin/star.

- **Edit** — `{t: edit, targetId, newText}` → update the target, show an "edited"
  marker (keep prior version locally if desired).
- **Delete for everyone** — `{t: delete, targetId}` → recipients tombstone the
  message. **Best-effort** (a peer already has the plaintext; a hostile client
  can ignore it) — same honest caveat as every messenger.
- **Delete for me** — local only, never sent.
- **Reactions / replies (quote) / forward / pin / star** — all the same shape:
  small sealed ops keyed by message id.
- **On-device search** — over the *decrypted local* store (the server can't search
  ciphertext, and shouldn't).

Because ops are id-keyed and append-only, they merge across devices with no
conflicts — the same property that makes multi-device sync work.

### 3a.4 — Durable server storage ✅ (done)

The relay's queue is now durable, and **plug-and-play**:

- **SQLite on disk by default** — no external database to install. A donor/self-
  hosted relay just runs and creates a `.db` file. (The *device* store stays
  IndexedDB, encrypted — unrelated; this is the *server's* delivery buffer.)
- **Postgres by a one-line config swap** for a large clustered relay — the
  adapters are **dialect-agnostic Ecto** (`Signaling.Ports.Db.*`), so the *same
  code* runs on both. This is the ports design fully realized.
- **Contract-verified on both backends** (the engine's executable
  `Chat.Persistence.PortTest`: idempotency, gap-free monotonic seq, ordered
  read, CP-fence) and **durable across a real relay restart** (message queued →
  kill+restart → still delivered from disk).
- This also removes the earlier bottleneck (the single in-memory persistence
  GenServer): reads/writes go to the DB, and per-conversation ordering stays at
  the app layer via the engine's single-writer owner.

### 3a.5 — Presence (online / last-seen) ✅ (done)

- The client queries the relay for contacts' presence (on connect, on opening a
  chat, and every 20s). Green dot in the contact list; **"online" / "last seen
  Xm ago"** in the conversation header.
- Uses the engine's presence tracking (sessions register on connect; `last_seen`
  is recorded on disconnect) — now backed by the durable store. Another
  previously-"unused" engine port turned into a visible feature.
- Verified: a peer reports online while connected, then offline with a
  `last_seen` timestamp after disconnect.

## Packaging & distribution — run the relay on Windows/Mac/Linux

The relay must run anywhere, for **two audiences** (the split the product needs):

**Level 1 — developers / operators: Docker ✅ (done).** `docker build` → a ~168 MB
self-contained image (client + relay + SQLite), runs on any OS with Docker, no
Elixir/Node on the host. This is the server-operator path — see "Self-hosting".

**Level 2 — regular users: double-click, no Docker (next).** A non-technical
person should install the relay like any desktop app on **Windows, macOS, or
Linux**. Two complementary routes over the same `mix release` (which bundles the
app + engine + ERTS — the target needs no Elixir/Erlang):

- **Burrito** — wrap the release as a single self-extracting **`.exe` / macOS /
  Linux binary**. Pure "download and run a relay," no UI.
- **Tauri tray app** — the likely best fit for a *regular user*: a tiny native
  desktop app (Rust + webview, a few MB) that embeds the relay release as a
  **sidecar** and shows a tray icon ("Pochta running · donating"), handling
  autostart and (UPnP) reachability. This is also the natural home for the
  **desktop client** (Phase 5) — one app that can *be* your client and optionally
  *run* a relay for your family, dovetailing with the volunteer-node vision.
- **SQLite is what makes this plug-and-play** — no DB to install alongside.
- Caveats: NIFs (exqlite) need per-platform precompiled binaries (exqlite ships
  them); code-signing for clean installs; NAT reachability is the Phase-4 mesh
  piece (packaging gets it *running*, mesh makes it *useful*).

## Self-hosting ✅ (done) — the private-server model

The nearest-term realization of the vision: a family/company runs **their own
relay**, off the global network. Delivered:

- **Configurable server** — the client targets the **same origin it was served
  from** by default, with an in-app override (server picker) to point at any
  relay. So visiting your family server's URL "just works."
- **Single deployable** — the relay serves the bundled web client *and* relays
  signaling *and* holds the encrypted SQLite delivery buffer, one process, no
  external DB. Same-origin ⇒ no CORS in prod.
- **Self-contained prod release** — `mix release` bundles ERTS + SPA + SQLite;
  runs with **no Elixir/Node on the server**. **Verified**: release serves the
  SPA and full E2E messaging works against it.

- **Docker image ✅** — a multi-stage `Dockerfile` builds the web client and the
  release into one ~168 MB image; `chat_engine` is **vendored into the repo**
  (`apps/server/vendor`, re-synced via `scripts/vendor-engine.sh`), so
  `docker build` needs no Elixir/Node/pnpm on the host and no external paths.
  **Verified**: container boots, serves the client + `/admin` panel, enforces
  admin auth, persists the SQLite buffer + relay identity to a `/data` volume,
  and the in-browser SPA completes a full admin round-trip against it.

*Packaging follow-up:* a Burrito single-exe (double-click, no Docker) for hosts
who won't run a container — the vendored engine unblocks this too.

**✅ Air-gap capable.** No CDN/fonts/external assets; **ICE servers are
relay-provided** (`GET /config`, operator-controlled) — set `ice_servers: []` for
a LAN (**verified: calls connect with zero STUN** via host candidates) or point
at self-hosted coturn. Storage is a local SQLite file; TLS via a private CA. The
only unavoidable external dependency is optional **mobile background push**
(APNs/FCM); skip it for air-gap, or UnifiedPush on Android. Honest caveats:
relay-operator sees metadata (fine when the org *is* the operator); endpoint
security and formal certification (FIPS/CC) are out of scope of the architecture.

## Federation ✅ (MVP done) — islands → a network

Solves the "different self-hosted servers can't reach each other" problem from
the design conversation, without a global directory:

- **Discovery** — a contact carries a **home-relay hint** (in the invite); the
  sender's relay **forwards** a remote-addressed sealed envelope to the
  recipient's relay (`POST /federation/push`). The hint also rides **inside the
  sealed body**, so replies federate and it's not spoofable by a relay.
- **Verified**: two independent relays (separate DBs) — Alice on A, Bob on B —
  message each other both directions.
- **Naming plan** (Zooko's triangle, two honest tiers): local `@raj:company.chat`
  (unique per relay, no registry) + opt-in global via DNS `.well-known`
  (NIP-05/Bluesky).
- **Mobility**: keypair is portable; "current home relay" becomes a signed
  pointer (v2).
**✅ Hardened (signed auth + durable retry):**

- **Signed server-to-server auth.** Each relay has its own **Ed25519 keypair**
  (`RelayIdentity`, persisted to disk, served at `GET /federation/identity`).
  Forwards are signed (`sign(relay_pub|ts|to|msg_id)`, `X-Relay-*` headers); the
  receiver verifies the signature + a fresh timestamp (replay protection) and
  **rejects anything unsigned/forged (401)** — the "open relay" hole is closed.
  Content stays E2E; this is a trust layer *around* the sealed pipe.
- **Trust policy** (`:federation_policy` config): `:open` (accept any
  signature-verified relay), `:allowlist` (only operator-approved peers), or
  `:tofu`. **Revocation** (`known_relays.revoked_at`) honored in all modes — the
  table carries it from day one (cheap now, annoying to retrofit).
- **Durable retry queue.** Forwards go through a DB **outbox** and retry with
  exponential backoff, so a briefly-down peer doesn't lose messages. **Verified:**
  sent while the peer relay was down → delivered automatically once it returned.

- **Origin binding (✅ done).** On first contact the receiver reverse-fetches the
  claimed `<origin>/federation/identity` and confirms it serves the same pubkey —
  so a relay can't lie about *which* origin it is (trusting DNS+TLS, the web's
  existing root). Once bound, later pushes short-circuit. **Verified:** a push
  with a valid signature but a spoofed origin (claiming to be relay A with a
  non-A key) is rejected (401).

*Remaining hardening:* key rotation ceremony, and the bigger volunteer-mesh
(untrusted gossip/discovery/replication — `:syn` assumes trusted nodes).

## Private / guarded deployment ✅ (done) — for orgs & gov

Two config knobs turn a relay into a locked-down private network:

- **Closed federation** (`FEDERATION_MODE=closed`) — a **sealed island**: no
  messages in or out. `/federation/*` return 403, and any client send addressed
  to an external relay is blocked (`federation_disabled`). Combined with running
  on a private network (no internet, self-hosted STUN or LAN host candidates),
  nothing leaves the org. **Verified.**
- **Guarded membership** (`MEMBERSHIP_MODE=invite`) — only **enrolled pubkeys**
  may connect. Joining is by a one-time **enroll token** an admin mints
  (`POST /admin/enroll_token`, Bearer `ADMIN_TOKEN`) and hands out; the member
  redeems it with a signed `POST /enroll` (signature proves they hold the
  keypair). Enforced at socket connect. **Verified:** unenrolled refused → admin
  token → signed enroll (single-use) → connects. Client has a "Join private
  network" flow.

Defaults are `:open` (public relay), so nothing changes for open deployments.
A company/gov runs `MEMBERSHIP_MODE=invite FEDERATION_MODE=closed ADMIN_TOKEN=…`
behind their firewall for a fully-private, invite-only network.

**✅ Operator surface (web panel + admin CLI).** Two front-ends over the same
`Signaling.Admin` operations — mint join tokens, list/add/remove members, and
**allowlist / revoke / list federated peer relays** (the peering UX for internal
multi-relay orgs):

- **Web panel for non-technical admins** — `https://relay/admin`, sign in with
  `ADMIN_TOKEN`, point-and-click. Served from the same self-hosted bundle; backed
  by a Bearer-guarded `/admin/*` JSON API (disabled when `ADMIN_TOKEN` is unset).
  **Verified** (Playwright: login rejects wrong token, mints a token, adds/removes
  a member, lists peers).
- **CLI for operators on the box** — `mix relay.*` tasks (and `bin/signaling rpc`
  on a release). The tasks open only the DB, so they're safe to run alongside a
  live server. Verified (unit tests + tasks exercised).

### 3b — Multiple interchangeable relays

- Client publishes/subscribes across **several relays**; if one dies, switch —
  identity and history (on-device) are unaffected.

### 3c — Human-friendly @handles

- **Optional `@handle`** (e.g. `@grandma.ourapp.chat`) that *points at* the key,
  Bluesky/Nostr-style. Free subdomains for regular users; bring-your-own-domain
  for power users. The handle issuer controls only the nametag namespace — never
  the account.

---

## Phase 4 — Volunteer nodes, no central server

- A **lightweight relay any Mac/PC can run**, bundled in the desktop app behind
  a "donate my computer + internet" toggle (opt-in, like a Tor/IPFS node).
- Real challenges to solve here:
  1. **NAT** — home machines aren't reachable inbound; nodes connect *outward*
     into the mesh and gossip (+ hole-punching).
  2. **Uptime** — home machines sleep; so each queued message is **replicated
     across several nodes** for redundancy.
  3. **Trust** — volunteers are untrusted: E2E encryption means they only see
     ciphertext; signatures stop tampering; redundancy limits dropping/censoring.
- Note: the engine's current `:syn` clustering assumes *trusted* datacenter
  nodes. Opening to *untrusted* volunteer nodes on the public internet is a
  separate layer (node identity keys, gossip discovery, replication) — study how
  Nostr relays / IPFS nodes discover each other.

---

## Phase 5 — Desktop app

- Wrap the web client in **Tauri** (small, secure) or Electron.
- Secure OS keychain storage for the private key.
- Bundle the optional volunteer-node from Phase 4.

---

## Mobile delivery & media (cross-cutting)

How this works on phones, where background sockets get killed and content can be
large. None of it reworks the core — it's **additive**.

### Push notifications — the "doorbell"

- Mobile OSes kill background connections, so you can't rely on a live socket to
  receive messages when the app is closed. A **push wakes the app**; the app then
  pulls the sealed message from its inbox (Phase 3a) and decrypts on-device.
- Push is a **best-effort hint, never the source of truth** — Apple/Google may
  delay or drop it. The inbox queue is the truth; push just triggers an earlier
  reconnect. (Engine hook: `Chat.OfflineQueue.Port.notify/3`.)
- **Push gateway** (small, app-operated): holds the APNs/FCM credentials and does
  one job — turn "wake device X" into a platform push. It sees only a device
  token + opaque ping; **no plaintext, and with sealed-sender not even who
  from**. A random volunteer relay can't hold Apple/Google keys, so this one
  dependency is centralized — as it is for *every* iOS/Android messenger,
  including Signal.
- **What the user sees vs. what servers see:** the push arrives sealed; an iOS
  Notification Service Extension / Android background handler **decrypts it on the
  phone before the banner shows**. So the lock screen can display the full message
  ("Sammy: see you at 6") while Apple/Google/the gateway only ever saw ciphertext.
  User picks a privacy level: full preview · sender only · "New message".
- **Decentralization options:** Android can use **UnifiedPush** (open standard,
  user-chosen/self-hostable provider) or a foreground service; iOS is APNs-bound.
  Default to the gateway for ease; let power users opt out.

### Media — images, voice messages, files

**✅ Images, voice notes, AND files done (encrypted blob store).** The relay has a
content-blind blob store (`/blobs` upload/download): the client encrypts the file
on-device with a fresh key, uploads only ciphertext, and puts the key inside the
E2E-sealed message — so the relay can't read the media. **Images** render inline;
**voice notes** (recorded with `MediaRecorder`) play inline; **any file** (PDF,
doc, zip…) shows as a download link with its filename. The blob ref (incl. key)
is stored **encrypted at rest** and carboned to your other devices; blobs are
swept by retention. **On first view/send the decrypted media is cached on-device
(IndexedDB, encrypted at rest)** — so it renders without re-download and
**survives past the server's retention window** (truly device-owned, upholding
"history on device"). All verified in the browser (incl. persistence across
reload).

- **Live voice/video call** = native WebRTC media (RTP/SRTP). This is its core.
- **Voice *message* / image / file** = NOT live media — a recorded blob sent like
  a message:
  - **Both online** → send over the **WebRTC DataChannel**, chunked (arbitrary
    binary). Voice notes recorded via `MediaRecorder` → Opus/WebM blob.
  - **Offline / large** → encrypt the file on-device, upload **ciphertext** to a
    blob store, and send a small **sealed message with `{url, key, hash}`**. The
    store only holds an encrypted blob; recipient downloads and decrypts locally.
  - **Decentralized blob store:** volunteer nodes host encrypted blobs
    redundantly (content-addressed, IPFS-style) — the "donate your computer"
    model extended to media. Small thumbnails ride inline for instant preview.

---

## Open backend — third-party & off-the-shelf clients (the protocol question)

**Vision:** the *backend* (the relay) is a product in its own right. We ship our
own reference clients (web/desktop/mobile), but a company or government should be
able to run the backend and talk to it from **their own apps** — or, ideally, from
**existing published apps** — not just ours. Frontend and backend are decoupled.

**The hard constraint (be honest about it):** our privacy guarantees come from
**E2E encryption + self-owned keypairs**, which means *the client holds the keys
and does the crypto* — the server is a dumb relay that only ever sees ciphertext.
You cannot have both "the server can't read anything" **and** "any dumb
third-party app works unmodified." The crypto has to live somewhere; if the server
did it, it wouldn't be E2E. So a client — whoever writes it — must implement:

1. the **transport** (Phoenix Channels over WebSocket: `phx_join` an `inbox:<pubkey>` topic, heartbeats),
2. the **auth handshake** (connect params sign `pubkey|enc|ts`; server verifies Ed25519 + membership),
3. the **seal/open crypto** (Ed25519 sign → ephemeral X25519 + XChaCha20-Poly1305, envelope `{epk,n,ct}` over `{from,ts,body}`),
4. the **message schema** (body union: `msg`/`media`/`edit`/`del`/`react`/`rcpt`/`typing`/`call-*`, carbons, `seq`/cursor catch-up),
5. **blob handling** (encrypt-then-upload, key rides inside the sealed body).

**So: are there ready-made apps that connect today? No** — nothing off-the-shelf
speaks this specific protocol. Three genuinely different ways to open it up:

### Path A — Our protocol + a real client SDK ✅ *(done)*
The client is now a **framework- and storage-agnostic SDK**, `@pochta-chat/sdk`
(TypeScript), with a published **[`PROTOCOL.md`](PROTOCOL.md)** wire spec. It holds
all the logic — self-owned identity, sign-then-seal E2E crypto, the relay
transport + every message op (text, edit/delete/react/reply, receipts, typing),
voice/video call signaling, encrypted media — and ships **no storage engine and
no UI**. A host injects a `Store` (durable history), a `KVStore` (the account
vault), the relay URLs, and `ClientEvents`. So the same core runs our web app, a
future desktop/mobile app, or a headless bot; any third party builds *their own*
app against it cheaply, E2E intact (the Twilio/Stream/Sendbird "infra + SDK"
shape). **Verified:** our web app was refactored to consume the SDK via the
`@pochta-chat/sdk` alias with zero UI changes (thin browser bindings supply
IndexedDB + localStorage + the relay URLs), and the full browser E2E suite
(messaging, receipts, at-rest encryption, media cache, reactions, edit/delete,
multi-device carbons) plus headless crypto/protocol interop still pass. *v0.1
lives in-repo under `apps/web/src/sdk`; promoting it to a standalone published
package under the reserved `@pochta-chat` npm org is mechanical (move to
`packages/sdk`, add a build step, point `exports` at the compiled dist).* Next:
Swift/Kotlin ports for native mobile. Unlocks *custom* apps, not *existing* ones.

### Path B — A Bot / Integration REST API *(for systems, not humans)*
A documented REST + WebSocket lane so a company can wire the backend to **their own
systems** (helpdesk, alerts, CRM, bots) — the Telegram/Slack "Bot API" shape. Great
for integrations. Caveat: a server-side integration that isn't running our client
crypto is **not E2E** for those messages — so this is an explicit, clearly-labeled
non-E2E (or bot-key) lane, kept separate from the private human-to-human path.

### Path C — Standards compatibility (Matrix or XMPP) *(the only way *existing* store apps work)*
If "a government installs an app **already in the App/Play Store** and points it at
our server" is a hard requirement, that specifically means speaking a **standard
protocol** those apps already implement:
- **Matrix** — self-host a homeserver, and **Element, FluffyChat, Cinny, SchildiChat,
  Nheko** connect by entering the server URL; E2E (Olm/Megolm), multi-device, and
  federation are built in. This is *the* established "run your own backend, use
  existing clients" answer.
- **XMPP** — **Conversations (Android), Monal/Siskin (iOS), Dino/Gajim (desktop)**;
  E2E via OMEMO.

Trade-off: this is large — either **adopt** one of these protocols (a different
identity + crypto + transport model than ours) or run a **bridge** that translates
to it. A bridge that sits in the middle generally has to see plaintext, which
breaks the server-can't-read guarantee unless it runs on the client edge. So Path C
buys the biggest ecosystem at the cost of either a major protocol pivot or a
privacy compromise at the bridge. Worth a dedicated evaluation before committing.

**Suggested sequencing:** ✅ A (SDK + spec) done → **B (bot/integration API) next**
→ evaluate C only if off-the-shelf-app support is a firm requirement. A and B honor
the current architecture and E2E; C is a strategic fork.

---

## Hardening backlog — "what a serious adopter asks next"

From external review of the design. None are blockers today; they're what an
org/gov security reviewer will flag once they take the deployment seriously.

1. **Admin is one shared static secret.** `ADMIN_TOKEN` has no rotation, no
   per-admin accounts, and no audit log — one leaked token = full admin control
   with no attribution. Cheapest first step: an **audit log of admin actions**
   (who/when minted a token, added/removed a member, allowed/revoked a peer).
   Then per-admin accounts + token rotation. First thing a procurement reviewer
   scans for, now that we pitch org/gov.
2. **Federation spam.** Signing proves *who* sent a push, not that it isn't abuse
   — a compromised or malicious *allowlisted* peer can still flood a recipient's
   inbox. Add a **per-peer inbound rate limit / quota** on `POST /federation/push`.
3. **Forward secrecy + per-device keys — move up.** For org/gov (device seizure,
   key extraction) these matter more than for a family user. Double-Ratchet gives
   forward secrecy; per-device keys let you **revoke a lost device without
   rotating identity**. Still "known limitation," but expect it in any serious eval.
4. **Relay discovery.** `mix relay.peers allow <origin>` assumes you already know
   the origin — there's no discovery story. Fine as **manual/out-of-band** for now
   (arguably correct for a trust-minimized private network); decide whether a
   discovery mechanism is wanted long-term or manual pairing is the answer.

## Explicitly *not* doing

- **Blockchain for messages.** Chat needs no global consensus; a chain would
  make messages public, slow, and costly. Self-ownership comes from keys.
- **Email/password accounts.** That hands identity back to a central authority —
  the exact thing we're avoiding.
