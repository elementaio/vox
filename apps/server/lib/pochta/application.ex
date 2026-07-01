defmodule Pochta.Application do
  # See https://elixir.hexdocs.pm/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      PochtaWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:pochta, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Pochta.PubSub},
      # Durable store for the engine's ports (SQLite on disk by default), then
      # run pending migrations before serving.
      Pochta.Repo,
      %{
        id: :migrate,
        start: {Task, :start_link, [&Pochta.Release.migrate/0]},
        restart: :transient
      },
      # Periodically drop expired messages (bounded delivery buffer).
      Pochta.Retention,
      # Relay's own signing keypair (federation identity).
      Pochta.RelayIdentity,
      # Retries relay-to-relay forwards until the peer relay is reachable.
      Pochta.Federation,
      # Start to serve requests, typically the last entry
      PochtaWeb.Endpoint
    ]

    # See https://elixir.hexdocs.pm/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Pochta.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    PochtaWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
