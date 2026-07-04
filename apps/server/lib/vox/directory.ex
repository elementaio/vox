defmodule Vox.Directory do
  @moduledoc """
  Opt-in "find people" directory: a searchable handle → identity mapping.

  Discovery is OPT-IN — you're only listed if you register a handle. It's
  ORG-SCOPED: on a guarded relay only members can register (and the directory is
  therefore just the org's own people); on an open relay it's a public opt-in
  username directory. Only public info is stored (handle, display name, and the
  keys someone needs to add + message you); no message content, ever.
  """
  import Ecto.Query
  alias Vox.Repo

  @handle_re ~r/^[a-z0-9_]{3,30}$/

  @doc "A handle is 3–30 chars of lowercase letters, digits, and underscore."
  def valid_handle?(h), do: is_binary(h) and Regex.match?(@handle_re, h)

  @doc "Register/replace this identity's directory entry. Returns :ok or {:error, reason}."
  def register(pubkey, handle, name, enc, relay) do
    handle = String.downcase(handle || "")

    cond do
      not valid_handle?(handle) ->
        {:error, :bad_handle}

      taken_by_other?(handle, pubkey) ->
        {:error, :taken}

      true ->
        Repo.insert_all(
          "directory",
          [%{pubkey: pubkey, handle: handle, name: name, enc: enc, relay: relay, ts: now()}],
          on_conflict: {:replace, [:handle, :name, :enc, :relay, :ts]},
          conflict_target: [:pubkey]
        )

        :ok
    end
  end

  def unregister(pubkey) do
    Repo.delete_all(from d in "directory", where: d.pubkey == ^pubkey)
    :ok
  end

  @doc "Prefix/substring search by handle or name (bounded)."
  def search(q, limit \\ 20) do
    q = q |> to_string() |> String.trim() |> String.downcase()

    if String.length(q) < 2 do
      []
    else
      like_prefix = q <> "%"
      like_any = "%" <> q <> "%"

      Repo.all(
        from d in "directory",
          where: like(d.handle, ^like_prefix) or like(fragment("lower(?)", d.name), ^like_any),
          order_by: [asc: d.handle],
          limit: ^min(limit, 50),
          select: %{handle: d.handle, name: d.name, pubkey: d.pubkey, enc: d.enc, relay: d.relay}
      )
    end
  end

  @doc "Resolve an exact handle to an identity (for 'add @handle')."
  def lookup(handle) do
    handle = String.downcase(handle || "")

    Repo.one(
      from d in "directory",
        where: d.handle == ^handle,
        select: %{handle: d.handle, name: d.name, pubkey: d.pubkey, enc: d.enc, relay: d.relay}
    )
  end

  defp taken_by_other?(handle, pubkey) do
    Repo.exists?(from d in "directory", where: d.handle == ^handle and d.pubkey != ^pubkey)
  end

  defp now, do: System.system_time(:millisecond)
end
