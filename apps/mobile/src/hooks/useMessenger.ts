import { useEffect, useRef, useState } from "react";
import {
  Client,
  Vault,
  type ClientEvents,
  type Identity,
  type StoredContact,
  type StoredMessage,
} from "@pochta-chat/sdk";
import { getContacts, getMessages, kv, store } from "../adapters";

/**
 * All the SDK `Client` wiring + live state for the messenger, kept out of the UI.
 * Screens just render `contacts`/`messages`/`status` and call `send`/`addContact`.
 */
export function useMessenger(identity: Identity, relay: string) {
  const [contacts, setContacts] = useState<StoredContact[]>(getContacts());
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [status, setStatus] = useState("connecting…");
  const clientRef = useRef<Client | null>(null);
  const activeRef = useRef<string | null>(null);

  const refreshContacts = () => setContacts(getContacts());
  const refreshActive = () => setMessages(activeRef.current ? getMessages(activeRef.current) : []);

  useEffect(() => {
    const events: ClientEvents = {
      onStatus: setStatus,
      onMessage: (contact) => {
        refreshContacts();
        if (contact === activeRef.current) refreshActive();
      },
      onMessageUpdated: refreshActive,
      onMessageRemoved: refreshActive,
      onReceipt: refreshActive,
      onTyping: () => {},
      onContact: refreshContacts,
      onPresence: () => {},
      onIncomingCall: () => {},
      onCallState: () => {},
      onLocalStream: () => {},
      onRemoteStream: () => {},
    };
    const client = new Client({
      socketUrl: relay.replace(/^http/, "ws") + "/socket",
      httpBase: relay,
      identity,
      store,
      events,
      deviceId: new Vault(kv).deviceId(),
    });
    clientRef.current = client;
    client.connect(getContacts());
    return () => client.leave();
  }, [relay, identity]);

  useEffect(() => {
    activeRef.current = active;
    refreshActive();
  }, [active]);

  return {
    contacts,
    active,
    messages,
    status,
    open: (pubkey: string) => setActive(pubkey),
    back: () => setActive(null),
    send: (text: string) => {
      if (active) void clientRef.current?.sendText(active, text);
    },
    addContact: async (c: StoredContact) => {
      await clientRef.current?.addContact(c);
      refreshContacts();
      setActive(c.pubkey);
    },
  };
}
