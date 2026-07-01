defmodule Pochta.Ports.Db.ConversationStore do
  @moduledoc "Membership store over Ecto (SQLite/Postgres)."
  @behaviour Chat.ConversationStore.Port
  import Ecto.Query
  alias Pochta.Repo

  @impl true
  def member?(conversation_id, user_id) do
    Repo.exists?(
      from m in "conversation_members",
        where: m.conversation_id == ^conversation_id and m.user_id == ^user_id
    )
  rescue
    _ -> false
  end

  @impl true
  def add_member(conversation_id, user_id) do
    Repo.insert_all(
      "conversation_members",
      [%{conversation_id: conversation_id, user_id: user_id}],
      on_conflict: :nothing,
      conflict_target: [:conversation_id, :user_id]
    )

    :ok
  rescue
    e -> {:error, e}
  end

  @impl true
  def remove_member(conversation_id, user_id) do
    Repo.delete_all(
      from m in "conversation_members",
        where: m.conversation_id == ^conversation_id and m.user_id == ^user_id
    )

    :ok
  rescue
    e -> {:error, e}
  end

  @impl true
  def stream_members(conversation_id, _cursor, _limit) do
    members =
      Repo.all(
        from m in "conversation_members",
          where: m.conversation_id == ^conversation_id,
          select: m.user_id
      )

    {:ok, members, nil}
  rescue
    e -> {:error, e}
  end

  @impl true
  def conversations_for(user_id) do
    convs =
      Repo.all(
        from m in "conversation_members", where: m.user_id == ^user_id, select: m.conversation_id
      )

    {:ok, convs}
  rescue
    e -> {:error, e}
  end

  @impl true
  def member_count(conversation_id) do
    {:ok,
     Repo.aggregate(
       from(m in "conversation_members", where: m.conversation_id == ^conversation_id),
       :count
     )}
  rescue
    e -> {:error, e}
  end
end
