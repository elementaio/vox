defmodule Signaling.Admin do
  @moduledoc """
  Operator surface for running a private / federated relay.

  Call these on a running relay:

    * **release**:  `bin/signaling rpc "Signaling.Admin.mint_token()"`
    * **dev/IEx**:  `iex -S mix` then `Signaling.Admin.mint_token()`
    * or the `mix relay.*` tasks (dev, safe alongside a running server — they open
      only the DB, not the endpoint).

  ## Members (guarded/private relays)
    * `mint_token/0`       — one-time join token to hand a new member
    * `add_member/1`       — add a member pubkey directly
    * `list_members/0`     — list member pubkeys
    * `remove_member/1`    — remove a member
    * `list_tokens/0`      — issued tokens + used state

  ## Federation peers
    * `allow_relay/1`      — trust a peer by origin (fetches + binds its key)
    * `revoke_relay/1`     — revoke a peer by pubkey
    * `list_relays/0`      — known peers + trust state
  """
  alias Signaling.Membership
  alias Signaling.Federation.Policy

  defdelegate mint_token(), to: Membership, as: :create_token
  defdelegate add_member(pubkey), to: Membership, as: :add
  defdelegate list_members(), to: Membership
  defdelegate remove_member(pubkey), to: Membership
  defdelegate list_tokens(), to: Membership

  defdelegate allow_relay(origin), to: Policy, as: :allow_origin
  defdelegate revoke_relay(pubkey), to: Policy, as: :revoke
  defdelegate list_relays(), to: Policy
end
