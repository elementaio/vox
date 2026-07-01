defmodule PochtaWeb.EngineTransport do
  @moduledoc """
  Bridges `chat_engine` to a Phoenix channel.

  A `Chat.Session` holds `{EngineTransport, channel_pid}` and calls `push/2` to
  send an outbound envelope. We just forward it to the channel process, which
  relays it to the browser. The engine stays transport-agnostic; this is the seam.
  """
  @behaviour Chat.Transport

  @impl true
  def push(channel_pid, %Chat.Envelope{} = envelope) do
    send(channel_pid, {:engine_out, envelope})
    :ok
  end

  @impl true
  def close(channel_pid, reason) do
    send(channel_pid, {:engine_close, reason})
    :ok
  end
end
