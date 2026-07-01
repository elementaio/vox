defmodule Pochta.Migrations.AddMembership do
  @moduledoc "Guarded membership: an allowlist of member pubkeys + one-time enroll tokens."
  use Ecto.Migration

  def change do
    create table(:members, primary_key: false) do
      add :pubkey, :string, null: false
      add :added_ts, :bigint, null: false
    end

    create unique_index(:members, [:pubkey])

    create table(:enroll_tokens, primary_key: false) do
      add :token, :string, null: false
      add :created_ts, :bigint, null: false
      add :used_ts, :bigint
      add :used_by, :string
    end

    create unique_index(:enroll_tokens, [:token])
  end
end
