defmodule Signaling.AdminTest do
  use ExUnit.Case, async: false
  alias Signaling.Admin

  setup do
    Signaling.Repo.delete_all("members")
    Signaling.Repo.delete_all("enroll_tokens")
    Signaling.Repo.delete_all("known_relays")
    :ok
  end

  test "member add / list / remove" do
    assert Admin.list_members() == []
    :ok = Admin.add_member("pubA")
    assert "pubA" in Admin.list_members()
    :ok = Admin.remove_member("pubA")
    refute "pubA" in Admin.list_members()
  end

  test "mint + list tokens (unused)" do
    tok = Admin.mint_token()
    assert is_binary(tok) and byte_size(tok) > 0
    assert Enum.any?(Admin.list_tokens(), &(&1.token == tok and &1.used == false))
  end

  test "peer allow / list / revoke" do
    :ok = Signaling.Federation.Policy.allow("peerpub", "http://peer.example")
    assert Enum.any?(Admin.list_relays(), &(&1.pubkey == "peerpub" and &1.revoked == false))
    :ok = Admin.revoke_relay("peerpub")
    assert Enum.any?(Admin.list_relays(), &(&1.pubkey == "peerpub" and &1.revoked == true))
  end
end
