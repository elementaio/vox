defmodule Pochta.Migrations.Init do
  @moduledoc "Schema for the engine's durable ports. Dialect-agnostic (SQLite/Postgres)."
  use Ecto.Migration

  def change do
    # The load-bearing log. Unique (conversation_id, id) = idempotency;
    # unique (conversation_id, seq) = gap-free ordering.
    create table(:messages, primary_key: false) do
      add :conversation_id, :string, null: false
      add :id, :string, null: false
      add :sender_id, :string
      add :payload, :binary
      add :seq, :bigint, null: false
      add :server_ts, :bigint
      add :kind, :string
    end

    create unique_index(:messages, [:conversation_id, :id])
    create unique_index(:messages, [:conversation_id, :seq])

    create table(:conversation_members, primary_key: false) do
      add :conversation_id, :string, null: false
      add :user_id, :string, null: false
    end

    create unique_index(:conversation_members, [:conversation_id, :user_id])
    create index(:conversation_members, [:user_id])

    create table(:cursors, primary_key: false) do
      add :device_key, :string, null: false
      add :conversation_id, :string, null: false
      add :seq, :bigint, null: false
    end

    create unique_index(:cursors, [:device_key, :conversation_id])

    create table(:receipts, primary_key: false) do
      add :conversation_id, :string, null: false
      add :user_id, :string, null: false
      add :seq, :bigint, null: false
    end

    create unique_index(:receipts, [:conversation_id, :user_id])

    create table(:presence, primary_key: false) do
      add :user_id, :string, null: false
      add :last_seen, :bigint
    end

    create unique_index(:presence, [:user_id])
  end
end
