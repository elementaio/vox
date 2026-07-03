import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { QRCodeSVG } from "qrcode.react";
import { Client, type CallState, type PresenceInfo } from "./lib/client";
import {
  getContacts,
  getMessages,
  lastMessage,
  searchMessages,
  type MessageStatus,
  type StoredContact,
  type StoredMessage,
} from "./lib/db";
import { type Identity } from "./lib/identity";
import { hasPasskey, isPasskeySupported, registerPasskey } from "./lib/passkey";
import { inviteLink, parseInvite } from "./lib/invite";
import { serverLabel, setServer, socketUrl } from "./lib/server";
import { enroll } from "./lib/enroll";
import { useLocales } from "./locales";
import { presenceText, previewText, time } from "./lib/format";
import {
  CallOverlay,
  CallToast,
  Composer,
  ContactRow,
  GroupCallOverlay,
  GroupCallStarter,
  MessageBubble,
  type Preview,
} from "./components";
import {
  Logo,
  IconSearch,
  IconPlus,
  IconPhone,
  IconVideo,
  IconSettings,
  IconBack,
  IconMoon,
  IconSun,
  IconUsers,
  IconShield,
  IconGlobe,
  IconDevice,
  IconKey,
  IconServer,
  IconLogout,
} from "./components/icons";
import { NetworkPanel } from "./components/network";
import { desktop } from "./lib/desktop";
import { currentTheme, toggleTheme, type Theme } from "./lib/theme";

