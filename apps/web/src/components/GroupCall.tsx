import { useEffect, useRef, useState } from "react";
import type { CallState } from "../lib/client";
import type { StoredContact } from "../lib/db";
import { useLocales } from "../locales";
import { IconPhone, IconVideo, IconPhoneDown, IconClose } from "./icons";

function Tile({ stream, muted, name }: { stream: MediaStream; muted?: boolean; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="gc-tile">
      <video ref={ref} className="gc-tile-video" autoPlay playsInline muted={muted} />
      <span className="gc-tile-name">{name}</span>
    </div>
  );
}

/** Active group call: a grid of participant tiles (mesh — one stream per peer). */
export function GroupCallOverlay({
  callState,
  localStream,
  peers,
  selfName,
  onHangup,
}: {
  callState: CallState;
  localStream: MediaStream | null;
  peers: Record<string, { name: string; stream: MediaStream }>;
  selfName: string;
  onHangup: () => void;
}) {
  const { t } = useLocales();
  const entries = Object.entries(peers);
  return (
    <div className="call-overlay">
      <div className={`gc-grid count-${Math.min(entries.length + 1, 6)}`}>
        {localStream && <Tile stream={localStream} muted name={`${selfName} (${t("chat.youLabel")})`} />}
        {entries.map(([pk, p]) => (
          <Tile key={pk} stream={p.stream} name={p.name} />
        ))}
      </div>
      {entries.length === 0 && (
        <div className="call-waiting">
          {callState === "calling" ? t("chat.groupCalling") : t("chat.connecting")}
        </div>
      )}
      <button className="hangup" onClick={onHangup} title={t("chat.endCall")} aria-label={t("chat.endCall")}>
        <IconPhoneDown />
      </button>
    </div>
  );
}

/** Pick participants and start a group call. */
export function GroupCallStarter({
  contacts,
  onStart,
  onClose,
}: {
  contacts: StoredContact[];
  onStart: (pubkeys: string[], video: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useLocales();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (pk: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(pk)) n.delete(pk);
      else n.add(pk);
      return n;
    });

  return (
    <div className="net-overlay" onClick={onClose}>
      <div className="net-panel" onClick={(e) => e.stopPropagation()}>
        <div className="net-header">
          <h3>{t("chat.newGroupCall")}</h3>
          <button className="net-close" aria-label="close" onClick={onClose}>
            <IconClose width="18" height="18" />
          </button>
        </div>
        <p className="net-intro">{t("chat.pickParticipants")}</p>
        <div className="gc-list">
          {contacts.length === 0 && <div className="gc-empty">{t("chat.noContactsYet")}</div>}
          {contacts.map((c) => (
            <label className="gc-row" key={c.pubkey}>
              <input type="checkbox" checked={selected.has(c.pubkey)} onChange={() => toggle(c.pubkey)} />
              <span className="gc-avatar">{c.name.slice(0, 1).toUpperCase()}</span>
              <span className="gc-name">{c.name}</span>
            </label>
          ))}
        </div>
        <div className="gc-actions">
          <button className="gc-start voice" disabled={selected.size === 0} onClick={() => onStart([...selected], false)}>
            <IconPhone width="17" height="17" />
            {t("chat.voiceCall")}
          </button>
          <button className="gc-start video" disabled={selected.size === 0} onClick={() => onStart([...selected], true)}>
            <IconVideo width="17" height="17" />
            {t("chat.videoCall")}
          </button>
        </div>
      </div>
    </div>
  );
}
