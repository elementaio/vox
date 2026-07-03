import type { Client } from "../lib/client";
import type { StoredMessage } from "../lib/db";
import { quoteText, time } from "../lib/format";
import { useLocales } from "../locales";
import { MediaView } from "./MediaView";
import { Ticks } from "./Ticks";
import { IconReply, IconEdit, IconTrash } from "./icons";

export function MessageBubble({
  m,
  quoted,
  client,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: {
  m: StoredMessage;
  quoted?: StoredMessage;
  client: Client | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocales();
  return (
    <div className={`msg ${m.mine ? "me" : "them"}`}>
      {m.deleted ? (
        <span className="text tombstone">{t("chat.messageDeleted")}</span>
      ) : (
        <>
          {m.replyTo && <div className="msg-quote">{quoteText(t, quoted)}</div>}
          {m.media && <MediaView media={m.media} client={client} />}
          {m.text && <span className="text">{m.text}</span>}
          <span className="time">
            {m.edited && <span className="edited">{t("chat.edited")}</span>}
            {time(m.ts)}
            {m.mine && <Ticks status={m.status} />}
          </span>
          {m.reactions && Object.keys(m.reactions).length > 0 && (
            <div className="reactions">
              {Object.entries(m.reactions).map(([emoji, users]) => (
                <span key={emoji} className="reaction" onClick={() => onReact(emoji)}>
                  {emoji} {users.length}
                </span>
              ))}
            </div>
          )}
          <div className="msg-actions">
            {["👍", "❤️", "😂"].map((e) => (
              <button key={e} title={t("chat.reactWith", { emoji: e })} onClick={() => onReact(e)}>
                {e}
              </button>
            ))}
            <button title={t("chat.reply")} aria-label={t("chat.reply")} onClick={onReply}>
              <IconReply width="16" height="16" />
            </button>
            {m.mine && (
              <button title={t("chat.edit")} aria-label={t("chat.edit")} onClick={onEdit}>
                <IconEdit width="16" height="16" />
              </button>
            )}
            <button
              title={m.mine ? t("chat.delete") : t("chat.deleteForMe")}
              aria-label={m.mine ? t("chat.delete") : t("chat.deleteForMe")}
              onClick={onDelete}
            >
              <IconTrash width="16" height="16" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
