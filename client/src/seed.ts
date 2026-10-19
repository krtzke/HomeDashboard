// Creates a starter dashboard on first launch.
// Fixed IDs and updatedAt=1 make seeding on several devices collapse into the same records,
// and any later edit/deletion on the server always wins over the seed.
import { db, getMeta, setMeta } from './db.ts';
import { scheduleSync } from './sync.ts';
import { putRecords } from './data.ts';
import { DEFAULT_PAGE_ID } from './pages.ts';
import type { ListRec, PageRec, SyncTable, WidgetRec } from '../../shared/src/types.ts';

const base = { updatedAt: 1, deleted: false };

const lists: ListRec[] = [
  { ...base, id: 'seed-list-todo', name: 'To Do', kind: 'todo' },
  { ...base, id: 'seed-list-shopping', name: 'Shopping', kind: 'shopping' },
];

const widgets: WidgetRec[] = [
  { ...base, id: 'seed-w-todo', type: 'list', config: { listId: 'seed-list-todo' }, x: 0, y: 0, w: 3, h: 9 },
  { ...base, id: 'seed-w-shopping', type: 'list', config: { listId: 'seed-list-shopping' }, x: 3, y: 0, w: 3, h: 9 },
  { ...base, id: 'seed-w-calendar', type: 'calendar', config: {}, x: 6, y: 0, w: 3, h: 9 },
  { ...base, id: 'seed-w-timeline', type: 'timeline', config: {}, x: 9, y: 0, w: 3, h: 9 },
  { ...base, id: 'seed-w-timer', type: 'timer', config: {}, x: 0, y: 9, w: 3, h: 6 },
];

export async function seedIfEmpty() {
  if (await getMeta('seeded', false)) return;
  const hasWidgets = (await db.widgets.filter((w) => !w.deleted).count()) > 0;
  await db.transaction('rw', db.lists, db.widgets, db.outbox, db.meta, async () => {
    if (!hasWidgets) {
      const put = async (table: SyncTable, recs: { id: string }[]) => {
        for (const r of recs) {
          if (await db.table(table).get(r.id)) continue;
          await db.table(table).put(r);
          await db.outbox.put({ key: `${table}:${r.id}`, table, id: r.id, updatedAt: 1 });
        }
      };
      await put('lists', lists);
      await put('widgets', widgets);
    }
    await setMeta('seeded', true);
  });
  scheduleSync();
}

const defaultPage: PageRec = { ...base, id: DEFAULT_PAGE_ID, name: 'Home', icon: '🏠', sortOrder: 0, theme: 'auto', accent: '' };

/**
 * Makes sure at least one page exists (runs on every start, also for installs from before pages existed).
 * Existing widgets without a page then show on this default page.
 */
export async function ensureDefaultPage() {
  if ((await db.pages.filter((p) => !p.deleted).count()) > 0) return;
  const existing = await db.pages.get(DEFAULT_PAGE_ID);
  if (existing) {
    // All pages got deleted (e.g. concurrently on two devices): bring the default page back.
    await putRecords('pages', [{ ...existing, deleted: false }]);
    return;
  }
  await db.transaction('rw', db.pages, db.outbox, async () => {
    await db.pages.put(defaultPage);
    await db.outbox.put({ key: `pages:${DEFAULT_PAGE_ID}`, table: 'pages', id: DEFAULT_PAGE_ID, updatedAt: 1 });
  });
  scheduleSync();
}
