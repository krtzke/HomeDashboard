import { useState, type FormEvent } from 'react';
import { initialSync } from './startup.ts';
import { login } from './auth.ts';

/** Shown when the server has a PIN and this device isn't logged in yet. Pending changes stay in the outbox meanwhile. */
export function PinScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError('');
    const res = await login(pin);
    if (res.ok) {
      // The sync clears the locked state, which removes this screen.
      await initialSync();
    } else {
      setError(res.error);
      setPin('');
    }
    setBusy(false);
  }

  return (
    <div className="pin-screen">
      <form className="pin-card" onSubmit={submit}>
        <div className="pin-icon">🔒</div>
        <h2>Home Dashboard</h2>
        <p>Enter the household PIN. You only need to do this once on this device.</p>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-label="PIN"
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={busy}
        />
        {error && (
          <p className="pin-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={!pin || busy}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
