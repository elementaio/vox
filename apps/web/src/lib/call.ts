import { useEffect, useState } from "react";

/** mm:ss elapsed, counting from when `active` (the call connects) turns true. */
export function useElapsed(active: boolean): string {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) {
      setS(0);
      return;
    }
    const id = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

/** Local mic/camera toggles — flips track.enabled (peer keeps the track, gets silence/black). */
export function useTrackControls(stream: MediaStream | null) {
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  useEffect(() => {
    if (!stream) return;
    setMicOn(stream.getAudioTracks().some((t) => t.enabled));
    setCamOn(stream.getVideoTracks().some((t) => t.enabled));
  }, [stream]);
  return {
    micOn,
    camOn,
    hasVideo: !!stream && stream.getVideoTracks().length > 0,
    hasAudio: !!stream && stream.getAudioTracks().length > 0,
    toggleMic() {
      if (!stream) return;
      const on = !micOn;
      stream.getAudioTracks().forEach((t) => (t.enabled = on));
      setMicOn(on);
    },
    toggleCam() {
      if (!stream) return;
      const on = !camOn;
      stream.getVideoTracks().forEach((t) => (t.enabled = on));
      setCamOn(on);
    },
  };
}
export type TrackControls = ReturnType<typeof useTrackControls>;

/** True while `stream` has a live, enabled, unmuted video track → show video, else an avatar. */
export function useHasVideo(stream: MediaStream | null): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!stream) {
      setHas(false);
      return;
    }
    const check = () => {
      const v = stream.getVideoTracks();
      setHas(v.length > 0 && v.some((t) => t.enabled && !t.muted && t.readyState === "live"));
    };
    check();
    const tracks = stream.getVideoTracks();
    for (const t of tracks) {
      t.onmute = check;
      t.onunmute = check;
      t.onended = check;
    }
    // enabled flips fire no event, so poll lightly to catch camera on/off.
    const id = setInterval(check, 1000);
    return () => {
      clearInterval(id);
      for (const t of tracks) {
        t.onmute = t.onunmute = t.onended = null;
      }
    };
  }, [stream]);
  return has;
}

export function initial(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}
