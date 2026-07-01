defmodule PochtaWeb.ConfigControllerTest do
  use PochtaWeb.ConnCase, async: false

  test "GET /config returns the static ICE servers", %{conn: conn} do
    body = conn |> get(~p"/config") |> json_response(200)
    assert is_list(body["ice_servers"])
  end

  test "GET /config hands out time-limited TURN credentials when configured", %{conn: conn} do
    Application.put_env(:pochta, :turn_urls, ["turn:turn.example:3478"])
    Application.put_env(:pochta, :turn_secret, "s3cr3t")

    on_exit(fn ->
      Application.delete_env(:pochta, :turn_urls)
      Application.delete_env(:pochta, :turn_secret)
    end)

    body = conn |> get(~p"/config") |> json_response(200)
    turn = Enum.find(body["ice_servers"], &Map.has_key?(&1, "credential"))

    assert turn["urls"] == ["turn:turn.example:3478"]
    # username is the expiry unix timestamp (in the future), credential is HMAC.
    assert String.match?(turn["username"], ~r/^\d+$/)
    assert String.to_integer(turn["username"]) > System.system_time(:second)
    assert is_binary(turn["credential"]) and byte_size(turn["credential"]) > 0
  end
end
