defmodule Signaling.Migrations.AddFederationOutbox do
  @moduledoc "Durable retry queue for relay-to-relay forwards (survives remote downtime)."
  use Ecto.Migration

  def change do
    create table(:federation_outbox, primary_key: false) do
      add :id, :string, null: false
      add :relay, :string, null: false
      add :payload, :binary, null: false
      add :attempts, :integer, null: false, default: 0
      add :next_attempt_ts, :bigint, null: false
      add :inserted_ts, :bigint, null: false
    end

    create unique_index(:federation_outbox, [:id])
    create index(:federation_outbox, [:next_attempt_ts])
  end
end
