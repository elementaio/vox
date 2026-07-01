defmodule Pochta.Ports.Db.PresenceStore do
  @moduledoc "Coarse last-seen over Ecto. `touch/2` is monotonic (forward-only)."
  @behaviour Chat.PresenceStore.Port
  import Ecto.Query
  alias Pochta.Repo

  @impl true
  def touch(user_id, ts) do
    Repo.insert_all(
      "presence",
      [%{user_id: user_id, last_seen: ts}],
      on_conflict: from(p in "presence", where: p.last_seen < ^ts, update: [set: [last_seen: ^ts]]),
      conflict_target: [:user_id]
    )

    :ok
  rescue
    e -> {:error, e}
  end

  @impl true
  def last_seen(user_id) do
    {:ok, Repo.one(from p in "presence", where: p.user_id == ^user_id, select: p.last_seen)}
  rescue
    e -> {:error, e}
  end
end
