defmodule PochtaWeb.ConfigController do
  @moduledoc """
  Public runtime config for clients — currently just the WebRTC ICE servers.
  This is what lets the RELAY OPERATOR decide NAT-traversal (self-hosted STUN/
  TURN, or none for a LAN) instead of anything being hardcoded to the outside.
  """
  use PochtaWeb, :controller

  def show(conn, _params) do
    json(conn, %{ice_servers: Application.get_env(:pochta, :ice_servers, [])})
  end
end
