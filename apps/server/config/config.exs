# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :vox,
  ecto_repos: [Vox.Repo],
  # Storage backend for the engine's durable ports. Default: SQLite on disk
  # (plug-and-play). For a large relay, set to Ecto.Adapters.Postgres (and give
  # Vox.Repo Postgres credentials) — the adapters are unchanged.
  ecto_adapter: Ecto.Adapters.SQLite3,
  generators: [timestamp_type: :utc_datetime]

# Configure the endpoint
config :vox, VoxWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: VoxWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Vox.PubSub,
  live_view: [signing_salt: "5rFkNYbs"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# WebRTC ICE servers handed to clients (so nothing is hardcoded to the outside).
# For an air-gapped / LAN deployment set this to [] — peers connect via local
# host candidates, no external server. For cross-network calls, self-host coturn
# and list it here, e.g.:
#   [%{urls: "stun:stun.mycompany.internal:3478"},
#    %{urls: "turn:turn.mycompany.internal:3478", username: "u", credential: "p"}]
config :vox, :ice_servers, [%{urls: "stun:stun.l.google.com:19302"}]

# Optional self-hosted TURN (coturn) for calls across strict/cellular NATs. When
# :turn_urls + :turn_secret are set, GET /config hands each client time-limited
# TURN credentials (coturn `use-auth-secret`); :turn_secret must equal coturn's
# `static-auth-secret`. STUN can stay public/free; TURN you host (bandwidth) or buy.
config :vox, :turn_urls, []
config :vox, :turn_secret, nil
config :vox, :turn_ttl, 86_400

# Federation trust policy: :open (accept any signature-verified relay),
# :allowlist (only operator-approved peers), or :tofu (trust on first use).
# A family/company relay should use :allowlist; a public one :open.
config :vox, :federation_policy, :open

# Federation reachability: :open (federate) or :closed (a sealed island — no
# messages in or out; for a fully-private org/gov network).
config :vox, :federation_mode, :open

# Max inbound federation pushes accepted per authenticated peer relay, per minute
# (anti-flood; a signed-but-compromised peer can't drown an inbox). Excess → 429.
config :vox, :federation_rate_limit, 120

# Per-source-IP inbound federation cap, applied BEFORE any signature check or the
# origin reverse-fetch — so key rotation can't bypass it and it shields the fetch.
config :vox, :federation_ip_rate_limit, 240

# SSRF guard: only reverse-fetch federation origins on PUBLIC hosts. Set true to
# permit private/loopback origins for LOCAL federation testing (dev/test do).
config :vox, :federation_allow_private_origins, false

# Client-channel per-socket per-minute caps (flood protection). `send` defaults
# high because call signaling bursts ICE candidates; `presence` is a cheaper cap
# and `presence_max` bounds a single query's fan-out.
config :vox, :channel_send_rate, 1200
config :vox, :channel_presence_rate, 240
config :vox, :presence_max, 256

# The (unauthenticated) blob endpoints are capped per source IP per minute so an
# anonymous client can't fill the disk (bypassing the private-relay gate).
config :vox, :blob_upload_rate, 60
config :vox, :blob_download_rate, 600

# Enroll tokens expire after this many ms (default 7 days) — a leaked-but-unused
# token doesn't stay valid forever.
config :vox, :enroll_token_ttl_ms, 604_800_000

# Membership: :open (anyone with a valid keypair) or :invite (only pubkeys
# enrolled via an admin-issued token — a guarded/private network).
config :vox, :membership_mode, :open

# Meeting rooms ("join by link"): allow non-member GUESTS to join a room (true),
# or restrict rooms to members too (false) for a fully-closed org. Messaging is
# always members-only regardless. Per-socket room-signal flood cap (per minute).
config :vox, :allow_guest_rooms, true
config :vox, :room_signal_rate, 1200

# chat_engine ports → durable Ecto adapters (work on SQLite or Postgres). The
# engine code is UNCHANGED; only the body's config points at the adapters —
# that's the whole point of the ports design. Auth stays the trivial allow-all.
config :chat_engine,
  persistence_adapter: Vox.Ports.Db.Persistence,
  conversation_store_adapter: Vox.Ports.Db.ConversationStore,
  cursor_store_adapter: Vox.Ports.Db.CursorStore,
  presence_store_adapter: Vox.Ports.Db.PresenceStore,
  receipt_store_adapter: Vox.Ports.Db.ReceiptStore,
  auth_adapter: Chat.Adapters.InMemory.Auth

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
