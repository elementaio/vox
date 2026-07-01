# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :signaling,
  ecto_repos: [Signaling.Repo],
  # Storage backend for the engine's durable ports. Default: SQLite on disk
  # (plug-and-play). For a large relay, set to Ecto.Adapters.Postgres (and give
  # Signaling.Repo Postgres credentials) — the adapters are unchanged.
  ecto_adapter: Ecto.Adapters.SQLite3,
  generators: [timestamp_type: :utc_datetime]

# Configure the endpoint
config :signaling, SignalingWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: SignalingWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Signaling.PubSub,
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
config :signaling, :ice_servers, [%{urls: "stun:stun.l.google.com:19302"}]

# Federation trust policy: :open (accept any signature-verified relay),
# :allowlist (only operator-approved peers), or :tofu (trust on first use).
# A family/company relay should use :allowlist; a public one :open.
config :signaling, :federation_policy, :open

# Federation reachability: :open (federate) or :closed (a sealed island — no
# messages in or out; for a fully-private org/gov network).
config :signaling, :federation_mode, :open

# Membership: :open (anyone with a valid keypair) or :invite (only pubkeys
# enrolled via an admin-issued token — a guarded/private network).
config :signaling, :membership_mode, :open

# chat_engine ports → durable Ecto adapters (work on SQLite or Postgres). The
# engine code is UNCHANGED; only the body's config points at the adapters —
# that's the whole point of the ports design. Auth stays the trivial allow-all.
config :chat_engine,
  persistence_adapter: Signaling.Ports.Db.Persistence,
  conversation_store_adapter: Signaling.Ports.Db.ConversationStore,
  cursor_store_adapter: Signaling.Ports.Db.CursorStore,
  presence_store_adapter: Signaling.Ports.Db.PresenceStore,
  receipt_store_adapter: Signaling.Ports.Db.ReceiptStore,
  auth_adapter: Chat.Adapters.InMemory.Auth

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
