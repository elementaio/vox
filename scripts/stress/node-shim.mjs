// Make the browser-targeted SDK run headless in Node: install the WebRTC
// globals from @roamhq/wrtc, a synthetic tiny-video getUserMedia, and the few
// other globals the SDK/phoenix touch. Import this BEFORE the SDK.
import wrtc from '@roamhq/wrtc';

const g = globalThis;
g.RTCPeerConnection = wrtc.RTCPeerConnection;
g.RTCSessionDescription = wrtc.RTCSessionDescription;
g.RTCIceCandidate = wrtc.RTCIceCandidate;
g.MediaStream = wrtc.MediaStream;

// A synthetic video track: push a tiny i420 frame at low fps. Enough for the
// fan-out to carry real RTP and for getStats to report framesDecoded — the
// topology is what we measure, not the picture.
const localTracks = new WeakSet();

function fakeVideoTrack(w = 48, h = 36, fps = 5) {
  const source = new wrtc.nonstandard.RTCVideoSource();
  const track = source.createTrack();
  localTracks.add(track);
  const ySize = w * h;
  const uvSize = (w >> 1) * (h >> 1);
  const data = new Uint8Array(ySize + 2 * uvSize);
  let tick = 0;
  const timer = setInterval(() => {
    // wander the luma a little so frames differ (encoder won't drop as dup)
    data.fill((tick += 17) & 0xff, 0, ySize);
    data.fill(128, ySize); // flat chroma
    try { source.onFrame({ width: w, height: h, data }); } catch {}
  }, Math.round(1000 / fps));
  track.addEventListener?.('ended', () => clearInterval(timer));
  track._stopTimer = () => clearInterval(timer);
  return track;
}

function fakeAudioTrack() {
  const source = new wrtc.nonstandard.RTCAudioSource();
  const track = source.createTrack();
  localTracks.add(track);
  const samples = new Int16Array(480); // 10ms @ 48k
  const timer = setInterval(() => {
    try { source.onData({ samples, sampleRate: 48000, bitsPerSample: 16, channelCount: 1, numberOfFrames: 480 }); } catch {}
  }, 10);
  track._stopTimer = () => clearInterval(timer);
  return track;
}

const _addTrack = wrtc.RTCPeerConnection.prototype.addTrack;
wrtc.RTCPeerConnection.prototype.addTrack = function (track, ...streams) {
  if (track && !localTracks.has(track)) {
    try {
      if (track.kind === 'video') {
        const sink = new wrtc.nonstandard.RTCVideoSink(track);
        const src = new wrtc.nonstandard.RTCVideoSource();
        const relay = src.createTrack();
        localTracks.add(relay);
        sink.onframe = ({ frame }) => { try { src.onFrame(frame); } catch {} };
        relay._bridge = sink;
        return _addTrack.call(this, relay, ...streams);
      }
      if (track.kind === 'audio') {
        const sink = new wrtc.nonstandard.RTCAudioSink(track);
        const src = new wrtc.nonstandard.RTCAudioSource();
        const relay = src.createTrack();
        localTracks.add(relay);
        sink.ondata = (d) => { try { src.onData(d); } catch {} };
        relay._bridge = sink;
        return _addTrack.call(this, relay, ...streams);
      }
    } catch { /* fall through to native */ }
  }
  return _addTrack.call(this, track, ...streams);
};

const navigator = g.navigator ?? (g.navigator = {});
navigator.mediaDevices = {
  async getUserMedia({ audio, video } = {}) {
    const tracks = [];
    if (audio) tracks.push(fakeAudioTrack());
    if (video) tracks.push(fakeVideoTrack());
    return new wrtc.MediaStream(tracks);
  },
};

// phoenix/localStorage touchpoints.
if (!g.localStorage) {
  const m = new Map();
  g.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
// Node 22 has global WebSocket + fetch + crypto already.
