import { useEffect, useState } from "react";
import { clearIdentity, hasIdentity, type Identity } from "./lib/identity";
import { setDbKey } from "./lib/db";
import Welcome from "./Welcome";
import Unlock from "./Unlock";
import Messenger from "./Messenger";
import AdminPanel from "./AdminPanel";
import "./App.css";

export default function App() {
  // The relay admin panel is a separate route — no user identity involved.
  if (location.pathname === "/admin" || new URLSearchParams(location.search).has("admin")) {
    return <AdminPanel />;
  }
  return <Main />;
}

function Main() {
  const [identity, setIdentity] = useState<Identity | null>(null);

  // Ask the browser to keep our storage durable (don't evict under pressure) —
  // it's the only copy of the user's history.
  useEffect(() => {
    void navigator.storage?.persist?.();
  }, []);

  // Unlocking / creating hands us the in-memory identity; derive the at-rest
  // storage key from it before anything reads the encrypted database.
  function ready(id: Identity) {
    setDbKey(id.privateKey);
    setIdentity(id);
  }

  if (!identity) {
    return hasIdentity() ? (
      <Unlock
        onReady={ready}
        onReset={() => {
          clearIdentity();
          location.reload();
        }}
      />
    ) : (
      <Welcome onReady={ready} />
    );
  }

  return <Messenger identity={identity} onSignOut={() => setIdentity(null)} />;
}
