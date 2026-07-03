import type { MessageStatus } from "../lib/db";

/** Delivery ticks: one check = sent, double check = delivered, blue double = read. */
export function Ticks({ status }: { status?: MessageStatus }) {
  if (status === "delivered" || status === "read") {
    return (
      <span className={`tick ${status === "read" ? "read" : ""}`}>
        <svg width="18" height="13" viewBox="0 0 20 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 7l4 4 8-9" />
          <path d="M8 10l1 1 8-9" />
        </svg>
      </span>
    );
  }
  return (
    <span className="tick">
      <svg width="13" height="13" viewBox="0 0 14 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 7l4 4 8-9" />
      </svg>
    </span>
  );
}
