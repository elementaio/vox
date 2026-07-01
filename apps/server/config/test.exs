import Config

# SQLite file for the contract test-kit (separate DB from dev).
config :signaling, Signaling.Repo,
  database: Path.expand("../signaling_test.db", __DIR__),
  journal_mode: :wal,
  pool_size: 5

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :signaling, SignalingWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "VCnX1nihLmnDMhd8NaMXfXtIL6NwaP6w8FjmSB4Ar/wVUY55gSgBXPu5Yx4k2Zq9",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
