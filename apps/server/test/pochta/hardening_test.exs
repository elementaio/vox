defmodule Pochta.HardeningTest do
  use ExUnit.Case, async: false

  describe "admin audit log" do
    setup do
      Pochta.Repo.delete_all("admin_audit")
      :ok
    end

    test "records admin actions with attribution, newest first" do
      Pochta.Audit.log("add_member", "pubX", "tok123abcd", "1.2.3.4")
      Pochta.Audit.log("mint_token", "abcd1234…", "tok123abcd", "1.2.3.4")

      list = Pochta.Audit.list()
      assert length(list) == 2
      assert hd(list).action == "mint_token"

      entry = Enum.find(list, &(&1.action == "add_member"))
      assert entry.detail == "pubX"
      assert entry.actor == "tok123abcd"
      assert entry.ip == "1.2.3.4"
      assert is_integer(entry.ts)
    end
  end

  describe "federation rate limiter" do
    test "caps a peer after the configured pushes per window; others unaffected" do
      prev = Application.get_env(:pochta, :federation_rate_limit)
      Application.put_env(:pochta, :federation_rate_limit, 3)
      on_exit(fn -> Application.put_env(:pochta, :federation_rate_limit, prev) end)

      peer = "peer-" <> Integer.to_string(System.unique_integer([:positive]))
      assert Pochta.Federation.RateLimiter.check(peer) == :ok
      assert Pochta.Federation.RateLimiter.check(peer) == :ok
      assert Pochta.Federation.RateLimiter.check(peer) == :ok
      assert Pochta.Federation.RateLimiter.check(peer) == :rate_limited
      # a different peer has its own budget
      assert Pochta.Federation.RateLimiter.check(peer <> "-other") == :ok
    end
  end
end
