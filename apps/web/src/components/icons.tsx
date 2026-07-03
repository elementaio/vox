/**
 * One consistent line-icon set (24×24, currentColor, 2px stroke) so the app reads
 * as one considered product instead of a scatter of emoji. Filled marks (send,
 * ticks) are the deliberate exceptions.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const S = (props: P) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  />
);

/** The Vox mark: a five-bar voice waveform. Bars breathe gently unless reduced-motion. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="brandmark" style={{ width: size, height: size }} aria-label="Vox">
      <span className="brandmark-bars">
        <i className="bm b1" />
        <i className="bm b2" />
        <i className="bm b3" />
        <i className="bm b4" />
        <i className="bm b5" />
      </span>
    </span>
  );
}

export const IconSearch = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </S>
);
export const IconPlus = (p: P) => (
  <S strokeWidth="2.2" {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const IconPhone = (p: P) => (
  <S {...p}>
    <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 13 13 0 0 0 4 .7A1.2 1.2 0 0 1 22 16.7V20a1.2 1.2 0 0 1-1.2 1.2A17 17 0 0 1 2.8 4.2 1.2 1.2 0 0 1 4 3h3.4a1.2 1.2 0 0 1 1.2 1.2 13 13 0 0 0 .7 4 1.2 1.2 0 0 1-.3 1.2Z" />
  </S>
);
export const IconVideo = (p: P) => (
  <S {...p}>
    <rect x="2" y="6" width="14" height="12" rx="3" />
    <path d="m16 10 6-3.5v11L16 14" />
  </S>
);
export const IconMore = (p: P) => (
  <S {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </S>
);
export const IconAttach = (p: P) => (
  <S {...p}>
    <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.4-7.4" />
  </S>
);
export const IconMic = (p: P) => (
  <S {...p}>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </S>
);
export const IconStop = (p: P) => (
  <S {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </S>
);
export const IconSend = (p: P) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2z" />
  </svg>
);
export const IconEmoji = (p: P) => (
  <S strokeWidth="1.9" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14a4 4 0 0 0 7 0" />
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
  </S>
);
export const IconSettings = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1.1 2 2 0 0 1 0-4A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.1-1.6 2 2 0 0 1 4 0A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1.1 2 2 0 0 1 0 4 1.7 1.7 0 0 0-1.6 1.1Z" />
  </S>
);
export const IconBack = (p: P) => (
  <S {...p}>
    <path d="M15 5l-7 7 7 7" />
  </S>
);
export const IconClose = (p: P) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </S>
);
export const IconUsers = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 5.2A3.2 3.2 0 0 1 16 11M18 20a6.5 6.5 0 0 0-2.6-5.2" />
  </S>
);
export const IconMoon = (p: P) => (
  <S {...p}>
    <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" />
  </S>
);
export const IconSun = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
  </S>
);
export const IconReply = (p: P) => (
  <S {...p}>
    <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6v1" />
  </S>
);
export const IconEdit = (p: P) => (
  <S {...p}>
    <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M13.5 6.5l3 3" />
  </S>
);
export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </S>
);
export const IconGlobe = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
  </S>
);
export const IconShield = (p: P) => (
  <S {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
  </S>
);
export const IconMicOff = (p: P) => (
  <S {...p}>
    <path d="M9 5a3 3 0 0 1 6 0v5m-1.6 2.4A3 3 0 0 1 9 10V9" />
    <path d="M5 11a7 7 0 0 0 10.5 6M19 11a7 7 0 0 1-1 3.6M12 18v3" />
    <path d="M3 3l18 18" />
  </S>
);
export const IconVideoOff = (p: P) => (
  <S {...p}>
    <path d="M10 6h3a3 3 0 0 1 3 3v1l4-2.5v9l-3-1.9" />
    <path d="M16 16a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3" />
    <path d="M3 3l18 18" />
  </S>
);
export const IconLock = (p: P) => (
  <S {...p}>
    <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </S>
);
export const IconDevice = (p: P) => (
  <S {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </S>
);
export const IconKey = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M11.2 11.2 20 20M17 17l2-2M14.5 14.5l2-2" />
  </S>
);
export const IconServer = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </S>
);
export const IconLogout = (p: P) => (
  <S {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
  </S>
);
export const IconPhoneDown = (p: P) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 8.5c-2.3 0-4.5.4-6.5 1.2v3c0 .5-.3 1-.8 1.1l-2.4.8a1.2 1.2 0 0 1-1.4-.5A11.9 11.9 0 0 1 0 9.3 1.2 1.2 0 0 1 .6 8 20.9 20.9 0 0 1 12 4.8 20.9 20.9 0 0 1 23.4 8a1.2 1.2 0 0 1 .6 1.3 11.9 11.9 0 0 1-.9 5 1.2 1.2 0 0 1-1.4.5l-2.4-.8a1.2 1.2 0 0 1-.8-1.1v-3C16.5 8.9 14.3 8.5 12 8.5Z" />
  </svg>
);
