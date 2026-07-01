defmodule Pochta.Audit do
  @moduledoc """
  Append-only audit trail of admin actions (mint/add/remove/allow/revoke).

  With a single shared `ADMIN_TOKEN` there are no per-admin identities, so "who"
  is as much as that allows: a short fingerprint of the token used plus the client
  IP. This gives attribution ("which token, from where, when, did what") — the
  cheapest meaningful hardening over "no log at all", and the foundation for
  per-admin accounts later.
  """
  import Ecto.Query
  alias Pochta.Repo

  @doc "Record an admin action. `detail` is the affected pubkey/origin/token (or nil)."
  def log(action, detail, actor, ip) do
    Repo.insert_all("admin_audit", [
      %{
        action: to_string(action),
        detail: detail && to_string(detail),
        actor: actor,
        ip: ip,
        ts: System.system_time(:millisecond)
      }
    ])

    :ok
  end

  @doc "Most-recent audit entries, newest first."
  def list(limit \\ 100) do
    Repo.all(
      from a in "admin_audit",
        order_by: [desc: a.id],
        limit: ^limit,
        select: %{action: a.action, detail: a.detail, actor: a.actor, ip: a.ip, ts: a.ts}
    )
  end
end
