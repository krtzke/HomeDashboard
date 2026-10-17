// Alarm sound + system notification for timers.
// Browsers only allow audio after a user gesture, so call unlockAudio() from a click handler.

let ctx: AudioContext | null = null;
let beepTimer: ReturnType<typeof setInterval> | undefined;
const ringing = new Set<string>();

export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  if ('Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function beep() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, t + i * 0.25);
    gain.gain.setValueAtTime(0, t + i * 0.25 + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + i * 0.25);
    osc.stop(t + i * 0.25 + 0.16);
  }
  navigator.vibrate?.([200, 100, 200, 100, 200]);
}

export function startAlarm(id: string, label: string) {
  if (ringing.has(id)) return;
  ringing.add(id);
  void notify(label);
  if (!beepTimer) {
    beep();
    beepTimer = setInterval(beep, 1200);
  }
}

export function stopAlarm(id: string) {
  ringing.delete(id);
  if (!ringing.size && beepTimer) {
    clearInterval(beepTimer);
    beepTimer = undefined;
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
