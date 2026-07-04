defmodule Vox.Migrations.AddDirectory do
  @moduledoc "Opt-in searchable directory (handle → identity) for finding people."
  use Ecto.Migration

  def change do
    create table("directory", primary_key: false) do
      add :pubkey, :string, primary_key: true
      add :handle, :string, null: false
      add :name, :string
      add :enc, :string, null: false
      add :relay, :string
      add :ts, :bigint
    end

    create unique_index("directory", [:handle])
  end
end
