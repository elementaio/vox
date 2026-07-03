import { useState } from "react";
import type { CallState } from "../lib/client";
import type { StoredContact } from "../lib/db";
import { useLocales } from "../locales";
import { IconPhone, IconVideo, IconClose } from "./icons";
import { CallVideo, CallControls, CallTopbar } from "./callkit";
import { useTrackControls, useElapsed, useHasVideo, initial } from "../lib/call";

/** One participant cell: their video, or an avatar when their camera is off / voice-only. */
function Tile({ stream, muted, name, you }: { stream: MediaStream; muted?: boolean; name: string; you?: boolean }) {
  const { t } = useLocales();
  const hasVideo = useHasVideo(stream);
  return (
    <div className="gc-tile">
      {hasVideo ? (
        <CallVideo stream={stream} className={`gc-tile-video ${you ? "mirror" : ""}`} muted={muted} />
      ) : (
        <div className="gc-tile-avatar">
          <div className="avatar med">{initial(name)}</div>
        </div>
      )}
      <span className="gc-tile-name">{you ? `${name} (${t("call.you")})` : name}</span>
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
  const ctl = useTrackControls(localStream);
  const entries = Object.entries(peers);
  const count = entries.length + 1;
  const connected = entries.length > 0;
  const elapsed = useElapsed(connected);

  return (
    <div className="call-overlay">
      <CallTopbar
        title={t("call.participants", { n: count })}
        status={connected ? elapsed : t("chat.groupCalling")}
      />

      <div className={`gc-grid count-${Math.min(count, 6)}`}>
        {localStream && <Tile stream={localStream} muted name={selfName} you />}
        {entries.map(([pk, p]) => (
          <Tile key={pk} stream={p.stream} name={p.name} />
        ))}
      </div>

      {entries.length === 0 && (
        <div className="call-waiting">
          {callState === "calling" ? t("chat.groupCalling") : t("call.waiting")}
        </div>
      )}

      <CallControls ctl={ctl} onHangup={onHangup} />
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
              <span className="gc-avatar">{initial(c.name)}</span>
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
