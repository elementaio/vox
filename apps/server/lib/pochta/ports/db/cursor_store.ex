defmodule Pochta.Ports.Db.CursorStore do
  @moduledoc """
  Per-device delivery cursor over Ecto. `advance/3` is monotonic — the upsert
  only moves the cursor forward (conditional `ON CONFLICT DO UPDATE ... WHERE`).
  """
  @behaviour Chat.CursorStore.Port
  import Ecto.Query
  alias Pochta.Repo

  @impl true
  def get(device_ref, conversation_id) do
    seq =
      Repo.one(
        from c in "cursors",
          where: c.device_key == ^key(device_ref) and c.conversation_id == ^conversation_id,
          select: c.seq
      )

    {:ok, seq || 0}
  rescue
    e -> {:error, e}
  end

  @impl true
  def advance(device_ref, conversation_id, seq) do
    Repo.insert_all(
      "cursors",
      [%{device_key: key(device_ref), conversation_id: conversation_id, seq: seq}],
      on_conflict: from(c in "cursors", where: c.seq < ^seq, update: [set: [seq: ^seq]]),
      conflict_target: [:device_key, :conversation_id]
    )

    :ok
  rescue
    e -> {:error, e}
  end

  defp key(device_ref), do: Base.encode64(:erlang.term_to_binary(device_ref))
end
