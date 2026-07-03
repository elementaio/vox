import { useEffect, useRef } from "react";
import { useLocales } from "../locales";
import { IconMic, IconMicOff, IconVideo, IconVideoOff, IconPhoneDown } from "./icons";
import type { TrackControls } from "../lib/call";

/** Binds a MediaStream to a <video>. */
export function CallVideo({
  stream,
  className,
  muted,
}: {
  stream: MediaStream;
  className?: string;
  muted?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

/** Floating in-call control bar: mute, camera, hang up. */
export function CallControls({ ctl, onHangup }: { ctl: TrackControls; onHangup: () => void }) {
  const { t } = useLocales();
  return (
    <div className="call-controls">
      {ctl.hasAudio && (
        <button
          className={`cc-btn ${ctl.micOn ? "" : "off"}`}
          onClick={ctl.toggleMic}
          title={ctl.micOn ? t("call.mute") : t("call.unmute")}
          aria-label={ctl.micOn ? t("call.mute") : t("call.unmute")}
        >
          {ctl.micOn ? <IconMic /> : <IconMicOff />}
        </button>
      )}
      {ctl.hasVideo && (
        <button
          className={`cc-btn ${ctl.camOn ? "" : "off"}`}
          onClick={ctl.toggleCam}
          title={ctl.camOn ? t("call.cameraOff") : t("call.cameraOn")}
          aria-label={ctl.camOn ? t("call.cameraOff") : t("call.cameraOn")}
        >
          {ctl.camOn ? <IconVideo /> : <IconVideoOff />}
        </button>
      )}
      <button
        className="cc-btn hangup"
        onClick={onHangup}
        title={t("chat.endCall")}
        aria-label={t("chat.endCall")}
      >
        <IconPhoneDown />
      </button>
    </div>
  );
}

/** Shared top overlay: who/what + elapsed, and the always-on encryption badge. */
export function CallTopbar({ title, status }: { title: string; status: string }) {
  const { t } = useLocales();
  return (
    <div className="call-topbar">
      <div className="call-head">
        <div className="call-title">{title}</div>
        <div className="call-status">{status}</div>
      </div>
      <div className="call-e2e">
        <IconLockMark />
        {t("call.encrypted")}
      </div>
    </div>
  );
}

function IconLockMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
