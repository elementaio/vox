defmodule VoxWeb.RoomChannel do
  @moduledoc """
  A meeting room — the "join by link" surface. Unlike an inbox (which requires
  membership and is 1:1), a room is joinable by anyone who has the link, including
  GUESTS with an ephemeral identity and no account. The relay only ever:

    * tracks the room ROSTER (each participant's pubkey, encryption key, name) via
      Presence — so peers can discover each other and set up the E2E mesh, and
    * ROUTES sealed signaling between participants (offer/answer/ICE/forwarder).

  The signaling envelopes are sealed to the recipient's key, so the relay carries
  opaque bytes it can't read — media flows peer-to-peer, end-to-end, exactly like
  a contact call. Rooms are ephemeral: they exist while occupied and vanish when
  empty (Presence untracks on disconnect); nothing is persisted.

  On a guarded org relay, guest rooms can be disabled (`:allow_guest_rooms`) so
  only members may join — otherwise a room welcomes external guests by link.
  """
  use Phoenix.Channel
  alias VoxWeb.Presence

  @impl true
  def join("room:" <> room_id, params, socket) do
    cond do
      room_id == "" ->
        {:error, %{reason: "bad room"}}

      not room_allowed?(socket) ->
        {:error, %{reason: "guests are not allowed on this relay"}}

      true ->
        send(self(), :after_join)
        name = Map.get(params, "name", socket.assigns.name)
        {:ok, assign(socket, room_id: room_id, display_name: name)}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _ref} =
      Presence.track(socket, socket.assigns.pubkey, %{
        pubkey: socket.assigns.pubkey,
        enc: socket.assigns.enc,
        name: socket.assigns.display_name,
        joined_at: System.system_time(:second)
      })

    # Hand the joiner the current roster; Presence pushes "presence_diff" for
    # subsequent joins/leaves automatically.
    push(socket, "roster", Presence.list(socket))
    {:noreply, socket}
  end

  # Sealed peer-to-peer signaling. Broadcast to the room; the envelope is sealed
  # to `to`, so only that peer can open it — others simply ignore signals not
  # addressed to their pubkey. (Broadcast is fine at mesh/forwarder sizes; a
  # targeted route is a later optimization.)
  @impl true
  def handle_in("signal", %{"to" => to, "envelope" => env} = msg, socket) do
    if Vox.RateLimiter.allow?({:room_signal, socket.assigns.pubkey}, signal_limit()) do
      broadcast_from!(socket, "signal", %{
        from: socket.assigns.pubkey,
        to: to,
        envelope: env,
        kind: msg["kind"]
      })

      {:reply, :ok, socket}
    else
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    end
  end

  def handle_in(_event, _payload, socket), do: {:noreply, socket}

  defp room_allowed?(socket) do
    Application.get_env(:vox, :allow_guest_rooms, true) or
      Vox.Membership.allowed?(socket.assigns.pubkey)
  end

  defp signal_limit, do: Application.get_env(:vox, :room_signal_rate, 1200)
end
