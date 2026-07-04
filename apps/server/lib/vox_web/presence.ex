defmodule VoxWeb.Presence do
  @moduledoc """
  Tracks who is currently in a meeting room (the room roster). Backed by
  Phoenix.Presence — automatically handles joins, leaves, and disconnects, and
  hands a new joiner the current roster. Only public join info is tracked
  (pubkey, encryption key, display name); media never touches the relay.
  """
  use Phoenix.Presence,
    otp_app: :vox,
    pubsub_server: Vox.PubSub
end