export default function Messenger({
  identity,
  onSignOut,
}: {
  identity: Identity;
  onSignOut: () => void;
}) {
  const { t, toggle } = useLocales();
  const [status, setStatus] = useState("connecting…");
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<StoredMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StoredMessage[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addLink, setAddLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(currentTheme());
  const [networkOpen, setNetworkOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [canBio, setCanBio] = useState(false); // platform passkey available + not set up yet
  const [callState, setCallState] = useState<CallState>("ended");
  const [incoming, setIncoming] = useState<{
    contact: string;
    name: string;
    callId: string;
    video: boolean;
    roster?: string[];
  } | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Record<string, { name: string; stream: MediaStream }>>({});
  const [groupActive, setGroupActive] = useState(false);
  const [groupStarterOpen, setGroupStarterOpen] = useState(false);

  const clientRef = useRef<Client | null>(null);
  const activeRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimers = useRef<Map<string, number>>(new Map());
  const iTypeTimer = useRef<number | undefined>(undefined);
  const iTyping = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  activeRef.current = active;

  // --- one-time setup: load history, connect, handle ?add= ---
  useEffect(() => {
    let client: Client;
    (async () => {
      const stored = await getContacts();
      setContacts(stored);
      setPreviews(await loadPreviews(tRef.current, stored));

      client = new Client(socketUrl(), identity, {
        onStatus: setStatus,
        onContact: (c) =>
          setContacts((prev) =>
            prev.some((p) => p.pubkey === c.pubkey)
              ? prev.map((p) => (p.pubkey === c.pubkey ? c : p))
              : [...prev, c].sort((a, b) => a.name.localeCompare(b.name)),
          ),
        onMessage: (contact, msg) => {
          setPreviews((prev) => ({
            ...prev,
            [contact]: { text: previewText(tRef.current, msg), ts: msg.ts, mine: msg.mine },
          }));
          if (activeRef.current === contact) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          } else if (!msg.mine) {
            setUnread((prev) => ({ ...prev, [contact]: (prev[contact] ?? 0) + 1 }));
          }
        },
        onMessageUpdated: (contact, msg) => {
          if (activeRef.current === contact) {
            setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
          }
          setPreviews((prev) => ({
            ...prev,
            [contact]: {
              text: msg.deleted ? tRef.current("chat.deletedShort") : msg.text,
              ts: msg.ts,
              mine: msg.mine,
            },
          }));
        },
        onMessageRemoved: (contact, id) => {
          if (activeRef.current === contact) {
            setMessages((prev) => prev.filter((m) => m.id !== id));
          }
        },
        onReceipt: (contact, id, state) => {
          if (activeRef.current === contact) applyReceipt(id, state);
        },
        onTyping: (contact, on) => handleTyping(contact, on),
        onPresence: (contact, info) => setPresence((p) => ({ ...p, [contact]: info })),
        onIncomingCall: (contact, name, callId, video, roster) =>
          setIncoming({ contact, name, callId, video, roster }),
        onCallState: (state) => {
          setCallState(state);
          if (state === "ended") {
            setIncoming(null);
            setLocalStream(null);
            setRemoteStream(null);
            setPeers({});
            setGroupActive(false);
          } else if (state !== "ringing") {
            setIncoming(null);
          }
        },
        onLocalStream: setLocalStream,
        onRemoteStream: setRemoteStream,
        onPeerStream: (pubkey, name, stream) =>
          setPeers((prev) => {
            const next = { ...prev };
            if (stream) next[pubkey] = { name, stream };
            else delete next[pubkey];
            return next;
          }),
      });
      clientRef.current = client;
      client.connect(stored);

      const token = new URLSearchParams(location.search).get("add");
      if (token) {
        const c = parseInvite(token);
        if (c && c.pubkey !== identity.publicKeyHex) {
          await client.addContact(c);
          openConversation(c.pubkey);
        }
        history.replaceState(null, "", location.pathname);
      }
    })();
    return () => client?.leave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const rank: Record<MessageStatus, number> = { sent: 0, delivered: 1, read: 2 };
  function applyReceipt(id: string, state: "delivered" | "read") {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.mine && (!m.status || rank[state] > rank[m.status])
          ? { ...m, status: state }
          : m,
      ),
    );
  }

  function handleTyping(contact: string, on: boolean) {
    const timers = typingTimers.current;
    window.clearTimeout(timers.get(contact));
    if (!on) {
      setTyping((p) => ({ ...p, [contact]: false }));
      return;
    }
    setTyping((p) => ({ ...p, [contact]: true }));
    timers.set(
      contact,
      window.setTimeout(() => setTyping((p) => ({ ...p, [contact]: false })), 5000),
    );
  }

  async function openConversation(pubkey: string) {
    setActive(pubkey);
    activeRef.current = pubkey;
    clientRef.current?.setActive(pubkey);
    setMessages(await getMessages(pubkey));
    setUnread((prev) => ({ ...prev, [pubkey]: 0 }));
    clientRef.current?.queryPresence([pubkey]);
    setTimeout(() => clientRef.current?.markRead(pubkey), 0);
  }

  function react(m: StoredMessage, emoji: string) {
    if (active) void clientRef.current?.react(active, m.id, emoji);
  }

  async function onSearch(v: string) {
    setQuery(v);
    setResults(v.trim() ? await searchMessages(v) : []);
  }
  const contactName = (pubkey: string) =>
    contacts.find((c) => c.pubkey === pubkey)?.name ?? pubkey.slice(0, 8);

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file || !active) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mkind = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("audio/")
        ? "audio"
        : "file";
    await clientRef.current?.sendMedia(
      active,
      bytes,
      file.type || "application/octet-stream",
      mkind,
      file.name,
    );
  }

  async function startRecording() {
    if (!active) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((tk) => tk.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size && active) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          await clientRef.current?.sendMedia(active, bytes, blob.type || "audio/webm", "audio");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      /* mic unavailable */
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function editMsg(m: StoredMessage) {
    if (!active) return;
    const next = prompt(t("prompts.editMessage"), m.text);
    if (next != null && next.trim() && next.trim() !== m.text) {
      void clientRef.current?.editText(active, m.id, next.trim());
    }
  }

  function delMsg(m: StoredMessage) {
    if (!active) return;
    if (m.mine) {
      if (confirm(t("prompts.deleteForEveryone"))) {
        void clientRef.current?.deleteForEveryone(active, m.id);
      }
    } else if (confirm(t("prompts.deleteForYou"))) {
      void clientRef.current?.deleteForMe(active, m.id);
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    void clientRef.current?.sendText(active, text, replyingTo?.id);
    setDraft("");
    setReplyingTo(null);
    stopTyping();
  }

  function stopTyping() {
    window.clearTimeout(iTypeTimer.current);
    if (iTyping.current && active) {
      iTyping.current = false;
      clientRef.current?.setTyping(active, false);
    }
  }
  function onDraft(value: string) {
    setDraft(value);
    if (!active) return;
    if (!iTyping.current && value) {
      iTyping.current = true;
      clientRef.current?.setTyping(active, true);
    }
    window.clearTimeout(iTypeTimer.current);
    iTypeTimer.current = window.setTimeout(stopTyping, 2000);
  }

  async function joinNetwork() {
    const token = prompt(t("prompts.joinTokenPrompt"));
    if (!token) return;
    const okd = await enroll(identity, token.trim());
    if (okd) {
      alert(t("prompts.enrolled"));
      location.reload();
    } else {
      alert(t("prompts.enrollFailed"));
    }
  }

  function changeServer() {
    const cur = serverLabel();
    const next = prompt(t("prompts.relayPrompt"), cur === "this site" ? "" : cur);
    if (next !== null) {
      setServer(next);
      location.reload();
    }
  }

  function signOut() {
    // Non-destructive: returns to the account picker and leaves this account's data
    // encrypted on the device. (Removing data is an explicit action in the picker.)
    onSignOut();
  }

  // Offer biometric unlock only where a platform authenticator exists + not yet set up.
  useEffect(() => {
    void (async () => {
      if (!hasPasskey(identity.publicKeyHex) && (await isPasskeySupported())) setCanBio(true);
    })();
  }, [identity.publicKeyHex]);

  async function enableBiometric() {
    const ok = await registerPasskey(identity.publicKeyHex, identity.name, identity.mnemonic);
    alert(ok ? t("onboarding.biometricEnabled") : t("onboarding.biometricSetupFailed"));
    if (ok) setCanBio(false);
  }

  function flipTheme() {
    setTheme(toggleTheme());
  }

  function copyLink() {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  // Add a contact from a pasted invite (full URL or raw token).
  async function addByPastedLink() {
    const raw = addLink.trim();
    if (!raw) return;
    let token = raw;
    try {
      token = new URL(raw).searchParams.get("add") || raw;
    } catch {
      /* not a URL — treat the whole thing as a token */
    }
    const c = parseInvite(token);
    if (c && c.pubkey !== identity.publicKeyHex) {
      await clientRef.current?.addContact(c);
      setAddLink("");
      setAddOpen(false);
      openConversation(c.pubkey);
    } else {
      alert(t("chat.invalidInvite"));
    }
  }

  function menuAction(fn: () => void) {
    setMenuOpen(false);
    fn();
  }

  function beginGroupCall(pubkeys: string[], video: boolean) {
    setGroupActive(true);
    setGroupStarterOpen(false);
    void clientRef.current?.startGroupCall(pubkeys, video);
  }

  function acceptIncoming() {
    if (!incoming) return;
    if (incoming.roster && incoming.roster.length > 1) setGroupActive(true);
    void clientRef.current?.acceptCall(incoming.callId);
  }

  const activeContact = contacts.find((c) => c.pubkey === active);
  const link = inviteLink(identity);
  const inCall = callState === "calling" || callState === "connecting" || callState === "connected";
  const callName = incoming?.name ?? contacts.find((c) => c.pubkey === active)?.name ?? "";

  return (
    <div className="messenger">
      <aside className="sidebar">
        <div className="side-brand">
          <Logo size={34} />
          <span className="wordmark">Vox</span>
          <span className="grow" />
          <button
            className="icon-btn"
            onClick={flipTheme}
            title={theme === "dark" ? t("chat.lightMode") : t("chat.darkMode")}
            aria-label={theme === "dark" ? t("chat.lightMode") : t("chat.darkMode")}
          >
            {theme === "dark" ? <IconSun width="19" height="19" /> : <IconMoon width="19" height="19" />}
          </button>
        </div>

        <label className="search">
          <IconSearch width="17" height="17" />
          <input
            placeholder={t("chat.searchMessages")}
            value={query}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>

        <button className="side-new" onClick={() => setAddOpen(true)}>
          <IconPlus width="18" height="18" />
          {t("chat.newChat")}
        </button>

        <div className="side-list-label">{t("chat.chats")}</div>

        {query && (
          <div className="contact-list">
            {results.length === 0 && <div className="empty-list">{t("chat.noMatches")}</div>}
            {results.map((m) => (
              <button
                key={m.id}
                className="contact"
                onClick={() => {
                  openConversation(m.contact);
                  onSearch("");
                }}
              >
                <div className="avatar-wrap">
                  <div className="avatar">{contactName(m.contact).slice(0, 1).toUpperCase()}</div>
                </div>
                <div className="contact-main">
                  <div className="contact-top">
                    <span className="contact-name">{contactName(m.contact)}</span>
                    <span className="contact-time">{time(m.ts)}</span>
                  </div>
                  <div className="contact-sub">
                    <span className="preview">{m.text}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!query && (
          <div className="contact-list">
            {contacts.length === 0 && (
              <div className="empty-list">
                {t("chat.noContactsYet")}
                <br />
                {t("chat.tapInviteShare")}
              </div>
            )}
            {contacts.map((c) => (
              <ContactRow
                key={c.pubkey}
                c={c}
                active={active === c.pubkey}
                preview={previews[c.pubkey]}
                typing={!!typing[c.pubkey]}
                online={!!presence[c.pubkey]?.online}
                unread={unread[c.pubkey] ?? 0}
                onOpen={() => openConversation(c.pubkey)}
              />
            ))}
          </div>
        )}

        <div className="side-foot">
          <div className="avatar-wrap">
            <div className="avatar sm">{identity.name.slice(0, 1).toUpperCase()}</div>
            {status === "connected" && <span className="presence-dot" />}
          </div>
          <div className="foot-body">
            <div className="foot-name">
              {identity.name} <span className="you">({t("chat.youLabel")})</span>
            </div>
            <div className={`foot-status ${status === "connected" ? "on" : ""}`}>{status}</div>
          </div>
          <button
            className="icon-btn"
            onClick={() => setMenuOpen((o) => !o)}
            title={t("chat.settings")}
            aria-label={t("chat.settings")}
          >
            <IconSettings width="20" height="20" />
          </button>

          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="settings-menu">
                <button className="menu-item" onClick={() => menuAction(() => setGroupStarterOpen(true))}>
                  <IconUsers width="18" height="18" /> {t("chat.newGroupCall")}
                </button>
                <button className="menu-item" onClick={() => menuAction(() => setLinkOpen(true))}>
                  <IconDevice width="18" height="18" /> {t("chat.useAnotherDevice")}
                </button>
                {canBio && (
                  <button className="menu-item" onClick={() => menuAction(enableBiometric)}>
                    <IconKey width="18" height="18" /> {t("onboarding.enableBiometric")}
                  </button>
                )}
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => menuAction(changeServer)} title={serverLabel()}>
                  <IconServer width="18" height="18" /> {t("chat.changeRelay")}
                </button>
                {desktop() && (
                  <button className="menu-item" onClick={() => menuAction(() => setNetworkOpen(true))}>
                    <IconShield width="18" height="18" /> {t("network.open")}
                  </button>
                )}
                <button className="menu-item" onClick={() => menuAction(joinNetwork)}>
                  <IconKey width="18" height="18" /> {t("chat.joinPrivate")}
                </button>
                <button className="menu-item" onClick={() => menuAction(toggle)}>
                  <IconGlobe width="18" height="18" /> {t("settings.toggleLanguage")}
                </button>
                <div className="menu-sep" />
                <button className="menu-item danger" onClick={() => menuAction(signOut)}>
                  <IconLogout width="18" height="18" /> {t("chat.signOut")}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      <section className="conversation">
        {!activeContact ? (
          <div className="no-convo">
            <div>
              <Logo size={60} />
              <h2>{t("chat.selectContact")}</h2>
              <p className="muted">{t("chat.e2eNote")}</p>
            </div>
          </div>
        ) : (
          <>
            <header className="convo-header">
              <div className="avatar-wrap">
                <div className="avatar">{activeContact.name.slice(0, 1).toUpperCase()}</div>
                {presence[activeContact.pubkey]?.online && <span className="presence-dot" />}
              </div>
              <div>
                <div className="convo-name">{activeContact.name}</div>
                <div className={`convo-sub ${presence[activeContact.pubkey]?.online ? "" : "off"}`}>
                  {presenceText(t, presence[activeContact.pubkey])}
                </div>
              </div>
              <div className="call-buttons">
                <button
                  title={t("chat.voiceCall")}
                  aria-label={t("chat.voiceCall")}
                  onClick={() => clientRef.current?.startCall(activeContact.pubkey, false)}
                >
                  <IconPhone width="21" height="21" />
                </button>
                <button
                  title={t("chat.videoCall")}
                  aria-label={t("chat.videoCall")}
                  onClick={() => clientRef.current?.startCall(activeContact.pubkey, true)}
                >
                  <IconVideo width="21" height="21" />
                </button>
              </div>
            </header>

            <div className="messages">
              {messages.length === 0 && (
                <div className="empty">{t("chat.noMessagesYet", { name: activeContact.name })}</div>
              )}
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  quoted={m.replyTo ? messages.find((x) => x.id === m.replyTo) : undefined}
                  client={clientRef.current}
                  onReact={(emoji) => react(m, emoji)}
                  onReply={() => setReplyingTo(m)}
                  onEdit={() => editMsg(m)}
                  onDelete={() => delMsg(m)}
                />
              ))}
              <div ref={endRef} />
            </div>

            {replyingTo && (
              <div className="reply-bar">
                <div className="reply-quote">
                  <span className="reply-to">
                    {t("chat.replyingTo", {
                      who: replyingTo.mine ? t("chat.yourself") : activeContact.name,
                    })}
                  </span>
                  <span className="reply-text">
                    {replyingTo.deleted ? t("chat.deletedMessage") : replyingTo.text}
                  </span>
                </div>
                <button onClick={() => setReplyingTo(null)}>×</button>
              </div>
            )}

            <div className="typing-line">
              {typing[activeContact.pubkey] ? t("chat.isTyping", { name: activeContact.name }) : ""}
            </div>

            <Composer
              draft={draft}
              recording={recording}
              onDraftChange={onDraft}
              onSubmit={send}
              onToggleRecording={() => (recording ? stopRecording() : startRecording())}
              onFilePicked={onFilePicked}
            />
          </>
        )}

        {addOpen && (
          <div className="addpanel">
            <div className="addpanel-head">
              <button className="icon-btn" onClick={() => setAddOpen(false)} aria-label={t("chat.addPeople")}>
                <IconBack />
              </button>
              <h2>{t("chat.addPeople")}</h2>
            </div>
            <div className="addpanel-body">
              <div className="addpanel-inner">
                <div className="explain">
                  <span className="em">
                    <IconShield width="22" height="22" />
                  </span>
                  <p>
                    <b>{t("chat.addExplainTitle")}</b> {t("chat.addExplainBody")}
                  </p>
                </div>

                <div className="add-card">
                  <h3>{t("chat.yourInvite")}</h3>
                  <p className="hint">{t("chat.yourInviteHint")}</p>
                  <div className="qr-row">
                    <div className="qr-box">
                      <QRCodeSVG value={link} size={112} bgColor="#ffffff" fgColor="#0b1020" />
                    </div>
                    <div className="qr-side">
                      {t("chat.yourInviteSide")}
                      <div className="link-field">
                        <code>{link}</code>
                        <button onClick={copyLink}>{copied ? t("chat.copied") : t("chat.copy")}</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="add-divider">{t("chat.or")}</div>

                <div className="add-card">
                  <h3>{t("chat.addByLink")}</h3>
                  <p className="hint">{t("chat.addByLinkHint")}</p>
                  <div className="add-field">
                    <input
                      placeholder={t("chat.pasteInvite")}
                      value={addLink}
                      onChange={(e) => setAddLink(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addByPastedLink()}
                    />
                    <button disabled={!addLink.trim()} onClick={addByPastedLink}>
                      {t("chat.add")}
                    </button>
                  </div>
                </div>

                <div className="add-divider">{t("chat.or")}</div>

                <button
                  className="grp-btn"
                  onClick={() => {
                    setAddOpen(false);
                    setGroupStarterOpen(true);
                  }}
                >
                  <span className="grp-ic">
                    <IconUsers width="24" height="24" />
                  </span>
                  <div>
                    <b>{t("chat.newGroupCall")}</b>
                    <span>{t("chat.newGroupCallSub")}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {incoming && callState === "ringing" && (
        <CallToast
          name={incoming.name}
          video={incoming.video}
          onAccept={acceptIncoming}
          onDecline={() => clientRef.current?.declineCall(incoming.callId)}
        />
      )}

      {inCall &&
        (groupActive ? (
          <GroupCallOverlay
            callState={callState}
            localStream={localStream}
            peers={peers}
            selfName={identity.name}
            onHangup={() => clientRef.current?.hangup()}
          />
        ) : (
          <CallOverlay
            callState={callState}
            callName={callName}
            localStream={localStream}
            remoteStream={remoteStream}
            onHangup={() => clientRef.current?.hangup()}
          />
        ))}

      {groupStarterOpen && (
        <GroupCallStarter
          contacts={contacts}
          onStart={beginGroupCall}
          onClose={() => setGroupStarterOpen(false)}
        />
      )}

      {networkOpen && <NetworkPanel onClose={() => setNetworkOpen(false)} />}

      {linkOpen && (
        <div className="net-overlay" onClick={() => setLinkOpen(false)}>
          <div className="net-panel" onClick={(e) => e.stopPropagation()}>
            <div className="net-header">
              <h3>{t("onboarding.kitTitle")}</h3>
              <button className="net-close" aria-label="close" onClick={() => setLinkOpen(false)}>
                ✕
              </button>
            </div>
            <p className="net-intro">{t("onboarding.kitSub")}</p>
            <div className="phrase">
              {identity.mnemonic.split(" ").map((w, i) => (
                <span key={i}>
                  <em>{i + 1}</em>
                  {w}
                </span>
              ))}
            </div>
            <div className="kit-qr">
              <QRCodeSVG value={identity.mnemonic} size={150} />
            </div>
            <p className="warn">{t("onboarding.kitWarn")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

async function loadPreviews(
  t: TFunction,
  contacts: StoredContact[],
): Promise<Record<string, Preview>> {
  const entries = await Promise.all(
    contacts.map(async (c) => {
      const m = await lastMessage(c.pubkey);
      return m ? ([c.pubkey, { text: previewText(t, m), ts: m.ts, mine: m.mine }] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean) as [string, Preview][]);
}
