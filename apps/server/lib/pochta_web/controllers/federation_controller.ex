defmodule PochtaWeb.FederationController do
  @moduledoc """
  Relay-to-relay ingress. A push is accepted only if:

    * federation is enabled (a `:closed` relay rejects everything — sealed island),
    * the `X-Relay-Sig` verifies against the claimed `X-Relay-Pubkey` (no forgery),
    * `X-Relay-Ts` is fresh (replay protection),
    * the trust `Policy` accepts that relay (open/allowlist/tofu; origin-bound; revocable).

  We never read the envelope (E2E sealed); the recipient verifies the real sender
  from the sealed content. This is a trust layer AROUND the opaque pipe.
  """
  use PochtaWeb, :controller
  alias Pochta.Federation.Policy

  @ts_window_s 300

  # GET /federation/identity — this relay's public fingerprint.
  def identity(conn, _params) do
    if Pochta.Federation.closed?() do
      forbidden(conn)
    else
      json(conn, %{relay_pubkey: Pochta.RelayIdentity.pubkey_hex()})
    end
  end

  # POST /federation/push
  def push(conn, %{"to" => to, "envelope" => envelope} = params) do
    cond do
      Pochta.Federation.closed?() ->
        forbidden(conn)

      accept?(conn, to, params) ->
        Pochta.Delivery.deliver(to, params["from"] || "", envelope, params["id"], params["ephemeral"] || false)
        json(conn, %{ok: true})

      true ->
        conn |> put_status(401) |> json(%{error: "unauthorized relay"})
    end
  end

  def push(conn, _), do: conn |> put_status(400) |> json(%{error: "bad push"})

  defp accept?(conn, to, params) do
    pub = header(conn, "x-relay-pubkey")
    ts = header(conn, "x-relay-ts")
    sig = header(conn, "x-relay-sig")
    origin = header(conn, "x-relay-origin")
    mid = params["id"]

    is_binary(pub) and is_binary(ts) and is_binary(sig) and fresh?(ts) and
      Pochta.RelayIdentity.verify(pub, "#{pub}|#{ts}|#{to}|#{mid}", sig) and
      Policy.check(pub, origin) == :ok
  end

  defp forbidden(conn), do: conn |> put_status(403) |> json(%{error: "federation disabled"})

  defp header(conn, name) do
    case get_req_header(conn, name) do
      [v | _] -> v
      _ -> nil
    end
  end

  defp fresh?(ts) do
    case Integer.parse(ts) do
      {t, _} -> abs(System.system_time(:second) - t) <= @ts_window_s
      _ -> false
    end
  end
end
