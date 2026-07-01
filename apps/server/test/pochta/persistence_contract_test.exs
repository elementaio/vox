defmodule Pochta.PersistenceContractTest do
  @moduledoc """
  Runs the engine's executable Persistence contract against our Postgres adapter.
  Asserts idempotency on id, monotonic gap-free seq, ordered read_after, and the
  optional CP fence (append/3).
  """
  # The store persists across runs, so start each test from a clean log (the
  # kit's per-test conversation ids only reset per-VM, not per-run).
  def reset do
    Pochta.Repo.delete_all("messages")
    :ok
  end

  use Chat.Persistence.PortTest,
    adapter: Pochta.Ports.Db.Persistence,
    setup: &Pochta.PersistenceContractTest.reset/0
end
