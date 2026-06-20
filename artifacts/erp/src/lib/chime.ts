const CHIME_MUTED_KEY_PREFIX = "midanic.erp.newOrderChimeMuted";

/**
 * Per-user localStorage key. Scoping by user id ensures one user's mute
 * preference does not leak to another user signing into the same browser
 * profile. Falls back to a shared key only when no user id is known
 * (e.g., before /auth/me has resolved).
 */
function chimeMutedKey(userId: number | string | null | undefined): string {
  if (userId === null || userId === undefined || userId === "") {
    return CHIME_MUTED_KEY_PREFIX;
  }
  return `${CHIME_MUTED_KEY_PREFIX}:${userId}`;
}

export function isChimeMuted(userId: number | string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(chimeMutedKey(userId)) === "1";
}

export function setChimeMuted(userId: number | string | null | undefined, muted: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(chimeMutedKey(userId), muted ? "1" : "0");
}

type AudioCtxCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioCtxCtor | undefined =
    window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/**
 * Play a short two-tone chime using the Web Audio API. No asset required.
 * Safely no-ops on browsers without Web Audio or before any user gesture
 * has unlocked the audio context.
 */
export function playNewOrderChime(userId: number | string | null | undefined): void {
  if (isChimeMuted(userId)) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    if (ac.state === "suspended") {
      void ac.resume().catch(() => { /* noop */ });
    }
    const now = ac.currentTime;
    const tones: Array<{ freq: number; start: number; dur: number }> = [
      { freq: 880, start: 0, dur: 0.15 },
      { freq: 1320, start: 0.16, dur: 0.22 },
    ];
    for (const t of tones) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      const t0 = now + t.start;
      const t1 = t0 + t.dur;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
  } catch {
    /* noop */
  }
}
