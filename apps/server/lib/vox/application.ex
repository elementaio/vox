defmodule Vox.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      VoxWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:vox, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Vox.PubSub},
      # Tracks meeting-room rosters (who's in a room) for the join-by-link flow.
      VoxWeb.Presence,
      # Durable store for the engine's ports (SQLite on disk by default), then
      # run pending migrations before serving.
      Vox.Repo,
      # Run pending migrations SYNCHRONOUSLY here (returns :ignore, so it isn't
      # supervised — but the supervisor blocks on its start), so nothing after it
      # (Endpoint, federation, retention) serves against a half-migrated schema.
      %{id: :migrate, start: {Vox.Release, :migrate_sync, []}, restart: :temporary},
      # Periodically drop expired messages (bounded delivery buffer).
      Vox.Retention,
      # Relay's own signing keypair (federation identity).
      Vox.RelayIdentity,
      # Retries relay-to-relay forwards until the peer relay is reachable.
      Vox.Federation,
      # Generic per-minute rate limiter (client channel + inbound federation).
      Vox.RateLimiter,
      # Start to serve requests, typically the last entry
      VoxWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Vox.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    VoxWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
