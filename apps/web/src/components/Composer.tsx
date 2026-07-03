import { useRef } from "react";
import { useLocales } from "../locales";
import { IconAttach, IconMic, IconStop, IconSend } from "./icons";

export function Composer({
  draft,
  recording,
  onDraftChange,
  onSubmit,
  onToggleRecording,
  onFilePicked,
}: {
  draft: string;
  recording: boolean;
  onDraftChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onToggleRecording: () => void;
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useLocales();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasText = draft.trim().length > 0;
  return (
    <form className="composer" onSubmit={onSubmit}>
      <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={onFilePicked} />
      <button
        type="button"
        className="attach"
        title={t("chat.attachImage")}
        aria-label={t("chat.attachImage")}
        onClick={() => fileInputRef.current?.click()}
      >
        <IconAttach />
      </button>
      <div className="composer-input">
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={recording ? t("chat.recordingHint") : t("chat.typeMessage")}
          disabled={recording}
          autoFocus
        />
      </div>
      {hasText ? (
        <button type="submit" className="send" title={t("chat.send")} aria-label={t("chat.send")}>
          <IconSend />
        </button>
      ) : (
        <button
          type="button"
          className={`mic ${recording ? "recording" : ""}`}
          title={recording ? t("chat.stopSend") : t("chat.recordVoice")}
          aria-label={recording ? t("chat.stopSend") : t("chat.recordVoice")}
          onClick={onToggleRecording}
        >
          {recording ? <IconStop /> : <IconMic />}
        </button>
      )}
    </form>
  );
}
