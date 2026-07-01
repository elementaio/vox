defmodule SignalingWeb.UserSocket do
  use Phoenix.Socket
  require Logger

  # Each identity has a private store-and-forward mailbox. It carries durable
  # messages, receipts, typing, AND call signaling (offer/answer/ICE) — all
  # sealed, so this one channel is the whole client-facing surface.
  channel "inbox:*", SignalingWeb.InboxChannel

  # Max clock skew / replay window for the signed auth timestamp.
  @auth_window_ms 5 * 60 * 1000

  @doc """
  Authenticate by signature — no passwords, no account database.

  The client proves possession of its private key by signing `pubkey|ts` with
  its Ed25519 key. We verify that signature against the claimed public key and
  reject stale timestamps. The public key *is* the identity; we never store it.
  """
  @impl true
  def connect(
        %{"pubkey" => pubkey_hex, "enc" => enc_hex, "ts" => ts, "sig" => sig_hex} = params,
        socket,
        _info
      ) do
    with {:ok, pubkey} <- decode_hex(pubkey_hex),
         {:ok, sig} <- decode_hex(sig_hex),
         {ts_int, ""} <- Integer.parse(ts),
         true <- fresh?(ts_int),
         true <- verify(pubkey, "#{pubkey_hex}|#{enc_hex}|#{ts}", sig),
         # Guarded membership: on a private relay, only enrolled pubkeys connect.
         true <- Signaling.Membership.allowed?(pubkey_hex) do
      name = Map.get(params, "name", short(pubkey_hex))

      {:ok,
       socket
       |> assign(:pubkey, pubkey_hex)
       |> assign(:enc, enc_hex)
       |> assign(:name, name)}
    else
      _ ->
        Logger.info("rejected socket: bad or stale signature")
        :error
    end
  end

  def connect(_params, _socket, _info), do: :error

  # Identify the socket by its public key (used for per-identity broadcasts).
  @impl true
  def id(%{assigns: %{pubkey: pubkey}}), do: "identity:#{pubkey}"
  def id(_socket), do: nil

  defp decode_hex(hex), do: Base.decode16(hex, case: :mixed)

  defp fresh?(ts_int), do: abs(System.system_time(:millisecond) - ts_int) <= @auth_window_ms

  defp verify(pubkey, message, sig) do
    :crypto.verify(:eddsa, :none, message, sig, [pubkey, :ed25519])
  rescue
    _ -> false
  end

  defp short(hex), do: String.slice(hex, 0, 12)
end
