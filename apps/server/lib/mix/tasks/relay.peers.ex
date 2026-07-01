defmodule Mix.Tasks.Relay.Peers do
  @shortdoc "List / allow / revoke federated peer relays"
  @moduledoc """
  Usage:
    mix relay.peers                    # list known peer relays + trust state
    mix relay.peers allow <origin>     # trust a peer by origin (fetches + binds its key)
    mix relay.peers revoke <pubkey>    # revoke a peer
  """
  use Mix.Task

  def run(args) do
    Signaling.Release.boot_repo()

    case args do
      ["allow", origin] ->
        case Signaling.Admin.allow_relay(origin) do
          {:ok, pub} -> IO.puts("allowed #{origin} (#{pub})")
          _ -> IO.puts("could not reach #{origin}/federation/identity")
        end

      ["revoke", pubkey] ->
        Signaling.Admin.revoke_relay(pubkey)
        IO.puts("revoked #{pubkey}")

      _ ->
        relays = Signaling.Admin.list_relays()
        IO.puts("#{length(relays)} peer relay(s):")

        Enum.each(relays, fn r ->
          IO.puts("  #{r.pubkey}  #{r.origin}#{if r.revoked, do: "  (revoked)", else: ""}")
        end)
    end
  end
end
