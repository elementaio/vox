# Pochta mobile (Expo / React Native)

The Pochta messenger on **iOS and Android**, built on the published
[`@pochta-chat/sdk`](https://www.npmjs.com/package/@pochta-chat/sdk) — the same
core the web and desktop apps use. Fork it to ship your own branded app.

## Status

- ✅ **Onboarding + messenger scaffolded and type-clean** — create/restore a
  self-owned identity into an **encrypted vault**, connect to a relay, add contacts
  by invite, and chat. Reuses the same SDK `Client` as the web app. `tsc` passes
  against RN/Expo/SDK types (run it on a device/simulator to see it live).
- ✅ **Dual language (English + Arabic, RTL)** — every string lives in `src/i18n.tsx`.
- ⏭️ **Next:** voice/video via `react-native-webrtc` (needs a dev build), media,
  push, and keychain-derived MMKV encryption.

## Structure (atomic / modular)

Small, single-purpose files — no monolith screens:

```
App.tsx              thin root: LanguageProvider + identity gate
src/
  theme.ts           design tokens (colors, spacing)
  i18n.tsx           en/ar dictionaries + RTL (the only place strings live)
  ui.tsx             atoms: Screen, Button, Input, Title, Link, …
  components/        MessageBubble · Composer · ContactRow · TopBar
  hooks/useMessenger.ts   all SDK Client wiring + state (no UI)
  screens/           Welcome · Unlock · RelaySetup · Contacts · Chat · Messenger
  adapters.ts        MMKV-backed KVStore + Store for the SDK
```

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
