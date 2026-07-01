defmodule Mix.Tasks.Relay.Token do
  @shortdoc "Mint a one-time join token for a private relay"
  @moduledoc "Usage: mix relay.token  → prints a one-time enroll token."
  use Mix.Task

  def run(_args) do
    Pochta.Release.boot_repo()
    IO.puts(Pochta.Admin.mint_token())
  end
end
