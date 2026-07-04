defmodule VoxWeb.InboxChannel do
  @moduledoc """
  A user's private mailbox, backed by `chat_engine`.

  Each identity's inbox is a single-member engine conversation (id = the user's
  public key). A connected device runs a `Chat.Session` that catches up any
  missed messages from its cursor on join, then receives live ones. Senders
  `inject` a sealed envelope into the recipient's inbox conversation; the engine
  persists it (gap-free `seq`), delivers live if the recipient is online, and
  replays it on reconnect if not.

  A socket may only open its OWN inbox — the topic key must match the key the
  socket authenticated with. Payloads are sealed; the relay never reads them.
  """
  use Phoenix.Channel

  @impl true
  def join("inbox:" <> pubkey, params, socket) do
    cond do
      pubkey != socket.assigns[:pubkey] ->
        {:error, %{reason: "forbidden — you can only open your own inbox"}}

      # Members-only messaging on a guarded relay (this gate moved here from the
      # socket so guests can still join meeting rooms without an inbox).
      not Vox.Membership.allowed?(pubkey) ->
        {:error, %{reason: "not a member of this relay"}}

      true ->
        # Ensure the inbox conversation exists with this identity as its member,
        # so an offline recipient still catches up on reconnect.
        :ok = Chat.create_conversation(pubkey, [pubkey])
        device_id = Map.get(params, "device_id") || random_id()

        case Chat.Session.connect(%{
               user_id: pubkey,
               device_id: device_id,
               transport: {VoxWeb.EngineTransport, self()}
             }) do
          {:ok, session} -> {:ok, assign(socket, :session, session)}
          {:error, reason} -> {:error, %{reason: inspect(reason)}}
        end
    end
  end

  # Engine → client. Durable and ephemeral (typing) messages both arrive as
  # :message envelopes; we forward the opaque sealed payload as-is.
  @impl true
  def handle_info({:engine_out, %Chat.Envelope{type: :message} = env}, socket) do
    # Payload is stored as an opaque binary (JSON of the sealed envelope); decode
    # back to the map the client expects.
    push(socket, "message", %{envelope: Jason.decode!(env.payload), from: env.sender_id, seq: env.seq})
    {:noreply, socket}
  end

  # Other engine envelope types (ack/system/presence/…) aren't needed yet.
  def handle_info({:engine_out, _env}, socket), do: {:noreply, socket}
  def handle_info({:engine_close, _reason}, socket), do: {:noreply, socket}

  # Client → relay: deliver a sealed envelope to the recipient. If their home
  # relay is another server, forward there (federation); else deliver locally.
  @impl true
  def handle_in("send", %{"to" => to, "envelope" => envelope} = params, socket) do
    # Per-socket flood cap: one connected member can otherwise pin the writer /
    # amplify federation with an unbounded send loop. The default is generous
    # (call signaling bursts ICE candidates), so it only trips on pathological use.
    if not Vox.RateLimiter.allow?({:send, socket.assigns.pubkey}, send_limit()) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      id = Map.get(params, "id") || Vox.Delivery.random_id()
      ephemeral = Map.get(params, "ephemeral", false)
      relay = Map.get(params, "relay")

      status =
        cond do
          Vox.Federation.local?(relay) ->
            case Vox.Delivery.deliver(to, socket.assigns.pubkey, envelope, id, ephemeral) do
              {:ok, seq} -> seq
              {:error, reason} -> %{error: inspect(reason)}
            end

          # Fully-private relay: never send messages off the network.
          Vox.Federation.closed?() ->
            "federation_disabled"

          true ->
            Vox.Federation.forward(relay, %{
              to: to,
              from: socket.assigns.pubkey,
              envelope: envelope,
              id: id,
              ephemeral: ephemeral
            })

            "forwarded"
        end

      {:reply, {:ok, %{status: status}}, socket}
    end
  end

  # Presence query: online? / last-seen for a set of identities (the engine
  # tracks this via sessions; last_seen is recorded on disconnect).
  @impl true
  def handle_in("presence", %{"of" => pubkeys}, socket) when is_list(pubkeys) do
    cond do
      # Bound the fan-out: each key is a store lookup, so an unbounded list is a
      # client-controlled work-amplification vector.
      length(pubkeys) > presence_max() ->
        {:reply, {:error, %{reason: "too_many"}}, socket}

      not Vox.RateLimiter.allow?({:presence, socket.assigns.pubkey}, presence_limit()) ->
        {:reply, {:error, %{reason: "rate_limited"}}, socket}

      true ->
        presence =
          Map.new(pubkeys, fn pk ->
            {pk,
             case Chat.presence_of(pk) do
               :online -> %{online: true, last_seen: nil}
               {:offline, ts} -> %{online: false, last_seen: ts}
             end}
          end)

        {:reply, {:ok, %{presence: presence}}, socket}
    end
  end

  @impl true
  def terminate(_reason, socket) do
    if session = socket.assigns[:session], do: Chat.Session.disconnect(session)
    :ok
  end

  defp random_id, do: Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)

  defp send_limit, do: Application.get_env(:vox, :channel_send_rate, 1200)
  defp presence_limit, do: Application.get_env(:vox, :channel_presence_rate, 240)
  defp presence_max, do: Application.get_env(:vox, :presence_max, 256)
end
