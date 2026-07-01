defmodule Signaling.Migrations.AddBlobs do
  @moduledoc "Encrypted media blob store (content-blind, bounded by retention)."
  use Ecto.Migration

  def change do
    create table(:blobs, primary_key: false) do
      add :id, :string, null: false
      add :data, :binary, null: false
      add :inserted_ts, :bigint, null: false
    end

    create unique_index(:blobs, [:id])
    create index(:blobs, [:inserted_ts])
  end
end
