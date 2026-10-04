// Dev-only audio mute (Victor, Oct 3): agents test voice output while Victor is using the Mac, so in `vite dev`
// nothing plays out loud unless sound is switched on. Synthesis still runs and returns real audio buffers, so tests
// that inspect samples are unaffected; only playback to the speakers is silenced. Production builds are untouched.
// Turn sound on with ?sound=on in the URL, or localStorage.setItem("lokol.sound", "on").
function soundOn(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("sound");
    if (q === "on") localStorage.setItem("lokol.sound", "on");
    if (q === "off") localStorage.removeItem("lokol.sound");
    return localStorage.getItem("lokol.sound") === "on";
  } catch {
    return false;
  }
}

/** True only in `vite dev` with sound not switched on. Always false in a production build. */
export function devSoundMuted(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined" && !soundOn();
}

if (import.meta.env.DEV && typeof window !== "undefined" && !soundOn()) {
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    this.muted = true;
    this.volume = 0;
    return origPlay.call(this);
  };

  const proto = AudioNode.prototype as unknown as { connect: (...args: unknown[]) => unknown };
  const origConnect = proto.connect;
  proto.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
    const ctx = this.context as BaseAudioContext & { __lokolMute?: GainNode };
    const offline = typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext;
    if (!offline && dest instanceof AudioDestinationNode) {
      if (!ctx.__lokolMute) {
        const g = ctx.createGain();
        g.gain.value = 0;
        origConnect.call(g, ctx.destination);
        ctx.__lokolMute = g;
      }
      return origConnect.call(this, ctx.__lokolMute, ...rest);
    }
    return origConnect.call(this, dest, ...rest);
  };

  // eslint-disable-next-line no-console
  console.info("[lokol] dev build: audio output muted. Add ?sound=on to the URL to hear voice output.");
}

