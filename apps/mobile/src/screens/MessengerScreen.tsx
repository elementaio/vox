import { useState } from "react";
import { type Identity } from "@pochta-chat/sdk";
import { kv } from "../adapters";
import { useMessenger } from "../hooks/useMessenger";
import RelaySetupScreen from "./RelaySetupScreen";
import ContactsScreen from "./ContactsScreen";
import ChatScreen from "./ChatScreen";

const RELAY_KEY = "chat.relay.v1";

/** Routes between relay setup → contacts → chat, driven by the useMessenger hook. */
export default function MessengerScreen({
  identity,
  onSignOut,
}: {
  identity: Identity;
  onSignOut: () => void;
}) {
  const [relay, setRelay] = useState<string | null>(() => kv.getItem(RELAY_KEY));

  if (!relay) {
    return (
      <RelaySetupScreen
        onSet={(r) => {
          kv.setItem(RELAY_KEY, r);
          setRelay(r);
        }}
        onSignOut={onSignOut}
      />
    );
  }
  return <Connected identity={identity} relay={relay} onSignOut={onSignOut} />;
}

function Connected({
  identity,
  relay,
  onSignOut,
}: {
  identity: Identity;
  relay: string;
  onSignOut: () => void;
}) {
  const m = useMessenger(identity, relay);
  if (m.active) {
    return (
      <ChatScreen
        contact={m.contacts.find((c) => c.pubkey === m.active)}
        messages={m.messages}
        status={m.status}
        onBack={m.back}
        onSend={m.send}
      />
    );
  }
  return (
    <ContactsScreen
      contacts={m.contacts}
      status={m.status}
      onOpen={m.open}
      onAdd={m.addContact}
      onSignOut={onSignOut}
    />
  );
}
