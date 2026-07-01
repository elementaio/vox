defmodule Signaling.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      SignalingWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:signaling, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Signaling.PubSub},
      # Durable store for the engine's ports (SQLite on disk by default), then
      # run pending migrations before serving.
      Signaling.Repo,
      %{
        id: :migrate,
        start: {Task, :start_link, [&Signaling.Release.migrate/0]},
        restart: :transient
      },
      # Periodically drop expired messages (bounded delivery buffer).
      Signaling.Retention,
      # Relay's own signing keypair (federation identity).
      Signaling.RelayIdentity,
      # Retries relay-to-relay forwards until the peer relay is reachable.
      Signaling.Federation,
      # Start to serve requests, typically the last entry
      SignalingWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Signaling.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    SignalingWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
