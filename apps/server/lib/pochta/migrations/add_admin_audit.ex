defmodule Pochta.Migrations.AddAdminAudit do
  @moduledoc "Audit trail of admin actions (who/when/what) for attribution."
  use Ecto.Migration

  def change do
    create table(:admin_audit) do
      add :action, :string, null: false
      add :detail, :string
      # A short fingerprint of the admin token used (attribution without storing
      # the secret), plus the client IP — as much "who" as a shared token allows.
      add :actor, :string
      add :ip, :string
      add :ts, :bigint, null: false
    end

    create index(:admin_audit, [:ts])
  end
end
