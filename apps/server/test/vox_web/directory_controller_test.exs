defmodule VoxWeb.DirectoryControllerTest do
  use ExUnit.Case, async: false
  import Phoenix.ConnTest
  import Plug.Conn

  @endpoint VoxWeb.Endpoint

  setup do
    Vox.Repo.delete_all("directory")
    {pub, priv} = :crypto.generate_key(:eddsa, :ed25519)
    %{pub: Base.encode16(pub, case: :lower), priv: priv}
  end

  defp sign(priv, msg), do: Base.encode16(:crypto.sign(:eddsa, :none, msg, [priv, :ed25519]), case: :lower)

  test "signed register, then signed search finds the handle", %{pub: pub, priv: priv} do
    ts = Integer.to_string(System.system_time(:millisecond))
    sig = sign(priv, "directory|carol|#{ts}")

    conn =
      build_conn()
      |> post("/directory/register", %{pubkey: pub, enc: "encC", handle: "carol", name: "Carol", ts: ts, sig: sig})

    assert json_response(conn, 200)["ok"]

    sts = Integer.to_string(System.system_time(:millisecond))

    sconn =
      build_conn()
      |> put_req_header("x-vox-pubkey", pub)
      |> put_req_header("x-vox-ts", sts)
      |> put_req_header("x-vox-sig", sign(priv, "directory-search|#{sts}"))
      |> get("/directory/search?q=car")

    results = json_response(sconn, 200)["results"]
    assert Enum.any?(results, &(&1["handle"] == "carol" and &1["pubkey"] == pub))
  end

  test "unsigned search is rejected" do
    assert build_conn() |> get("/directory/search?q=car") |> json_response(403)
  end

  test "register with a bad signature is rejected", %{pub: pub, priv: priv} do
    ts = Integer.to_string(System.system_time(:millisecond))
    # sign the WRONG message
    conn =
      build_conn()
      |> post("/directory/register", %{pubkey: pub, enc: "e", handle: "dave", ts: ts, sig: sign(priv, "wrong|#{ts}")})

    assert json_response(conn, 403)
  end
end
