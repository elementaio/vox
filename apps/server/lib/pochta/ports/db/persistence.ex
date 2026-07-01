defmodule Pochta.Ports.Db.Persistence do
  @moduledoc """
  Durable `Chat.Persistence.Port` over Ecto — runs on SQLite or Postgres.

  Guarantees: idempotent on `message.id`, per-conversation monotonic gap-free
  `seq` from 1, `read_after/3` ascending, durable before returning. Writes for a
  conversation are serialized by the engine's single-owner GenServer (and the DB
  serializes too), so read-max-then-insert is safe; the unique (conversation_id,
  seq) index is the backstop.
  """
  @behaviour Chat.Persistence.Port
  import Ecto.Query
  alias Pochta.Repo
  alias Chat.Message

  @impl true
  def append(conversation_id, %Message{} = msg) do
    txn(fn ->
      case existing_seq(conversation_id, msg.id) do
        nil ->
          next = (max_seq(conversation_id) || 0) + 1
          insert!(conversation_id, msg, next)
          next

        seq ->
          seq
      end
    end)
  end

  @impl true
  def append(conversation_id, %Message{} = msg, expected_seq) when is_integer(expected_seq) do
    Repo.transaction(fn ->
      case existing_seq(conversation_id, msg.id) do
        seq when is_integer(seq) ->
          {:ok, seq}

        nil ->
          latest = max_seq(conversation_id) || 0

          if latest == expected_seq do
            next = expected_seq + 1
            insert!(conversation_id, msg, next)
            {:ok, next}
          else
            {:fenced, latest}
          end
      end
    end)
    |> case do
      {:ok, {:ok, seq}} -> {:ok, seq}
      {:ok, {:fenced, latest}} -> {:error, {:fenced, latest}}
      {:error, reason} -> {:error, reason}
    end
  rescue
    e -> {:error, e}
  end

  @impl true
  def read_after(conversation_id, after_seq, limit) do
    rows =
      Repo.all(
        from m in "messages",
          where: m.conversation_id == ^conversation_id and m.seq > ^after_seq,
          order_by: [asc: m.seq],
          limit: ^limit,
          select: %{
            id: m.id,
            sender_id: m.sender_id,
            payload: m.payload,
            seq: m.seq,
            server_ts: m.server_ts,
            kind: m.kind
          }
      )

    {:ok, Enum.map(rows, &to_message/1)}
  rescue
    e -> {:error, e}
  end

  @impl true
  def latest_seq(conversation_id) do
    {:ok, max_seq(conversation_id) || 0}
  rescue
    e -> {:error, e}
  end

  # --- helpers ---

  defp txn(fun) do
    case Repo.transaction(fun) do
      {:ok, seq} -> {:ok, seq}
      {:error, reason} -> {:error, reason}
    end
  rescue
    e -> {:error, e}
  end

  defp existing_seq(conversation_id, id) do
    Repo.one(
      from m in "messages",
        where: m.conversation_id == ^conversation_id and m.id == ^id,
        select: m.seq
    )
  end

  defp max_seq(conversation_id) do
    Repo.one(
      from m in "messages",
        where: m.conversation_id == ^conversation_id,
        select: max(m.seq)
    )
  end

  defp insert!(conversation_id, %Message{} = msg, seq) do
    Repo.insert_all("messages", [
      %{
        conversation_id: conversation_id,
        id: msg.id,
        sender_id: msg.sender_id,
        payload: msg.payload || <<>>,
        seq: seq,
        server_ts: msg.server_ts || System.system_time(:millisecond),
        kind: to_string(msg.kind || :chat)
      }
    ])
  end

  defp to_message(row) do
    %Message{
      id: row.id,
      sender_id: row.sender_id,
      payload: row.payload || <<>>,
      seq: row.seq,
      server_ts: row.server_ts,
      kind: if(row.kind, do: String.to_atom(row.kind), else: :chat),
      meta: %{}
    }
  end
end
