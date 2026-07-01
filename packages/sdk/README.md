# @pochta-chat/sdk

The framework-agnostic client SDK for **Pochta** — a self-hosted, end-to-end-
encrypted messenger where the relay is a *post office, not an archive*.

This package is everything a client needs to speak the [Pochta protocol](../../PROTOCOL.md):
self-owned identity, sign-then-seal E2E crypto, the relay transport + all message
operations (text, edit/delete/react/reply, receipts, typing), voice/video call
signaling, and encrypted media. It ships **no storage engine and no UI** — you
inject those — so the same core runs a web app, a desktop/mobile app, or a
headless bot.

> **v0.1 status:** a workspace package (`packages/sdk`) consumed by the web app via
> the `@pochta-chat/sdk` alias to its TypeScript source. Publishing to npm under the
> reserved `@pochta-chat` org just needs a build step — see `package.json`.

## What you inject

| Port           | What it is                                              | Browser example |
|----------------|---------------------------------------------------------|-----------------|
| `Store`        | durable message/contact/media history (the source of truth lives on the device) | IndexedDB |
| `KVStore`      | small key-value for the encrypted account vault + device id | `localStorage` |
| relay URLs     | `socketUrl` (ws) + `httpBase` (http)                    | derived from the page origin |
| `ClientEvents` | UI callbacks (`onMessage`, `onPresence`, `onCallState`, …) | React state setters |

The SDK never imports a database, a UI framework, or a hardcoded server address.

## Quick start

```ts
import {
  createIdentity, Vault, Client,
  type Identity, type Store, type ClientEvents,
} from "@pochta-chat/sdk";

// 1. Identity (self-owned keypair; 12-word backup). Persist it under a passphrase.
const id: Identity = createIdentity();
const vault = new Vault(localStorage);      // any KVStore
await vault.persist(id, "correct horse battery staple");

// 2. Supply a Store (durable history). Implement over IndexedDB / SQLite / memory.
const store: Store = myStore;

// 3. Connect. Events drive your UI.
const events: ClientEvents = { onMessage: render, /* …the rest… */ } as ClientEvents;
const client = new Client({
  socketUrl: "wss://relay.example.com/socket",
  httpBase:  "https://relay.example.com",
  identity: id,
  store,
  events,
  deviceId: vault.deviceId(),
});
client.connect(await loadContacts());
await client.sendText(recipientPubkeyHex, "Hello over Pochta 👋");
```

## Surface

- **Identity** — `createIdentity`, `restoreIdentity`, `sign`, `authParams`, `Vault`.
- **Crypto** — `seal`, `open`, `deriveEncryptionKey` (+ `SealedEnvelope`, `OpenedMessage`).
- **Client** — `Client` (text, media, edit/delete/react, receipts, typing, presence,
  voice/video calls) + `ClientConfig`, `ClientEvents`.
- **Media** — `encryptAndUpload`, `downloadAndDecrypt`.
- **Discovery / onboarding** — `inviteToken`, `parseInvite`, `enroll`.
- **Protocol** — `PROTOCOL_VERSION`, `inboxTopic`, `EVENTS`, `SOCKET_PATH`.
- **Model & ports** — `Store`, `KVStore`, `StoredMessage`, `StoredContact`,
  `MediaRef`, `Body`, `PresenceInfo`, `CallState`.

## Dependencies

Audited primitives only: `@noble/curves` (Ed25519 + X25519), `@noble/ciphers`
(XChaCha20-Poly1305), `@noble/hashes`, `@scure/bip39`. Transport uses `phoenix`
(peer dependency). Calls use the platform's WebRTC (`RTCPeerConnection`) when
present — absent in Node, so a headless bot simply doesn't place calls; messaging
works everywhere.
