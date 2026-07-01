defmodule PochtaWeb.AdminController do
  @moduledoc """
  JSON API behind the web admin panel (`/admin`). Every action requires
  `Authorization: Bearer <ADMIN_TOKEN>`; if no admin token is configured, the
  API is disabled. This is what lets a NON-technical admin run a private relay
  from a browser instead of the CLI.

  Every mutating action is recorded to an append-only audit trail (`Pochta.Audit`)
  with the token fingerprint + client IP, so there's attribution for who minted a
  token, added/removed a member, or allowed/revoked a peer.
  """
  use PochtaWeb, :controller

  plug :authorize

  def members(conn, _), do: json(conn, %{members: Pochta.Admin.list_members()})

  def add_member(conn, %{"pubkey" => pk}) do
    Pochta.Admin.add_member(pk)
    audit(conn, "add_member", pk)
    json(conn, %{ok: true})
  end

  def remove_member(conn, %{"pubkey" => pk}) do
    Pochta.Admin.remove_member(pk)
    audit(conn, "remove_member", pk)
    json(conn, %{ok: true})
  end

  def tokens(conn, _), do: json(conn, %{tokens: Pochta.Admin.list_tokens()})

  def mint(conn, _) do
    token = Pochta.Admin.mint_token()
    # Log an identifiable prefix, not the whole single-use secret.
    audit(conn, "mint_token", String.slice(token, 0, 8) <> "…")
    json(conn, %{token: token})
  end

  def peers(conn, _), do: json(conn, %{peers: Pochta.Admin.list_relays()})

  def allow_peer(conn, %{"origin" => origin}) do
    case Pochta.Admin.allow_relay(origin) do
      {:ok, pub} ->
        audit(conn, "allow_peer", origin)
        json(conn, %{ok: true, pubkey: pub})

      _ ->
        conn |> put_status(400) |> json(%{error: "could not reach that relay"})
    end
  end

  def revoke_peer(conn, %{"pubkey" => pk}) do
    Pochta.Admin.revoke_relay(pk)
    audit(conn, "revoke_peer", pk)
    json(conn, %{ok: true})
  end

  # Recent admin actions (for the panel's activity log).
  def audit_log(conn, _), do: json(conn, %{audit: Pochta.Audit.list()})

  # --- audit + auth helpers ---------------------------------------------------

  defp audit(conn, action, detail) do
    Pochta.Audit.log(action, detail, actor(conn), client_ip(conn))
    conn
  end

  # A short, non-reversible fingerprint of the presented token (attribution
  # without storing the secret). Constant while one shared token is in use;
  # meaningful once per-admin tokens land.
  defp actor(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> tok] ->
        :crypto.hash(:sha256, tok) |> Base.encode16(case: :lower) |> binary_part(0, 10)

      _ ->
        "unknown"
    end
  end

  defp client_ip(conn) do
    case get_req_header(conn, "x-forwarded-for") do
      [xff | _] -> xff |> String.split(",") |> hd() |> String.trim()
      _ -> conn.remote_ip |> :inet.ntoa() |> to_string()
    end
  end

  # Bearer-token gate. `ping` (via any action) also lets the panel validate login.
  defp authorize(conn, _opts) do
    admin = Application.get_env(:pochta, :admin_token)

    if is_binary(admin) and admin != "" and get_req_header(conn, "authorization") == ["Bearer " <> admin] do
      conn
    else
      conn |> put_status(401) |> json(%{error: "unauthorized"}) |> halt()
    end
  end
end
