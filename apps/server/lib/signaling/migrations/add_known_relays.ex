defmodule Signaling.Migrations.AddKnownRelays do
  @moduledoc "Federation trust table. `revoked_at` exists from the start (cheap to have, annoying to retrofit)."
  use Ecto.Migration

  def change do
    create table(:known_relays, primary_key: false) do
      add :relay_pubkey, :string, null: false
      add :origin, :string
      add :first_seen, :bigint, null: false
      add :revoked_at, :bigint
    end

    create unique_index(:known_relays, [:relay_pubkey])
  end
end
