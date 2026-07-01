defmodule Signaling.Release do
  @moduledoc "Runs pending migrations (called at boot after the Repo starts)."

  @migrations [
    {1, Signaling.Migrations.Init},
    {2, Signaling.Migrations.AddBlobs},
    {3, Signaling.Migrations.AddFederationOutbox},
    {4, Signaling.Migrations.AddKnownRelays},
    {5, Signaling.Migrations.AddMembership}
  ]

  def migrate do
    Ecto.Migrator.run(Signaling.Repo, @migrations, :up, all: true)
    :ok
  end

  @doc "Start just the Repo (+ deps) for CLI tasks — no endpoint, safe alongside a running server."
  def boot_repo do
    Logger.configure(level: :warning)
    Application.put_env(:signaling, Signaling.Repo, [{:log, false} | Application.get_env(:signaling, Signaling.Repo, [])])
    Application.ensure_all_started(:ecto_sqlite3)
    Application.ensure_all_started(:postgrex)
    Application.ensure_all_started(:req)

    case Signaling.Repo.start_link() do
      {:ok, _} -> :ok
      {:error, {:already_started, _}} -> :ok
    end
  end
end

