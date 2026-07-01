defmodule Signaling.Delivery do
  @moduledoc """
  Deliver a sealed envelope into a local recipient's inbox conversation. Shared
  by local sends (`InboxChannel`) and federated pushes (`FederationController`).
  The payload is opaque ciphertext (JSON-encoded for the durable store).
  """

  def deliver(to, from, envelope, id, ephemeral) do
    :ok = Chat.create_conversation(to, [to])

    message = %Chat.Message{
      id: id || random_id(),
      sender_id: from,
      payload: Jason.encode!(envelope),
      kind: if(ephemeral, do: :ephemeral, else: :chat)
    }

    Chat.inject(to, message)
  end

  def random_id, do: Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)
end
