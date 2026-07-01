defmodule SignalingWeb.AdminController do
  @moduledoc """
  JSON API behind the web admin panel (`/admin`). Every action requires
  `Authorization: Bearer <ADMIN_TOKEN>`; if no admin token is configured, the
  API is disabled. This is what lets a NON-technical admin run a private relay
  from a browser instead of the CLI.
  """
  use SignalingWeb, :controller

  plug :authorize

  def members(conn, _), do: json(conn, %{members: Signaling.Admin.list_members()})

  def add_member(conn, %{"pubkey" => pk}) do
    Signaling.Admin.add_member(pk)
    json(conn, %{ok: true})
  end

  def remove_member(conn, %{"pubkey" => pk}) do
    Signaling.Admin.remove_member(pk)
    json(conn, %{ok: true})
  end

  def tokens(conn, _), do: json(conn, %{tokens: Signaling.Admin.list_tokens()})

  def mint(conn, _), do: json(conn, %{token: Signaling.Admin.mint_token()})

  def peers(conn, _), do: json(conn, %{peers: Signaling.Admin.list_relays()})

  def allow_peer(conn, %{"origin" => origin}) do
    case Signaling.Admin.allow_relay(origin) do
      {:ok, pub} -> json(conn, %{ok: true, pubkey: pub})
      _ -> conn |> put_status(400) |> json(%{error: "could not reach that relay"})
    end
  end

  def revoke_peer(conn, %{"pubkey" => pk}) do
    Signaling.Admin.revoke_relay(pk)
    json(conn, %{ok: true})
  end

  # Bearer-token gate. `ping` (via any action) also lets the panel validate login.
  defp authorize(conn, _opts) do
    admin = Application.get_env(:signaling, :admin_token)

    if is_binary(admin) and admin != "" and get_req_header(conn, "authorization") == ["Bearer " <> admin] do
      conn
    else
      conn |> put_status(401) |> json(%{error: "unauthorized"}) |> halt()
    end
  end
end
