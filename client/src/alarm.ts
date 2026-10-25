// Alarm sound + system notification for timers.
// Browsers only allow audio after a user gesture, so call unlockAudio() from a click handler.

let ctx: AudioContext | null = null;
let chimeTimer: ReturnType<typeof setInterval> | undefined;
const ringing = new Set<string>();

export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

/** Rising C–E–G chime; each note a sine with a soft octave overtone, fading in and ringing out like a bell. */
const CHIME_NOTES = [523.25, 659.25, 783.99];
const NOTE_GAP = 0.18;
const RING = 1.4;
const REPEAT_MS = 2500;

/** Schedules one chime on any audio context (also an OfflineAudioContext, e.g. to render it to a file). */
export function scheduleChime(audio: BaseAudioContext, at: number) {
  CHIME_NOTES.forEach((freq, i) => {
    const start = at + i * NOTE_GAP;
    for (const [mult, level] of [[1, 0.18], [2, 0.04]]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      // Ramps instead of hard on/off steps, which click.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + RING);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + RING + 0.05);
    }
  });
}

function chime() {
  if (!ctx || ctx.state !== 'running') return;
  scheduleChime(ctx, ctx.currentTime + 0.01);
  navigator.vibrate?.([200, 100, 200, 100, 200]);
}

export function startAlarm(id: string, label: string) {
  if (ringing.has(id)) return;
  ringing.add(id);
  void notify(label);
  if (!chimeTimer) {
    chime();
    chimeTimer = setInterval(chime, REPEAT_MS);
  }
}

export function stopAlarm(id: string) {
  ringing.delete(id);
  if (!ringing.size && chimeTimer) {
    clearInterval(chimeTimer);
    chimeTimer = undefined;
  }
}

async function notify(label: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = label ? `${label} is done` : 'Timer is done';
  try {
    // Android Chrome only supports notifications via the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification('⏰ Timer', { body, tag: 'timer' });
    else new Notification('⏰ Timer', { body });
  } catch {
    /* notifications are best-effort */
  }
}
