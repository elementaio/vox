defmodule Vox.DirectoryTest do
  use ExUnit.Case, async: false

  setup do
    Vox.Repo.delete_all("directory")
    :ok
  end

  test "handle rules" do
    assert Vox.Directory.valid_handle?("alice_1")
    refute Vox.Directory.valid_handle?("Al")
    refute Vox.Directory.valid_handle?("has space")
    refute Vox.Directory.valid_handle?("way_too_long_a_handle_over_thirty_chars")
  end

  test "register / search / lookup / unregister, with unique handles" do
    assert :ok = Vox.Directory.register("pkA", "alice", "Alice", "encA", "r")
    assert :ok = Vox.Directory.register("pkB", "bob", "Bob", "encB", "r")

    # a different pubkey can't steal a taken handle
    assert {:error, :taken} = Vox.Directory.register("pkC", "alice", "C", "encC", "r")
    # but the owner can update their own entry
    assert :ok = Vox.Directory.register("pkA", "alice", "Alice A.", "encA", "r")

    assert Enum.any?(Vox.Directory.search("al"), &(&1.handle == "alice" and &1.pubkey == "pkA"))
    assert Vox.Directory.lookup("bob").pubkey == "pkB"
    assert Vox.Directory.lookup("nope") == nil
    assert Vox.Directory.search("x") == []

    Vox.Directory.unregister("pkA")
    assert Vox.Directory.lookup("alice") == nil
  end
end
