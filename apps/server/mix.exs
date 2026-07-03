defmodule Pochta.MixProject do
  use Mix.Project

  def project do
    [
      app: :pochta,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      listeners: [Phoenix.CodeReloader]
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Pochta.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.8"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"},
      # Durable messaging core: ordering, seq, cursors, offline catch-up, presence.
      # The messaging core, pinned by tag from the org repo (public — Docker
      # builds fetch it with no tokens). Bump the tag to take engine updates.
      {:chat_engine, git: "https://github.com/elementaio/engine.git", tag: "v0.2.0"},
      # Durable engine-port adapters live in the body. Dialect-agnostic (Ecto),
      # so the SAME adapters run on SQLite (default, plug-and-play, on disk) or
      # Postgres (scale) — selected by config.
      {:ecto_sql, "~> 3.12"},
      {:ecto_sqlite3, "~> 0.17"},
      {:postgrex, ">= 0.0.0"},
      # CORS for the media blob endpoints (web client is a different origin in dev).
      {:cors_plug, "~> 3.0"},
      # HTTP client for relay-to-relay federation forwarding.
      {:req, "~> 0.5"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get"],
      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"]
    ]
  end
end
