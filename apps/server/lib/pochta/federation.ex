defmodule Pochta.Federation do
  @moduledoc """
  Relay-to-relay forwarding — turns islands into a network.

  When a client sends to a contact whose home-relay isn't us, we forward the
  (still-sealed) envelope to that relay's `/federation/push`. The relay can't read
  it; the recipient verifies the sender from the sealed content.

  Delivery is durable: forwards go through an **outbox** (a DB table) and are
  retried with exponential backoff, so a briefly-down peer relay doesn't lose
  messages. Given up after `@max_attempts`.

  Not yet done (hardening): signed server-to-server auth + allowlists (v1 accepts
  any push → spam risk, not forgery).
  """
  use GenServer
  import Ecto.Query
  require Logger
  alias Pochta.Repo

  @max_attempts 12
  @max_backoff_ms 5 * 60 * 1000

  # ── public API ────────────────────────────────────────────────────────────

  def start_link(_opts), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)

  @doc "This relay's public base URL (what others federate to)."
  def self_url, do: System.get_env("PUBLIC_URL") || "http://localhost:4000"

  @doc "Is `relay` us (or unspecified)? Then deliver locally."
  def local?(nil), do: true
  def local?(""), do: true
  def local?(relay), do: normalize(relay) == normalize(self_url())

  @doc "Fully-private relay? Then no federation in or out (a sealed island)."
  def closed?, do: Application.get_env(:pochta, :federation_mode, :open) == :closed

  @doc "Durably enqueue a forward to another relay; try immediately, retry on failure."
  def forward(relay, payload) do
    id = Pochta.Delivery.random_id()
    now = now()

    Repo.insert_all("federation_outbox", [
      %{
        id: id,
        relay: normalize(relay),
        payload: Jason.encode!(payload),
        attempts: 0,
        next_attempt_ts: now,
        inserted_ts: now
      }
    ])

    Task.start(fn -> deliver(id) end)
    :ok
  end

  # ── sweeper ───────────────────────────────────────────────────────────────

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

  @doc "Retry every due outbox row."
  def sweep(now \\ now()) do
    Repo.all(
      from o in "federation_outbox",
        where: o.next_attempt_ts <= ^now,
        limit: 200,
        select: %{id: o.id, relay: o.relay, payload: o.payload, attempts: o.attempts}
    )
    |> Enum.each(&attempt/1)
  end

  # ── internals ─────────────────────────────────────────────────────────────

  defp deliver(id) do
    case Repo.one(
           from o in "federation_outbox",
             where: o.id == ^id,
             select: %{id: o.id, relay: o.relay, payload: o.payload, attempts: o.attempts}
         ) do
      nil -> :ok
      row -> attempt(row)
    end
  end

  defp attempt(%{id: id, relay: relay, payload: payload, attempts: attempts}) do
    url = relay <> "/federation/push"

    case post(url, payload) do
      :ok ->
        Repo.delete_all(from o in "federation_outbox", where: o.id == ^id)

      :error ->
        if attempts + 1 >= @max_attempts do
          Logger.warning("federation: giving up on #{url} after #{attempts + 1} tries")
          Repo.delete_all(from o in "federation_outbox", where: o.id == ^id)
        else
          backoff = min(@max_backoff_ms, round(:math.pow(2, attempts) * 1000))

          Repo.update_all(
            from(o in "federation_outbox", where: o.id == ^id),
            set: [attempts: attempts + 1, next_attempt_ts: now() + backoff]
          )
        end
    end
  end

  defp post(url, json_payload) do
    # Sign the transport wrapper so the peer can prove this push came from us
    # (the envelope inside is already E2E sealed+signed by the user).
    %{"to" => to, "id" => mid} = Jason.decode!(json_payload)
    pub = Pochta.RelayIdentity.pubkey_hex()
    ts = Integer.to_string(System.system_time(:second))
    sig = Pochta.RelayIdentity.sign("#{pub}|#{ts}|#{to}|#{mid}")

    case Req.post(url,
           body: json_payload,
           headers: [
             {"content-type", "application/json"},
             {"x-relay-pubkey", pub},
             {"x-relay-origin", self_url()},
             {"x-relay-ts", ts},
             {"x-relay-sig", sig}
           ],
           retry: false,
           receive_timeout: 5_000
         ) do
      {:ok, %{status: 200}} -> :ok
      _ -> :error
    end
  rescue
    _ -> :error
  end

  defp schedule, do: Process.send_after(self(), :sweep, sweep_ms())
  defp sweep_ms, do: String.to_integer(System.get_env("FEDERATION_SWEEP_MS") || "5000")
  defp now, do: System.system_time(:millisecond)
  defp normalize(url), do: String.trim_trailing(url, "/")
end
