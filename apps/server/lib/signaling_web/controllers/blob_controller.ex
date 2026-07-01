defmodule SignalingWeb.BlobController do
  @moduledoc """
  Content-blind encrypted blob store for media (images, voice notes, files).

  The client encrypts the file on-device and uploads only ciphertext; the
  decryption key travels inside the E2E-sealed message, never here. So the relay
  stores and serves opaque bytes it can't read. Bounded by retention (old blobs
  are swept like messages).
  """
  use SignalingWeb, :controller
  import Ecto.Query
  alias Signaling.Repo

  @max_bytes 25 * 1024 * 1024

  # POST /blobs  (multipart: field "file" = ciphertext)
  def upload(conn, %{"file" => %Plug.Upload{path: path}}) do
    data = File.read!(path)

    if byte_size(data) > @max_bytes do
      conn |> put_status(413) |> json(%{error: "too large"})
    else
      id = Base.url_encode64(:crypto.strong_rand_bytes(18), padding: false)

      Repo.insert_all("blobs", [
        %{id: id, data: data, inserted_ts: System.system_time(:millisecond)}
      ])

      json(conn, %{id: id})
    end
  end

  def upload(conn, _), do: conn |> put_status(400) |> json(%{error: "missing file"})

  # GET /blobs/:id  → raw ciphertext
  def download(conn, %{"id" => id}) do
    case Repo.one(from b in "blobs", where: b.id == ^id, select: b.data) do
      nil ->
        conn |> put_status(404) |> json(%{error: "not found"})

      data ->
        conn
        |> put_resp_content_type("application/octet-stream")
        |> send_resp(200, data)
    end
  end
end
