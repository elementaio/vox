<div align="center">

# Pochta

### Your mail, not their archive.

**A private messenger you actually own.** End-to-end encrypted chat, voice & video —
with no phone number, no email, no account on someone else's server. Run it for your
family, your company, or your whole organization, on your own machine.

[![npm](https://img.shields.io/npm/v/@pochta-chat/sdk?logo=npm&label=%40pochta-chat%2Fsdk&color=cb3837)](https://www.npmjs.com/package/@pochta-chat/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Elixir](https://img.shields.io/badge/relay-Elixir%20%2F%20Phoenix-4B275F?logo=elixir&logoColor=white)
![TypeScript](https://img.shields.io/badge/client-React%20%2F%20TypeScript-3178C6?logo=typescript&logoColor=white)
![End-to-end encrypted](https://img.shields.io/badge/encryption-end--to--end-2ea44f)

</div>

---

Pochta (почта — Russian for *post office*) is built on one idea: **a messenger's
server should be a post office, not an archive.** It carries your sealed messages,
delivers them, and forgets them. It never reads them, never keeps a history, and
never knows who you are — because your account isn't a row in its database. It's a
key on your device.

## Why Pochta?

Every mainstream messenger asks you to trust a company: with your phone number, your
contacts, your metadata, and a copy of your messages on their servers. Pochta removes
the company from the middle.

- **Truly end-to-end.** Every message is signed by you and sealed to the recipient.
  The server only ever sees ciphertext — it *cannot* read your chats, even if compelled.
- **You own your identity.** Your account is a cryptographic key created on your
  device, backed up by 12 words like a crypto wallet. No email, no password, no phone
  number — nothing to leak or be locked out of.
- **Anyone can host it.** The whole server is one small program you run on a spare PC,
  a Mac, a company box, or a NAS. Your family or company runs *their own* Pochta, off
  the global network entirely.
- **No archive, by design.** Your history lives on *your* devices. The server keeps
  sealed messages only until they're delivered, then deletes them.
- **No blockchain, no tokens, no tracking.** Just proven public-key cryptography and a
  plain, honest post-office model.

## What you can do

- **Chat** with sent · delivered · read receipts, typing indicators, replies, emoji
  reactions, and edit / delete-for-everyone.
- **Call** over voice and video, peer-to-peer.
- **Share** photos, voice notes, and files — encrypted on your device before they ever
  leave it.
- **Use every device** — link a phone or laptop with your 12 words; conversations sync
  across all of them.
- **See presence** — who's online, who was last seen.

## Who it's for

- **Families and communities** who want a private group of their own, hosted on a home
  computer.
- **Companies** who want internal chat that never leaves their infrastructure — flip
  two switches for a sealed, invite-only network with no messages in or out.
- **Organizations and governments** who need a self-contained, auditable system they
  can run air-gapped on a private network. (We're [honest](#honest-about-security) about
  exactly what that does and doesn't guarantee.)

## How it works

1. **Make an account in seconds** — the app generates your key and shows you 12 backup
   words. No sign-up form.
2. **Share an invite link or QR** — whoever opens it can message you. Discovery rides in
   the invite; there's no central directory.
3. **Point at a server you trust** — the one your family or company runs. Visiting its
   URL just works; messages relay through it, sealed, and land on your devices.

## Run your own in one command

The easiest way to host Pochta is Docker. One image bundles the app, the relay, and its
storage — no Elixir, Node, or database to install.

```sh
docker build -t pochta-relay .
docker run -p 4000:4000 -v pochta-data:/data \
  -e SECRET_KEY_BASE=$(openssl rand -base64 48) \
  pochta-relay
# open http://localhost:4000 and you're running your own messenger.
```

Want a **private, invite-only network** for a company or org? Same image, three env
vars — a sealed island where only enrolled people connect and nothing leaks out:

```sh
docker run -p 4000:4000 -v pochta-data:/data \
  -e SECRET_KEY_BASE=$(openssl rand -base64 48) \
  -e MEMBERSHIP_MODE=invite -e FEDERATION_MODE=closed \
  -e ADMIN_TOKEN=$(openssl rand -hex 16) \
  pochta-relay
# open http://your-host/admin, sign in, and invite people from a friendly web panel.
```

Runs on **Windows, macOS, or Linux**. Put a TLS proxy (Caddy/nginx) in front for
anything beyond localhost. Relays can also **federate** — different self-hosted Pochta
servers reach each other, signed and origin-verified, so separate islands become a
network without any central authority.

## <a id="honest-about-security"></a>Honest about security

Trust comes from being straight about the limits, so here they are:

- **Content is end-to-end encrypted** (Ed25519 + X25519 + XChaCha20-Poly1305, via
  audited libraries). The relay holds only ciphertext.
- **Self-contained and auditable** — open source, no required external calls, you own
  every component.
- **The server operator sees metadata** — who talks to whom, when, and message sizes.
  When *you* are the operator (your family/company/org box), that's your own server, but
  it is not anonymity *from* the operator.
- **"100% secure" is not a real claim.** A stolen device or lost passphrase is out of
  our hands, and formal certification (FIPS, Common Criteria) is a process beyond the
  code. The architecture *supports* a hardened deployment; the paperwork is separate work.

## For developers

Pochta's client is a real, reusable SDK — **[`@pochta-chat/sdk`](https://www.npmjs.com/package/@pochta-chat/sdk)** —
so you can build your *own* app (mobile, desktop, a bot) on the same E2E core, or run
your backend behind a different frontend entirely. It ships no UI and no database; you
inject those.

```sh
npm i @pochta-chat/sdk
```

- **SDK** — identity, sign-then-seal crypto, transport, all message ops → [`packages/sdk`](packages/sdk)
- **Protocol** — the full wire contract, to build any client → [PROTOCOL.md](PROTOCOL.md)
- **Architecture** — how the relay, engine, and storage fit → [ARCHITECTURE.md](ARCHITECTURE.md)

### Develop locally

```sh
pnpm install
pnpm setup:server     # first time: fetch Elixir deps
pnpm dev:server       # relay on :4000 (SQLite, no external DB)
pnpm dev:web          # web on :5180 (Vite → :4000)
```

Open two browsers, create an account in each, share the invite link, and chat.

## Status

**Working today, all automated-tested:** self-owned identity · E2E messaging · contacts
and on-device encrypted history · reliable offline delivery and multi-device sync ·
receipts and typing · presence · edit / delete / reactions / replies · images, voice
notes and files · 1:1 voice/video calls · one-command self-hosting · signed
relay-to-relay federation · private/guarded (org/gov) modes · a friendly admin web panel.

**Planned:** double-click desktop installers · native mobile apps and push · per-device
keys and forward secrecy · group chat · TURN for tricky networks · human-friendly
`@handles`.

---

## <a id="self-hosting"></a>Deployment reference

<details>
<summary><b>Without Docker (mix release)</b></summary>

`pnpm build` bundles the client into the relay; run `mix phx.server` (dev) or a
self-contained `mix release` (prod — no Elixir/Node needed to run it).

```sh
cd apps/server && MIX_ENV=prod mix release
SECRET_KEY_BASE=$(mix phx.gen.secret) PHX_SERVER=true PORT=4000 \
  PHX_HOST=chat.example.com DATABASE_PATH=/data/chat.db \
  _build/prod/rel/pochta/bin/pochta start
# put a TLS reverse proxy (Caddy/nginx) in front — WebRTC/media need HTTPS off-localhost
```

Storage is SQLite by default (plug-and-play); set `ecto_adapter` to Postgres for a
large relay — same code, no changes.
</details>

<details>
<summary><b>Air-gapped / private network (nothing leaves)</b></summary>

- **No CDN / web-fonts / external assets** — the client bundles everything.
- **ICE servers are relay-provided** (`GET /config`). Set `ice_servers: []` for a LAN
  (peers connect via local candidates — verified: calls connect with zero STUN), or
  self-host **coturn**.
- **Storage is a local SQLite file**; **TLS** via a private/internal CA.
- The only unavoidable external dependency is optional **mobile push** (APNs/FCM) — skip
  it for air-gap, or use self-hostable **UnifiedPush** on Android.
</details>

<details>
<summary><b>Operating a relay (admin)</b></summary>

**Web panel (for non-technical admins).** Set an `ADMIN_TOKEN` and open
`https://your-relay/admin` — a point-and-click UI to mint join tokens, add/remove
members, and allow/revoke federated peers. Disabled entirely when no token is set.

**CLI (for operators on the box).**

```sh
mix relay.token                     # mint a one-time join token
mix relay.members [add|remove <pubkey>]
mix relay.peers   [allow <origin>|revoke <pubkey>]
# release equivalents: bin/pochta rpc "Pochta.Admin.mint_token()"
```
</details>

## License

MIT © Emad Jumaah
