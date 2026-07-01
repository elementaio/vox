defmodule Mix.Tasks.Relay.Members do
  @shortdoc "List / add / remove members of a private relay"
  @moduledoc """
  Usage:
    mix relay.members                 # list member pubkeys
    mix relay.members add <pubkey>    # add a member
    mix relay.members remove <pubkey> # remove a member
  """
  use Mix.Task

  def run(args) do
    Pochta.Release.boot_repo()

    case args do
      ["add", pubkey] ->
        Pochta.Admin.add_member(pubkey)
        IO.puts("added #{pubkey}")

      ["remove", pubkey] ->
        Pochta.Admin.remove_member(pubkey)
        IO.puts("removed #{pubkey}")

      _ ->
        members = Pochta.Admin.list_members()
        IO.puts("#{length(members)} member(s):")
        Enum.each(members, &IO.puts("  #{&1}"))
    end
  end
end
