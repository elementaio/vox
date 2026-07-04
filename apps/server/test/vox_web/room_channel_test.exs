defmodule VoxWeb.RoomChannelTest do
  use ExUnit.Case, async: false
  import Phoenix.ChannelTest

  @endpoint VoxWeb.Endpoint

  defp join_room(pk, room \\ "room:demo") do
    VoxWeb.UserSocket
    |> socket("identity:#{pk}", %{pubkey: pk, enc: pk <> "-enc", name: "P#{pk}"})
    |> subscribe_and_join(VoxWeb.RoomChannel, room, %{"name" => "Guest #{pk}"})
  end

  test "join hands back the roster and routes sealed signals to the room" do
    {:ok, _reply, socket} = join_room("aaaa")
    assert_push "roster", roster
    assert is_map(roster)

    ref = push(socket, "signal", %{"to" => "bbbb", "envelope" => %{"ct" => "abc"}, "kind" => "call-offer"})
    assert_reply ref, :ok
    # The envelope is sealed to bbbb; it's broadcast to the room, others ignore it.
    assert_broadcast "signal", %{from: "aaaa", to: "bbbb", envelope: %{"ct" => "abc"}, kind: "call-offer"}
  end

  test "guests are refused when guest rooms are disabled on a gated relay" do
    prev_guests = Application.get_env(:vox, :allow_guest_rooms)
    prev_mode = Application.get_env(:vox, :membership_mode)
    Application.put_env(:vox, :allow_guest_rooms, false)
    Application.put_env(:vox, :membership_mode, :invite)

    on_exit(fn ->
      Application.put_env(:vox, :allow_guest_rooms, prev_guests)
      Application.put_env(:vox, :membership_mode, prev_mode)
    end)

    assert {:error, %{reason: _}} = join_room("nonmember")
  end
end
