defmodule Signaling.Federation.Policy do
  @moduledoc """
  Trust policy for accepting a (signature-verified) federation push, per the
  operator's `:federation_policy` config:

    * `:open`      — accept any relay whose signature verifies (record it for visibility)
    * `:tofu`      — accept + record on first contact; honor revocation
    * `:allowlist` — accept only relays an operator explicitly added (and not revoked)

  A family/company relay wants `:allowlist`; a public volunteer relay wants
  `:open`. Revocation (`revoked_at`) is honored in every mode.
  """
  import Ecto.Query
  alias Signaling.Repo

  @doc """
  Decide whether to accept a push signed by `relay_pubkey` claiming `origin`.

  The signature already proved possession of `relay_pubkey`. On FIRST contact we
  also bind pubkey↔origin: fetch `<origin>/federation/identity` and confirm it
  serves the same pubkey — so a relay can't lie about *which* origin it is
  (you're trusting DNS+TLS, the web's existing root). Once bound, later pushes
  short-circuit. Revocation and allowlist are honored on top.
  """
  def check(relay_pubkey, origin \\ nil) do
    cond do
      revoked?(relay_pubkey) ->
        :error

      # Already bound (verified before) — accept per policy.
      known?(relay_pubkey) ->
        if policy() == :allowlist, do: :ok, else: :ok

      # Unknown relay: allowlist never auto-accepts; open/tofu bind via origin.
      policy() == :allowlist ->
        :error

      true ->
        case verify_origin(relay_pubkey, origin) do
          :ok ->
            record(relay_pubkey, origin)
            :ok

          :error ->
            :error
        end
    end
  end

  # Reverse-fetch the claimed origin's identity and confirm it vouches for this key.
  defp verify_origin(_pubkey, nil), do: :error
  defp verify_origin(_pubkey, ""), do: :error

  defp verify_origin(pubkey, origin) do
    url = String.trim_trailing(origin, "/") <> "/federation/identity"

    case Req.get(url, retry: false, receive_timeout: 5_000) do
      {:ok, %{status: 200, body: %{"relay_pubkey" => ^pubkey}}} -> :ok
      _ -> :error
    end
  rescue
    _ -> :error
  end

  defp policy, do: Application.get_env(:signaling, :federation_policy, :open)

  @doc "Operator action: explicitly trust a peer relay (for :allowlist)."
  def allow(relay_pubkey, origin \\ nil), do: record(relay_pubkey, origin)

  @doc "Operator action: trust a peer by ORIGIN — fetches + binds its key."
  def allow_origin(origin) do
    url = String.trim_trailing(origin, "/") <> "/federation/identity"

    case Req.get(url, retry: false, receive_timeout: 5_000) do
      {:ok, %{status: 200, body: %{"relay_pubkey" => pub}}} ->
        record(pub, origin)
        {:ok, pub}

      _ ->
        :error
    end
  rescue
    _ -> :error
  end

  @doc "Operator: list known peer relays and their trust state."
  def list_relays do
    Repo.all(
      from k in "known_relays",
        select: %{pubkey: k.relay_pubkey, origin: k.origin, revoked: not is_nil(k.revoked_at)}
    )
  end

  @doc "Operator action: revoke trust in a peer relay."
  def revoke(relay_pubkey) do
    Repo.update_all(
      from(k in "known_relays", where: k.relay_pubkey == ^relay_pubkey),
      set: [revoked_at: System.system_time(:millisecond)]
    )

    :ok
  end

  defp known?(relay_pubkey) do
    Repo.exists?(
      from k in "known_relays",
        where: k.relay_pubkey == ^relay_pubkey and is_nil(k.revoked_at)
    )
  end

  defp revoked?(relay_pubkey) do
    Repo.exists?(
      from k in "known_relays",
        where: k.relay_pubkey == ^relay_pubkey and not is_nil(k.revoked_at)
    )
  end

  defp record(relay_pubkey, origin) do
    Repo.insert_all(
      "known_relays",
      [%{relay_pubkey: relay_pubkey, origin: origin, first_seen: System.system_time(:millisecond)}],
      on_conflict: :nothing,
      conflict_target: [:relay_pubkey]
    )

    :ok
  end
end
