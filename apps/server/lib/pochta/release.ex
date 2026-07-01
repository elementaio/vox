defmodule Pochta.Release do
  @moduledoc "Runs pending migrations (called at boot after the Repo starts)."

  @migrations [
    {1, Pochta.Migrations.Init},
    {2, Pochta.Migrations.AddBlobs},
    {3, Pochta.Migrations.AddFederationOutbox},
    {4, Pochta.Migrations.AddKnownRelays},
    {5, Pochta.Migrations.AddMembership},
    {6, Pochta.Migrations.AddAdminAudit}
  ]

  def migrate do
    Ecto.Migrator.run(Pochta.Repo, @migrations, :up, all: true)
    :ok
  end

  @doc "Start just the Repo (+ deps) for CLI tasks — no endpoint, safe alongside a running server."
  def boot_repo do
    Logger.configure(level: :warning)
    Application.put_env(:pochta, Pochta.Repo, [{:log, false} | Application.get_env(:pochta, Pochta.Repo, [])])
    Application.ensure_all_started(:ecto_sqlite3)
    Application.ensure_all_started(:postgrex)
    Application.ensure_all_started(:req)

    case Pochta.Repo.start_link() do
      {:ok, _} -> :ok
      {:error, {:already_started, _}} -> :ok
    end
  end
end

