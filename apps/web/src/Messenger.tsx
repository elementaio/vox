import { useEffect, useRef, useState } from "react";
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

  activeRef.current = active;

  // --- one-time setup: load history, connect, handle ?add= ---
  useEffect(() => {
    let client: Client;
    (async () => {
      const stored = await getContacts();
      setContacts(stored);
      setPreviews(await loadPreviews(stored));

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
            [contact]: { text: previewText(msg), ts: msg.ts, mine: msg.mine },
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
            [contact]: { text: msg.deleted ? "🚫 deleted" : msg.text, ts: msg.ts, mine: msg.mine },
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
    const next = prompt("Edit message:", m.text);
    if (next != null && next.trim() && next.trim() !== m.text) {
      void clientRef.current?.editText(active, m.id, next.trim());
    }
  }

  function delMsg(m: StoredMessage) {
    if (!active) return;
    if (m.mine) {
      if (confirm("Delete this message for everyone?")) {
        void clientRef.current?.deleteForEveryone(active, m.id);
      }
    } else if (confirm("Delete this message for you?")) {
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
    const token = prompt("Join token (from your relay's admin):");
    if (!token) return;
    const okd = await enroll(identity, token.trim());
    if (okd) {
      alert("Enrolled — reconnecting…");
      location.reload();
    } else {
      alert("Enrollment failed (invalid or already-used token).");
    }
  }

  function changeServer() {
    const cur = serverLabel();
    const next = prompt(
      "Relay server — e.g. wss://chat.myfamily.com (leave blank to use this site):",
      cur === "this site" ? "" : cur,
    );
    if (next !== null) {
      setServer(next);
      location.reload();
    }
  }

  function signOut() {
    if (
      confirm(
        "Sign out removes this account and its history from this device. You can only restore it with your 12-word phrase. Continue?",
      )
    ) {
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
            + Invite
          </button>
        </div>

        {showInvite && (
          <div className="invite-panel">
            <p>Share this link so someone can add you:</p>
            <div className="invite-row">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button onClick={() => navigator.clipboard.writeText(link)}>Copy</button>
            </div>
            <div className="qr">
              <QRCodeSVG value={link} size={128} bgColor="#171a21" fgColor="#e6e9ef" />
            </div>
          </div>
        )}

        <input
          className="search"
          placeholder="Search messages…"
          value={query}
          onChange={(e) => onSearch(e.target.value)}
        />

        {query && (
          <div className="contact-list">
            {results.length === 0 && <div className="empty-list">No matches.</div>}
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
              No contacts yet.
              <br />
              Tap <b>+ Invite</b> and share your link.
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
                      ? "typing…"
                      : previews[c.pubkey]
                        ? (previews[c.pubkey].mine ? "You: " : "") + previews[c.pubkey].text
                        : "Say hello 👋"}
                  </span>
                  {unread[c.pubkey] > 0 && <span className="badge">{unread[c.pubkey]}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        )}

        <div className="sidebar-footer">
          <button className="link server" onClick={changeServer} title="Change relay server">
            🖧 {serverLabel()}
          </button>
          <button className="link" onClick={joinNetwork} title="Redeem a join token">
            Join private network…
          </button>
          <button className="link signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <section className="conversation">
        {!activeContact ? (
          <div className="no-convo">
            <div>
              <h2>🔒 {identity.name}</h2>
              <p>Select a contact, or share your invite link to start a chat.</p>
              <p className="muted">
                Messages are end-to-end encrypted and stored only on your devices.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="convo-header">
              <div className="avatar">{activeContact.name.slice(0, 1).toUpperCase()}</div>
              <div>
                <div className="convo-name">{activeContact.name}</div>
                <div className="convo-sub">{presenceText(presence[activeContact.pubkey])}</div>
              </div>
              <div className="call-buttons">
                <button
                  title="Voice call"
                  onClick={() => clientRef.current?.startCall(activeContact.pubkey, false)}
                >
                  📞
                </button>
                <button
                  title="Video call"
                  onClick={() => clientRef.current?.startCall(activeContact.pubkey, true)}
                >
                  🎥
                </button>
              </div>
            </header>

            <div className="messages">
              {messages.length === 0 && (
                <div className="empty">
                  No messages yet with {activeContact.name}.
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.mine ? "me" : "them"}`}>
                  {m.deleted ? (
                    <span className="text tombstone">🚫 This message was deleted</span>
                  ) : (
                    <>
                      {m.replyTo && (
                        <div className="msg-quote">
                          {quoteText(messages.find((x) => x.id === m.replyTo))}
                        </div>
                      )}
                      {m.media && <MediaView media={m.media} client={clientRef.current} />}
                      {m.text && <span className="text">{m.text}</span>}
                      <span className="time">
                        {m.edited && <span className="edited">edited</span>}
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
                          <button key={e} title={`React ${e}`} onClick={() => react(m, e)}>
                            {e}
                          </button>
                        ))}
                        <button title="Reply" onClick={() => setReplyingTo(m)}>
                          ↩
                        </button>
                        {m.mine && (
                          <button title="Edit" onClick={() => editMsg(m)}>
                            ✎
                          </button>
                        )}
                        <button
                          title={m.mine ? "Delete" : "Delete for me"}
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
                    Replying to {replyingTo.mine ? "yourself" : activeContact.name}
                  </span>
                  <span className="reply-text">
                    {replyingTo.deleted ? "deleted message" : replyingTo.text}
                  </span>
                </div>
                <button onClick={() => setReplyingTo(null)}>×</button>
              </div>
            )}

            <div className="typing-line">
              {typing[activeContact.pubkey] ? `${activeContact.name} is typing…` : ""}
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
                title="Attach image"
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              <button
                type="button"
                className={`mic ${recording ? "recording" : ""}`}
                title={recording ? "Stop & send" : "Record voice note"}
                onClick={() => (recording ? stopRecording() : startRecording())}
              >
                {recording ? "⏹" : "🎤"}
              </button>
              <input
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                placeholder={recording ? "● recording… tap ⏹ to send" : "Type a message…"}
                disabled={recording}
                autoFocus
              />
              <button type="submit" disabled={!draft.trim()}>
                Send
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
            Incoming {incoming.video ? "video" : "voice"} call…
          </div>
          <div className="call-toast-actions">
            <button className="decline" onClick={() => clientRef.current?.declineCall(incoming.callId)}>
              Decline
            </button>
            <button className="accept" onClick={() => clientRef.current?.acceptCall(incoming.callId)}>
              Accept
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
                {callState === "calling" ? `Calling ${callName}…` : `Connecting…`}
              </div>
            )}
            {localStream && <CallVideo stream={localStream} className="local" muted />}
          </div>
          <button className="hangup" onClick={() => clientRef.current?.hangup()}>
            ✕ End call
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

async function loadPreviews(contacts: StoredContact[]): Promise<Record<string, Preview>> {
  const entries = await Promise.all(
    contacts.map(async (c) => {
      const m = await lastMessage(c.pubkey);
      return m ? ([c.pubkey, { text: m.text, ts: m.ts, mine: m.mine }] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter(Boolean) as [string, Preview][]);
}

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function quoteText(q?: StoredMessage): string {
  if (!q) return "message";
  if (q.deleted) return "deleted message";
  return q.media ? mediaLabel(q.media.mkind, q.media.name) : q.text;
}

function mediaLabel(mk: MediaRef["mkind"], name?: string): string {
  if (mk === "image") return "📷 Photo";
  if (mk === "audio") return "🎤 Voice";
  return `📎 ${name || "File"}`;
}

function previewText(m: StoredMessage): string {
  if (m.deleted) return "🚫 deleted";
  if (m.media) return mediaLabel(m.media.mkind, m.media.name);
  return m.text;
}

// Session cache of decrypted media → object URLs (avoids re-download per render).
const mediaCache = new Map<string, string>();

function MediaView({ media, client }: { media: MediaRef; client: Client | null }) {
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
      <div className="media-loading">📷 loading…</div>
    );
  }
  if (media.mkind === "audio") {
    return url ? (
      <audio className="media-audio" controls src={url} />
    ) : (
      <div className="media-loading">🎤 loading…</div>
    );
  }
  // generic file → download link
  return url ? (
    <a className="media-file" href={url} download={media.name || "file"}>
      📄 {media.name || "file"}
    </a>
  ) : (
    <div className="media-loading">📎 loading…</div>
  );
}

function presenceText(info?: PresenceInfo): string {
  if (!info) return "";
  if (info.online) return "online";
  if (!info.lastSeen) return "offline";
  return `last seen ${timeAgo(info.lastSeen)}`;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}
