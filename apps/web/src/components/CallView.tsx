import { useEffect, useRef } from "react";
import type { CallState } from "../lib/client";
import { useLocales } from "../locales";
import { IconPhone, IconVideo, IconPhoneDown } from "./icons";

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

/** Incoming-call toast with accept/decline. */
export function CallToast({
  name,
  video,
  onAccept,
  onDecline,
}: {
  name: string;
  video: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useLocales();
  return (
    <div className="call-toast">
      <div className="call-toast-top">
        <div className="avatar">{name.slice(0, 1).toUpperCase()}</div>
        <div>
          <div className="call-toast-name">{name}</div>
          <div className="call-toast-sub">
            {t("chat.incomingCall", { kind: video ? t("chat.video") : t("chat.voice") })}
          </div>
        </div>
      </div>
      <div className="call-toast-actions">
        <button className="decline" onClick={onDecline}>
          <IconPhoneDown width="17" height="17" />
          {t("chat.decline")}
        </button>
        <button className="accept" onClick={onAccept}>
          {video ? <IconVideo width="17" height="17" /> : <IconPhone width="17" height="17" />}
          {t("chat.accept")}
        </button>
      </div>
    </div>
  );
}

/** Full-screen active-call overlay (remote + local video, hang up). */
export function CallOverlay({
  callState,
  callName,
  localStream,
  remoteStream,
  onHangup,
}: {
  callState: CallState;
  callName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onHangup: () => void;
}) {
  const { t } = useLocales();
  return (
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
      <button className="hangup" onClick={onHangup} title={t("chat.endCall")} aria-label={t("chat.endCall")}>
        <IconPhoneDown />
      </button>
    </div>
  );
}
