defmodule PochtaWeb.ConfigController do
  @moduledoc """
  Public runtime config for clients — the WebRTC ICE servers.

  Lets the OPERATOR decide NAT traversal: none (LAN/air-gap), a STUN server, and/or
  a TURN server — nothing is hardcoded to the outside. When a TURN shared secret is
  configured (coturn `use-auth-secret`), each client is handed **time-limited TURN
  credentials** (the coturn REST scheme), so the long-lived secret never leaves the
  relay and leaked creds expire on their own.
  """
  use PochtaWeb, :controller

  def show(conn, _params) do
    json(conn, %{ice_servers: Application.get_env(:pochta, :ice_servers, []) ++ turn()})
  end

  # coturn REST credentials: username = "<expiry-unix-ts>", credential =
  # base64(HMAC-SHA1(static-auth-secret, username)). Empty unless both
  # :turn_urls and :turn_secret are configured.
  defp turn do
    urls = Application.get_env(:pochta, :turn_urls, [])
    secret = Application.get_env(:pochta, :turn_secret)

    if urls != [] and is_binary(secret) and secret != "" do
      ttl = Application.get_env(:pochta, :turn_ttl, 86_400)
      username = Integer.to_string(System.system_time(:second) + ttl)
      credential = :crypto.mac(:hmac, :sha, secret, username) |> Base.encode64()
      [%{urls: urls, username: username, credential: credential}]
    else
      []
    end
  end
end
