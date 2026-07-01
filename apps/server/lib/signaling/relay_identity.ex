defmodule Signaling.RelayIdentity do
  @moduledoc """
  The RELAY's own Ed25519 keypair — its permanent fingerprint in federation
  (separate from user identities). Generated on first boot and persisted to
  disk (`RELAY_KEY_PATH`, default `relay_identity.key`, 0600). The public key is
  the relay's "address"; it signs outbound federation pushes so peers can prove a
  push genuinely came from this relay (forgery resistance), and is served at
  `GET /federation/identity`.
  """
  use Agent

  def start_link(_opts), do: Agent.start_link(fn -> load_or_generate() end, name: __MODULE__)

  @doc "This relay's public key (hex)."
  def pubkey_hex, do: Agent.get(__MODULE__, & &1.pub_hex)

  @doc "Sign a message with the relay key; returns hex signature."
  def sign(msg) when is_binary(msg) do
    priv = Agent.get(__MODULE__, & &1.priv)
    :crypto.sign(:eddsa, :none, msg, [priv, :ed25519]) |> Base.encode16(case: :lower)
  end

  @doc "Verify a hex signature over `msg` against a peer relay's hex pubkey."
  def verify(pub_hex, msg, sig_hex) do
    with {:ok, pub} <- Base.decode16(pub_hex, case: :mixed),
         {:ok, sig} <- Base.decode16(sig_hex, case: :mixed) do
      :crypto.verify(:eddsa, :none, msg, sig, [pub, :ed25519])
    else
      _ -> false
    end
  rescue
    _ -> false
  end

  defp load_or_generate do
    path = System.get_env("RELAY_KEY_PATH") || "relay_identity.key"

    case File.read(path) do
      {:ok, data} ->
        [pub_hex, priv_hex] = data |> String.trim() |> String.split("\n", parts: 2)
        %{pub_hex: pub_hex, priv: Base.decode16!(String.trim(priv_hex), case: :mixed)}

      _ ->
        {pub, priv} = :crypto.generate_key(:eddsa, :ed25519)
        pub_hex = Base.encode16(pub, case: :lower)
        File.write!(path, pub_hex <> "\n" <> Base.encode16(priv, case: :lower))
        File.chmod(path, 0o600)
        %{pub_hex: pub_hex, priv: priv}
    end
  end
end
