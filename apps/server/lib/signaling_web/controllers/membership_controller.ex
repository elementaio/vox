defmodule SignalingWeb.MembershipController do
  @moduledoc """
  Joining a guarded (private) relay.

    * `POST /enroll` — a prospective member redeems a one-time token for their
      pubkey. They sign `enroll|token|ts` with their identity key, so a token can
      only enroll someone who actually holds that keypair.
    * `POST /admin/enroll_token` — an operator (Bearer ADMIN_TOKEN) mints a token
      to hand out. This is the "specific way to enter the network".
  """
  use SignalingWeb, :controller

  @ts_window_ms 5 * 60 * 1000

  def enroll(conn, %{"pubkey" => pub, "token" => token, "ts" => ts, "sig" => sig}) do
    with {:ok, pubkey} <- Base.decode16(pub, case: :mixed),
         {:ok, sigb} <- Base.decode16(sig, case: :mixed),
         {ts_int, ""} <- Integer.parse(ts),
         true <- abs(System.system_time(:millisecond) - ts_int) <= @ts_window_ms,
         true <- verify(pubkey, "enroll|#{token}|#{ts}", sigb),
         :ok <- Signaling.Membership.redeem(token, pub) do
      json(conn, %{ok: true})
    else
      _ -> conn |> put_status(403) |> json(%{error: "invalid or used token"})
    end
  end

  def enroll(conn, _), do: conn |> put_status(400) |> json(%{error: "bad request"})

  def create_token(conn, _params) do
    admin = Application.get_env(:signaling, :admin_token)

    if is_binary(admin) and admin != "" and
         get_req_header(conn, "authorization") == ["Bearer " <> admin] do
      json(conn, %{token: Signaling.Membership.create_token()})
    else
      conn |> put_status(401) |> json(%{error: "unauthorized"})
    end
  end

  defp verify(pub, msg, sig) do
    :crypto.verify(:eddsa, :none, msg, sig, [pub, :ed25519])
  rescue
    _ -> false
  end
end
