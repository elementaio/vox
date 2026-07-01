defmodule Pochta.Federation.RateLimiter do
  @moduledoc """
  Per-peer rate limit on inbound federation pushes (anti-flood).

  Signing proves *who* sent a push, not that it isn't abuse — a compromised or
  malicious *allowlisted* peer could still flood a recipient's inbox. This caps
  each authenticated peer relay to N pushes per minute (fixed window), keyed by
  the peer's relay pubkey. Backed by a concurrent ETS counter; old windows are
  swept periodically. Fails open if the table isn't ready (never blocks delivery
  on limiter trouble).
  """
  use GenServer

  @table :federation_rate
  @window_ms 60_000
  @sweep_ms 60_000
  @default_max 120

  def start_link(_opts), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc "Record a push from `peer`; `:ok` if under the limit this window, else `:rate_limited`."
  def check(peer) when is_binary(peer) do
    window = div(System.system_time(:millisecond), @window_ms)
    n = :ets.update_counter(@table, {peer, window}, {2, 1}, {{peer, window}, 0})
    if n > max_per_window(), do: :rate_limited, else: :ok
  rescue
    ArgumentError -> :ok
  end

  def check(_), do: :ok

  defp max_per_window, do: Application.get_env(:pochta, :federation_rate_limit, @default_max)

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :public, :set, write_concurrency: true, read_concurrency: true])
    schedule_sweep()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:sweep, state) do
    current = div(System.system_time(:millisecond), @window_ms)
    # Drop counters from windows older than the current one.
    :ets.select_delete(@table, [{{{:"$1", :"$2"}, :"$3"}, [{:<, :"$2", current}], [true]}])
    schedule_sweep()
    {:noreply, state}
  end

  defp schedule_sweep, do: Process.send_after(self(), :sweep, @sweep_ms)
end
