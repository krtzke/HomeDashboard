// First sync, then seeding. Runs at launch and again after the PIN screen unlocks the device.
import { ensureDefaultPage, seedIfEmpty } from './seed.ts';
import { getSyncStatus, syncNow } from './sync.ts';

export async function initialSync() {
  // Pull from the server first so a new device gets the existing dashboard instead of seeding one.
  await syncNow();
  // A locked device seeds only once it's unlocked and has the server's data.
  if (getSyncStatus().state === 'locked') return;
  await seedIfEmpty();
  await ensureDefaultPage();
}
