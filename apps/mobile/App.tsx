import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { createIdentity, restoreIdentity, Vault, type Identity } from "@pochta-chat/sdk";
import { kv } from "./src/adapters";

/**
 * Pochta mobile — onboarding first. This is the piece that proves the SDK's
 * self-owned identity + encrypted vault run natively on the phone (via MMKV).
 * The full messenger (contacts, chat, calls) is the next step; it reuses the same
 * SDK `Client` the web app does, with the native `store` adapter and react-native-webrtc.
 */
export default function App() {
  const vault = useMemo(() => new Vault(kv), []);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [locked, setLocked] = useState(vault.has());

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      {identity ? (
        <Home identity={identity} onSignOut={() => setIdentity(null)} />
      ) : locked ? (
        <Unlock vault={vault} onReady={setIdentity} onReset={() => { vault.clear(); setLocked(false); }} />
      ) : (
        <Welcome vault={vault} onReady={setIdentity} />
      )}
    </View>
  );
}

function Welcome({ vault, onReady }: { vault: Vault; onReady: (id: Identity) => void }) {
  const [id, setId] = useState<Identity | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (!id || pass.length < 4) return;
    setBusy(true);
    await vault.persist(id, pass);
    onReady(id);
  }

  return (
    <ScrollView contentContainerStyle={styles.center}>
      <Text style={styles.brand}>📮 Pochta</Text>
      <Text style={styles.sub}>Your mail, not their archive.</Text>

      {!id ? (
        <>
          <Pressable style={styles.btn} onPress={() => setId(createIdentity())}>
            <Text style={styles.btnText}>Create a new account</Text>
          </Pressable>
          <Text style={styles.hint}>An account is a key on this device — no email, no phone number.</Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>Your 12-word recovery phrase — write it down:</Text>
          <Text style={styles.mnemonic}>{id.mnemonic}</Text>
          <Text style={styles.label}>Set a passphrase to encrypt it on this device:</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="passphrase"
            placeholderTextColor="#6b7488"
            value={pass}
            onChangeText={setPass}
          />
          <Pressable style={styles.btn} onPress={finish} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Encrypt &amp; continue</Text>}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function Unlock({
  vault,
  onReady,
  onReset,
}: {
  vault: Vault;
  onReady: (id: Identity) => void;
  onReset: () => void;
}) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    const id = await vault.unlock(pass);
    setBusy(false);
    if (id) onReady(id);
    else setError("Wrong passphrase.");
  }

  return (
    <ScrollView contentContainerStyle={styles.center}>
      <Text style={styles.brand}>📮 Pochta</Text>
      <Text style={styles.label}>Unlock your account</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="passphrase"
        placeholderTextColor="#6b7488"
        value={pass}
        onChangeText={setPass}
        onSubmitEditing={unlock}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.btn} onPress={unlock} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Unlock</Text>}
      </Pressable>
      <Pressable onPress={onReset}>
        <Text style={styles.reset}>Reset account</Text>
      </Pressable>
    </ScrollView>
  );
}

function Home({ identity, onSignOut }: { identity: Identity; onSignOut: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.center}>
      <Text style={styles.brand}>📮 Pochta</Text>
      <Text style={styles.sub}>Signed in as</Text>
      <Text style={styles.name}>{identity.name}</Text>
      <Text style={styles.pub}>{identity.publicKeyHex.slice(0, 16)}…</Text>
      <Text style={styles.hint}>
        Messenger (contacts, chat, calls) is next — it reuses the same SDK Client as the
        web app, with the native store adapter and react-native-webrtc.
      </Text>
      <Pressable onPress={onSignOut}>
        <Text style={styles.reset}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#0b0d12" },
  center: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 14 },
  brand: { color: "#fff", fontSize: 34, fontWeight: "800", textAlign: "center" },
  sub: { color: "#9aa2b4", fontSize: 16, textAlign: "center", marginBottom: 10 },
  name: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  pub: { color: "#9aa2b4", fontSize: 13, textAlign: "center", fontFamily: "Courier" },
  label: { color: "#e8eaf0", fontSize: 14, marginTop: 8 },
  hint: { color: "#9aa2b4", fontSize: 13, textAlign: "center", marginTop: 12, lineHeight: 19 },
  mnemonic: {
    color: "#fb7185", fontSize: 16, lineHeight: 26, backgroundColor: "#12151d",
    padding: 14, borderRadius: 12, textAlign: "center",
  },
  input: {
    backgroundColor: "#12151d", color: "#fff", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#242a37",
  },
  btn: { backgroundColor: "#E11D48", borderRadius: 12, padding: 15, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: "#fb7185", textAlign: "center" },
  reset: { color: "#9aa2b4", textAlign: "center", marginTop: 16 },
});
