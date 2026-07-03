import type { CallState } from "../lib/client";
import { useLocales } from "../locales";
import { IconPhone, IconVideo, IconPhoneDown } from "./icons";
import { CallVideo, CallControls, CallTopbar } from "./callkit";
import { useTrackControls, useElapsed, useHasVideo, initial } from "../lib/call";

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
        <div className="avatar">{initial(name)}</div>
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

/** Full-screen active 1:1 call: remote video (or avatar for voice), self-view, controls. */
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
  const ctl = useTrackControls(localStream);
  const connected = callState === "connected";
  const elapsed = useElapsed(connected);
  const remoteVideo = useHasVideo(remoteStream);
  const status = connected ? elapsed : callState === "calling" ? t("call.ringing") : t("chat.connecting");

  return (
    <div className="call-overlay">
      <CallTopbar title={callName} status={status} />

      <div className="call-stage">
        {remoteStream && remoteVideo ? (
          <CallVideo stream={remoteStream} className="call-video remote" />
        ) : (
          <div className={`call-avatar-stage ${connected ? "" : "ringing"}`}>
            <div className="avatar callbig">{initial(callName)}</div>
            <div className="call-bigname">{callName}</div>
            {!connected && <div className="call-substate">{status}</div>}
          </div>
        )}

        {localStream && ctl.hasVideo && ctl.camOn && (
          <div className="call-self">
            <CallVideo stream={localStream} className="call-video self" muted />
            <span className="call-self-label">{t("call.you")}</span>
          </div>
        )}
      </div>

      <CallControls ctl={ctl} onHangup={onHangup} />
    </div>
  );
}
