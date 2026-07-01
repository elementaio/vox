defmodule Signaling.RetentionTest do
  use ExUnit.Case, async: false
  alias Signaling.Ports.Db.Persistence

  setup do
    # Tables are created by the migration at app boot (mix test starts the app).
    Signaling.Repo.delete_all("messages")
    :ok
  end

  test "sweep drops messages older than the retention window, keeps recent ones" do
    now = System.system_time(:millisecond)
    ancient = 1000
    conv = "gc-conv-#{System.unique_integer([:positive])}"

    {:ok, _} =
      Persistence.append(conv, %Chat.Message{id: "old", sender_id: "u", payload: "x", server_ts: ancient})

    {:ok, _} =
      Persistence.append(conv, %Chat.Message{id: "fresh", sender_id: "u", payload: "x", server_ts: now})

    # Default 30-day window: "old" (ts 1000) is expired; "fresh" (now) is kept.
    assert Signaling.Retention.sweep() >= 1

    {:ok, msgs} = Persistence.read_after(conv, 0, 10)
    ids = Enum.map(msgs, & &1.id)
    refute "old" in ids
    assert "fresh" in ids
  end
end
