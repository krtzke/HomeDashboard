// Dialog to set, change or remove the household PIN. Opened from the top bar in edit mode.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { changePin, getAuthInfo, type AuthInfo } from './auth.ts';
import { syncNow } from './sync.ts';

const MIN_PIN_LENGTH = 4;

export function PinSettings({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    void getAuthInfo().then((res) => (res.ok ? setInfo(res.value) : setLoadError(res.error)));
  }, []);

  return (
    <dialog ref={dialog} className="pin-dialog" onClose={onClose}>
      <header>
        <h2>🔒 PIN</h2>
        <button className="icon-btn subtle" onClick={() => dialog.current?.close()} aria-label="Close">
          ✕
        </button>
      </header>
      {loadError ? (
        <p className="pin-error">{loadError}</p>
      ) : !info ? (
        <p className="hint">Loading…</p>
      ) : info.source === 'env' ? (
        <p>
          The PIN is set on the Pi with <code>DASHBOARD_PIN</code> and can only be changed there.
        </p>
      ) : (
        <PinForm enabled={info.enabled} onDone={(enabled) => setInfo({ enabled, source: enabled ? 'app' : null })} />
      )}
    </dialog>
  );
}

function PinForm({ enabled, onDone }: { enabled: boolean; onDone: (enabled: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(pin: string | null) {
    setBusy(true);
    setError('');
    setDone('');
    const res = await changePin(pin, enabled ? current : undefined);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setCurrent('');
    setNext('');
    setRepeat('');
    setDone(
      pin === null
        ? 'PIN removed. Anyone who can reach the dashboard can use it again.'
        : enabled
          ? 'PIN changed. Other devices will ask for the new one.'
          : 'PIN set. Other devices will ask for it once.',
    );
    onDone(pin !== null);
    void syncNow();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (next.trim().length < MIN_PIN_LENGTH) return setError(`The PIN needs at least ${MIN_PIN_LENGTH} characters.`);
    if (next !== repeat) return setError("The two new PINs don't match.");
    void apply(next);
  }

  return (
    <form onSubmit={submit}>
      <p className="hint">
        {enabled
          ? 'The dashboard is protected. Changing the PIN logs out every other device.'
          : 'No PIN is set, so anyone who can reach the dashboard can use it. With a PIN, each device has to enter it once.'}
      </p>
      {enabled && (
        <label>
          Current PIN
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label>
        {enabled ? 'New PIN' : 'PIN'}
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label>
        Repeat
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </label>
      <p className="hint">At least {MIN_PIN_LENGTH} characters; 6 or more digits are better. Letters work too.</p>
      {error && (
        <p className="pin-error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="pin-done">{done}</p>}
      <div className="pin-actions">
        {enabled && (
          <button type="button" className="danger" disabled={busy || !current} onClick={() => void apply(null)}>
            Remove PIN
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || !next || !repeat || (enabled && !current)}>
          {enabled ? 'Change PIN' : 'Set PIN'}
        </button>
      </div>
    </form>
  );
}
