# Pochta mobile (Expo / React Native)

The Pochta messenger on **iOS and Android**, built on the published
[`@pochta-chat/sdk`](https://www.npmjs.com/package/@pochta-chat/sdk) — the same
core the web and desktop apps use. Fork it to ship your own branded app.

## Status

- ✅ **Onboarding works on-device** — create/restore a self-owned identity and store
  it in an **encrypted vault**. This is the piece that proves the SDK's crypto runs
  natively (the SDK is pure-JS since v0.1.1 — no WebCrypto).
- ⏭️ **Next:** the messenger itself (contacts, chat, receipts) — it reuses the same
  SDK `Client` as the web app with the native `store` adapter; then **calls** via
  `react-native-webrtc` (needs a dev build, not Expo Go).

## How it's wired

| SDK port | Native adapter | Why |
|---|---|---|
| `KVStore` (identity vault + device id) | **MMKV** ([`src/adapters.ts`](src/adapters.ts)) | the SDK vault is synchronous; MMKV is a fast, synchronous, encrypted store |
| `Store` (message/contact history) | MMKV JSON (first cut) | swap in `expo-sqlite` for large histories |
| `crypto.getRandomValues` | `react-native-get-random-values` (in [`index.js`](index.js)) | the SDK's only host requirement |

`TextEncoder`/`TextDecoder` are built into Hermes on Expo SDK 52 / RN 0.76. Calls
will need `react-native-webrtc` + camera/mic permissions (already declared in
`app.json`).

## Run it

```sh
cd apps/mobile
npm install
npx expo run:ios       # or: npx expo run:android   (a dev build — MMKV/WebRTC are native)
```

> This app consumes `@pochta-chat/sdk` from **npm** (not the workspace), so it's a
> clean, forkable starting point for your own app. Point it at your Pochta relay in
> the messenger screen (coming next).

## Security note

The MMKV `encryptionKey` here is a constant for the scaffold. Before shipping,
derive it from the OS keychain (`expo-secure-store` / iOS Keychain / Android
Keystore) so the on-device store is protected by the platform's hardware-backed key.
