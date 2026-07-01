defmodule Pochta.Ports.Db.ReceiptStore do
  @moduledoc "Read watermarks over Ecto. `set_read/3` is monotonic (forward-only)."
  @behaviour Chat.ReceiptStore.Port
  import Ecto.Query
  alias Pochta.Repo

  @impl true
  def set_read(conversation_id, user_id, seq) do
    Repo.insert_all(
      "receipts",
      [%{conversation_id: conversation_id, user_id: user_id, seq: seq}],
      on_conflict: from(r in "receipts", where: r.seq < ^seq, update: [set: [seq: ^seq]]),
      conflict_target: [:conversation_id, :user_id]
    )

    :ok
  rescue
    e -> {:error, e}
  end

  @impl true
  def read_watermarks(conversation_id) do
    pairs =
      Repo.all(
        from r in "receipts",
          where: r.conversation_id == ^conversation_id,
          select: {r.user_id, r.seq}
      )

    {:ok, Map.new(pairs)}
  rescue
    e -> {:error, e}
  end
end
