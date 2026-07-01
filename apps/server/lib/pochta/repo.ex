defmodule Pochta.Repo do
  @moduledoc """
  Repo for the durable engine adapters. Lives in the *body* — the engine never
  depends on a database (that's what the ports are for).

  The adapter is chosen at compile time via config: **SQLite by default**
  (embedded, single file on disk — plug-and-play for donor/self-hosted relays),
  or **Postgres** for a large clustered relay. The port adapters are
  dialect-agnostic (Ecto DSL), so switching is config-only.
  """
  use Ecto.Repo,
    otp_app: :pochta,
    adapter: Application.compile_env(:pochta, :ecto_adapter, Ecto.Adapters.SQLite3)
end
