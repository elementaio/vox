import { useEffect, useState } from "react";
import type { Client } from "../lib/client";
import type { MediaRef } from "../lib/db";
import { useLocales } from "../locales";

// Session cache of decrypted media → object URLs (avoids re-download per render).
const mediaCache = new Map<string, string>();

export function MediaView({ media, client }: { media: MediaRef; client: Client | null }) {
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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
        <path d="M13 3v6h6" />
      </svg>
      {media.name || "file"}
    </a>
  ) : (
    <div className="media-loading">{t("chat.loadingFile")}</div>
  );
}
