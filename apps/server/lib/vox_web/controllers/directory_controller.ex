defmodule VoxWeb.DirectoryController do
  @moduledoc """
  The opt-in "find people" directory API. Every request is SIGNED by the caller's
  identity key (proving possession, like the socket auth), and on a guarded relay
  the caller must be a member — so a private org's directory is only reachable by
  its own people.
  """
  use VoxWeb, :controller

  @ts_window_ms 5 * 60 * 1000

  # POST /directory/register  {pubkey, enc, handle, name, relay, ts, sig}
  #   sig = Ed25519 over "directory|<handle>|<ts>"
  def register(conn, %{"pubkey" => pub, "enc" => enc, "handle" => handle, "ts" => ts, "sig" => sig} = p) do
    if authed_body?(pub, "directory|#{handle}|#{ts}", ts, sig) and Vox.Membership.allowed?(pub) do
      case Vox.Directory.register(pub, handle, p["name"], enc, p["relay"]) do
        :ok -> json(conn, %{ok: true})
        {:error, :taken} -> conn |> put_status(409) |> json(%{error: "handle taken"})
        {:error, :bad_handle} -> conn |> put_status(400) |> json(%{error: "bad handle"})
      end
    else
      conn |> put_status(403) |> json(%{error: "invalid"})
    end
  end

  def register(conn, _), do: conn |> put_status(400) |> json(%{error: "bad request"})

  # POST /directory/unregister  {pubkey, ts, sig}   sig over "directory-remove|<ts>"
  def unregister(conn, %{"pubkey" => pub, "ts" => ts, "sig" => sig}) do
    if authed_body?(pub, "directory-remove|#{ts}", ts, sig) do
      Vox.Directory.unregister(pub)
      json(conn, %{ok: true})
    else
      conn |> put_status(403) |> json(%{error: "invalid"})
    end
  end

  def unregister(conn, _), do: conn |> put_status(400) |> json(%{error: "bad request"})

  # GET /directory/search?q=...  authed via X-Vox-Pubkey/Ts/Sig (sig over "directory-search|<ts>")
  def search(conn, %{"q" => q}) do
    case signed_caller(conn) do
      {:ok, pub} ->
        cond do
          not Vox.RateLimiter.allow?({:dir_search, pub}, search_limit()) ->
            conn |> put_status(429) |> json(%{error: "rate limited"})

          not Vox.Membership.allowed?(pub) ->
            conn |> put_status(403) |> json(%{error: "not a member"})

          true ->
            json(conn, %{results: Vox.Directory.search(q)})
        end

      :error ->
        conn |> put_status(403) |> json(%{error: "invalid"})
    end
  end

  def search(conn, _), do: json(conn, %{results: []})

  # GET /directory/lookup?handle=...  authed like search
  def lookup(conn, %{"handle" => handle}) do
    with {:ok, pub} <- signed_caller(conn),
         true <- Vox.Membership.allowed?(pub),
         row when is_map(row) <- Vox.Directory.lookup(handle) do
      json(conn, row)
    else
      nil -> conn |> put_status(404) |> json(%{error: "not found"})
      _ -> conn |> put_status(403) |> json(%{error: "invalid"})
    end
  end

  def lookup(conn, _), do: conn |> put_status(400) |> json(%{error: "bad request"})

  # --- helpers ---

  defp authed_body?(pub, msg, ts, sig) do
    with {:ok, pubkey} <- Base.decode16(pub, case: :mixed),
         {:ok, sigb} <- Base.decode16(sig, case: :mixed),
         {ts_int, ""} <- Integer.parse(to_string(ts)),
         true <- fresh?(ts_int) do
      verify(pubkey, msg, sigb)
    else
      _ -> false
    end
  end

  defp signed_caller(conn) do
    with [pub] <- get_req_header(conn, "x-vox-pubkey"),
         [ts] <- get_req_header(conn, "x-vox-ts"),
         [sig] <- get_req_header(conn, "x-vox-sig"),
         true <- authed_body?(pub, "directory-search|#{ts}", ts, sig) do
      {:ok, pub}
    else
      _ -> :error
    end
  end

  defp fresh?(ts_int), do: abs(System.system_time(:millisecond) - ts_int) <= @ts_window_ms

  defp verify(pub, msg, sig) do
    :crypto.verify(:eddsa, :none, msg, sig, [pub, :ed25519])
  rescue
    _ -> false
  end

  defp search_limit, do: Application.get_env(:vox, :directory_search_rate, 120)
end
