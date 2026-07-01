import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { QRCodeSVG } from "qrcode.react";
import { Client, type CallState, type PresenceInfo } from "./lib/client";
import {
  clearAll,
  getContacts,
  getMessages,
  lastMessage,
  searchMessages,
  type MediaRef,
  type MessageStatus,
  type StoredContact,
  type StoredMessage,
} from "./lib/db";
import { clearIdentity, type Identity } from "./lib/identity";
import { inviteLink, parseInvite } from "./lib/invite";
import { serverLabel, setServer, socketUrl } from "./lib/server";
import { enroll } from "./lib/enroll";
import { useLocales } from "./locales";

interface Preview {
  text: string;
  ts: number;
  mine: boolean;
}

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
  const [showInvite, setShowInvite] = useState(false);
  const [callState, setCallState] = useState<CallState>("ended");
  const [incoming, setIncoming] = useState<{
    contact: string;
    name: string;
    callId: string;
    video: boolean;
  } | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const clientRef = useRef<Client | null>(null);
  const activeRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimers = useRef<Map<string, number>>(new Map());
  const iTypeTimer = useRef<number | undefined>(undefined);
  const iTyping = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );
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
        onIncomingCall: (contact, name, callId, video) =>
          setIncoming({ contact, name, callId, video }),
        onCallState: (state) => {
          setCallState(state);
          if (state === "ended") {
            setIncoming(null);
            setLocalStream(null);
            setRemoteStream(null);
          } else if (state !== "ringing") {
            setIncoming(null);
          }
        },
        onLocalStream: setLocalStream,
        onRemoteStream: setRemoteStream,
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
        stream.getTracks().forEach((t) => t.stop());
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
    if (confirm(t("prompts.signOutConfirm"))) {
      clearIdentity();
      void clearAll();
      onSignOut();
    }
  }

  const activeContact = contacts.find((c) => c.pubkey === active);
  const link = inviteLink(identity);
  const inCall = callState === "calling" || callState === "connecting" || callState === "connected";
  const callName = incoming?.name ?? contacts.find((c) => c.pubkey === active)?.name ?? "";

  return (
    <div className="messenger">
      <aside className="sidebar">
        <div className="me">
          <div>
            <div className="me-name">{identity.name}</div>
            <div className={`me-status ${status === "connected" ? "on" : ""}`}>
              {status}
            </div>
          </div>
          <button className="link" onClick={() => setShowInvite((s) => !s)}>
            {t("chat.invite")}
          </button>
        </div>

        {showInvite && (
          <div className="invite-panel">
            <p>{t("chat.shareLink")}</p>
            <div className="invite-row">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button onClick={() => navigator.clipboard.writeText(link)}>{t("chat.copy")}</button>
            </div>
            <div className="qr">
              <QRCodeSVG value={link} size={128} bgColor="#171a21" fgColor="#e6e9ef" />
            </div>
          </div>
        )}

        <input
          className="search"
          placeholder={t("chat.searchMessages")}
          value={query}
          onChange={(e) => onSearch(e.target.value)}
        />

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
            <button
              key={c.pubkey}
              className={`contact ${active === c.pubkey ? "active" : ""}`}
              onClick={() => openConversation(c.pubkey)}
            >
              <div className="avatar-wrap">
                <div className="avatar">{c.name.slice(0, 1).toUpperCase()}</div>
                {presence[c.pubkey]?.online && <span className="presence-dot" />}
              </div>
              <div className="contact-main">
                <div className="contact-top">
                  <span className="contact-name">{c.name}</span>
                  {previews[c.pubkey] && (
                    <span className="contact-time">{time(previews[c.pubkey].ts)}</span>
                  )}
                </div>
                <div className="contact-sub">
                  <span className="preview">
                    {typing[c.pubkey]
                      ? t("chat.typing")
                      : previews[c.pubkey]
                        ? (previews[c.pubkey].mine ? t("chat.youPrefix") : "") + previews[c.pubkey].text
                        : t("chat.sayHello")}
                  </span>
                  {unread[c.pubkey] > 0 && <span className="badge">{unread[c.pubkey]}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        )}

        <div className="sidebar-footer">
          <button className="link server" onClick={changeServer} title={t("chat.changeRelay")}>
            🖧 {serverLabel()}
          </button>
          <button className="link" onClick={joinNetwork} title={t("chat.redeemToken")}>
            {t("chat.joinPrivate")}
          </button>
          <button className="link lang" onClick={toggle}>
            {t("settings.toggleLanguage")}
          </button>
          <button className="link signout" onClick={signOut}>
            {t("chat.signOut")}
          </button>
        </div>
      </aside>

      <section className="conversation">
        {!activeContact ? (
          <div className="no-convo">
            <div>
              <h2>🔒 {identity.name}</h2>
              <p>{t("chat.selectContact")}</p>
              <p className="muted">{t("chat.e2eNote")}</p>
            </div>
          </div>
        ) : (
          <>
            <header className="convo-header">
              <div className="avatar">{activeContact.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <div className="convo-name">{activeContact.name}</div>
                <div className="convo-sub">{presenceText(t, presence[activeContact.pubkey])}</div>
              </div>
              <div className="call-buttons">
                <button
                  title={t("chat.voiceCall")}
                  onClick={() => clientRef.current?.startCall(activeContact.pubkey, false)}
                >
                  📞
                </button>
                <button
                  title={t("chat.videoCall")}
                  onClick={() => clientRef.current?.startCall(activeContact.pubkey, true)}
                >
                  🎥
                </button>
              </div>
            </header>

            <div className="messages">
              {messages.length === 0 && (
                <div className="empty">{t("chat.noMessagesYet", { name: activeContact.name })}</div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.mine ? "me" : "them"}`}>
                  {m.deleted ? (
                    <span className="text tombstone">{t("chat.messageDeleted")}</span>
                  ) : (
                    <>
                      {m.replyTo && (
                        <div className="msg-quote">
                          {quoteText(t, messages.find((x) => x.id === m.replyTo))}
                        </div>
                      )}
                      {m.media && <MediaView media={m.media} client={clientRef.current} />}
                      {m.text && <span className="text">{m.text}</span>}
                      <span className="time">
                        {m.edited && <span className="edited">{t("chat.edited")}</span>}
                        {time(m.ts)}
                        {m.mine && <Ticks status={m.status} />}
                      </span>
                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div className="reactions">
                          {Object.entries(m.reactions).map(([emoji, users]) => (
                            <span key={emoji} className="reaction" onClick={() => react(m, emoji)}>
                              {emoji} {users.length}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="msg-actions">
                        {["👍", "❤️", "😂"].map((e) => (
                          <button key={e} title={t("chat.reactWith", { emoji: e })} onClick={() => react(m, e)}>
                            {e}
                          </button>
                        ))}
                        <button title={t("chat.reply")} onClick={() => setReplyingTo(m)}>
                          ↩
                        </button>
                        {m.mine && (
                          <button title={t("chat.edit")} onClick={() => editMsg(m)}>
                            ✎
                          </button>
                        )}
                        <button
                          title={m.mine ? t("chat.delete") : t("chat.deleteForMe")}
                          onClick={() => delMsg(m)}
                        >
                          🗑
                        </button>
                      </div>
                    </>
                  )}
                </div>
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

            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={onFilePicked}
            />
            <form className="composer" onSubmit={send}>
              <button
                type="button"
                className="attach"
                title={t("chat.attachImage")}
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              <button
                type="button"
                className={`mic ${recording ? "recording" : ""}`}
                title={recording ? t("chat.stopSend") : t("chat.recordVoice")}
                onClick={() => (recording ? stopRecording() : startRecording())}
              >
                {recording ? "⏹" : "🎤"}
              </button>
              <input
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                placeholder={recording ? t("chat.recordingHint") : t("chat.typeMessage")}
                disabled={recording}
                autoFocus
              />
              <button type="submit" disabled={!draft.trim()}>
                {t("chat.send")}
              </button>
            </form>
          </>
        )}
      </section>

      {incoming && callState === "ringing" && (
        <div className="call-toast">
          <div className="avatar big">{incoming.name.slice(0, 1).toUpperCase()}</div>
          <div className="call-toast-name">{incoming.name}</div>
          <div className="call-toast-sub">
            {t("chat.incomingCall", { kind: incoming.video ? t("chat.video") : t("chat.voice") })}
          </div>
          <div className="call-toast-actions">
            <button className="decline" onClick={() => clientRef.current?.declineCall(incoming.callId)}>
              {t("chat.decline")}
            </button>
            <button className="accept" onClick={() => clientRef.current?.acceptCall(incoming.callId)}>
              {t("chat.accept")}
            </button>
          </div>
        </div>
      )}

      {inCall && (
        <div className="call-overlay">
          <div className="call-stage">
            {remoteStream ? (
              <CallVideo stream={remoteStream} className="remote" />
            ) : (
              <div className="call-waiting">
                {callState === "calling" ? t("chat.calling", { name: callName }) : t("chat.connecting")}
              </div>
            )}
            {localStream && <CallVideo stream={localStream} className="local" muted />}
          </div>
          <button className="hangup" onClick={() => clientRef.current?.hangup()}>
            {t("chat.endCall")}
          </button>
        </div>
      )}
    </div>
  );
}

function CallVideo({
  stream,
  className,
  muted,
}: {
  stream: MediaStream;
  className: string;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={`call-video ${className}`} autoPlay playsInline muted={muted} />;
}

function Ticks({ status }: { status?: MessageStatus }) {
  if (status === "read") return <span className="tick read">✓✓</span>;
  if (status === "delivered") return <span className="tick">✓✓</span>;
  return <span className="tick">✓</span>;
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

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function quoteText(t: TFunction, q?: StoredMessage): string {
  if (!q) return t("chat.quoteMessage");
  if (q.deleted) return t("chat.deletedMessage");
  return q.media ? mediaLabel(t, q.media.mkind, q.media.name) : q.text;
}

function mediaLabel(t: TFunction, mk: MediaRef["mkind"], name?: string): string {
  if (mk === "image") return t("chat.photo");
  if (mk === "audio") return t("chat.voiceLabel");
  return t("chat.fileLabel", { name: name || t("chat.file") });
}

function previewText(t: TFunction, m: StoredMessage): string {
  if (m.deleted) return t("chat.deletedShort");
  if (m.media) return mediaLabel(t, m.media.mkind, m.media.name);
  return m.text;
}

// Session cache of decrypted media → object URLs (avoids re-download per render).
const mediaCache = new Map<string, string>();

function MediaView({ media, client }: { media: MediaRef; client: Client | null }) {
  const { t } = useLocales();
  const [url, setUrl] = useState<string | null>(mediaCache.get(media.blobId) ?? null);
  useEffect(() => {
    if (url || !client) return;
    let cancelled = false;
    client
      .fetchMedia(media)
      .then((bytes) => {
        if (cancelled) return;
        const objUrl = URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type: media.mime }),
        );
        mediaCache.set(media.blobId, objUrl);
        setUrl(objUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.blobId]);

  if (media.mkind === "image") {
    return url ? (
      <img className="media-img" src={url} alt="" />
    ) : (
      <div className="media-loading">{t("chat.loadingImg")}</div>
    );
  }
  if (media.mkind === "audio") {
    return url ? (
      <audio className="media-audio" controls src={url} />
    ) : (
      <div className="media-loading">{t("chat.loadingAudio")}</div>
    );
  }
  // generic file → download link
  return url ? (
    <a className="media-file" href={url} download={media.name || "file"}>
      📄 {media.name || "file"}
    </a>
  ) : (
    <div className="media-loading">{t("chat.loadingFile")}</div>
  );
}

function presenceText(t: TFunction, info?: PresenceInfo): string {
  if (!info) return "";
  if (info.online) return t("chat.online");
  if (!info.lastSeen) return t("chat.offline");
  return t("chat.lastSeen", { ago: timeAgo(t, info.lastSeen) });
}

function timeAgo(t: TFunction, ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return t("chat.justNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("chat.minutesAgo", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("chat.hoursAgo", { h });
  return new Date(ts).toLocaleDateString();
}
