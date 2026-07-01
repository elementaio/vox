defmodule Pochta.Retention do
  @moduledoc """
  Bounds the relay's delivery buffer. The server is NOT an archive — history
  lives on devices. This periodically drops sealed messages older than the
  retention window (default 30 days), so the store can't grow without bound even
  if a device never comes back to ack.

  (A future refinement can also drop sooner once *all* of a conversation's
  devices have acked a message — via min-cursor — but age alone keeps it bounded.)
  """
  use GenServer
  import Ecto.Query
  require Logger
  alias Pochta.Repo

  @default_days 30
  @default_sweep_ms 60 * 60 * 1000

  def start_link(_opts), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  @impl true
  def init(_) do
    schedule()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:sweep, state) do
    sweep()
    schedule()
    {:noreply, state}
  end

  @doc "Delete messages, media blobs, and stale outbox rows older than the window."
  def sweep(now \\ System.system_time(:millisecond)) do
    cutoff = now - retention_ms()
    {msgs, _} = Repo.delete_all(from m in "messages", where: m.server_ts < ^cutoff)
    {blobs, _} = Repo.delete_all(from b in "blobs", where: b.inserted_ts < ^cutoff)
    {fed, _} = Repo.delete_all(from o in "federation_outbox", where: o.inserted_ts < ^cutoff)
    total = msgs + blobs + fed
    if total > 0, do: Logger.info("retention: swept #{msgs} msgs, #{blobs} blobs, #{fed} outbox")
    total
  end

  defp schedule, do: Process.send_after(self(), :sweep, sweep_ms())

  defp retention_ms,
    do: Application.get_env(:pochta, :retention_days, @default_days) * 24 * 60 * 60 * 1000

  defp sweep_ms, do: Application.get_env(:pochta, :retention_sweep_ms, @default_sweep_ms)
end
