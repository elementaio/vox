import { useMemo, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Vault, type Identity } from "@pochta-chat/sdk";
import { kv } from "./src/adapters";
import { LanguageProvider } from "./src/i18n";
import WelcomeScreen from "./src/screens/WelcomeScreen";
import UnlockScreen from "./src/screens/UnlockScreen";
import MessengerScreen from "./src/screens/MessengerScreen";

// Thin root: language provider + the identity gate. Each state renders one screen;
// no screen is a monolith (see src/screens, src/components, src/ui).
export default function App() {
  return (
    <LanguageProvider>
      <Root />
    </LanguageProvider>
  );
}

function Root() {
  const vault = useMemo(() => new Vault(kv), []);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [locked, setLocked] = useState(vault.has());

  const screen = identity ? (
    <MessengerScreen identity={identity} onSignOut={() => setIdentity(null)} />
  ) : locked ? (
    <UnlockScreen
      vault={vault}
      onReady={setIdentity}
      onReset={() => {
        vault.clear();
        setLocked(false);
      }}
    />
  ) : (
    <WelcomeScreen vault={vault} onReady={setIdentity} />
  );

  return (
    <>
      {screen}
      <StatusBar style="light" />
    </>
  );
}
