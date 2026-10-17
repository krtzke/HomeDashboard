import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ReactGridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import { db } from './db.ts';
import { create, putRecords, remove } from './data.ts';
import { syncNow, useSyncStatus } from './sync.ts';
import { WIDGETS } from './widgets/registry.ts';
import type { ListRec, WidgetRec, WidgetType } from '../../shared/src/types.ts';

const COLS = 12;
const ROW_HEIGHT = 40;
const MOBILE_BREAKPOINT = 760;

export function App() {
  const widgets = useLiveQuery(() => db.widgets.filter((w) => !w.deleted).toArray(), [], [] as WidgetRec[]);
  const [editing, setEditing] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <h1>🏠 Home</h1>
        <SyncIndicator />
        <button className={editing ? 'primary' : ''} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : '✎ Edit'}
        </button>
      </header>
      {editing && <AddWidgetBar widgets={widgets} />}
      <Dashboard widgets={widgets} editing={editing} />
    </div>
  );
}

function SyncIndicator() {
  const status = useSyncStatus();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);

  const label =
    status.state === 'syncing'
      ? 'Syncing…'
      : status.state === 'offline'
        ? `Offline${pending ? ` · ${pending} pending` : ''}`
        : status.state === 'error'
          ? 'Sync error'
          : pending
            ? `${pending} pending`
            : 'Synced';
  const title =
    status.error ?? (status.lastSync ? `Last sync ${new Date(status.lastSync).toLocaleTimeString()}` : 'Not synced yet');

  return (
    <button className={`sync sync-${status.state}${pending ? ' has-pending' : ''}`} onClick={() => syncNow()} title={title}>
      <span className="sync-dot" /> {label} <span className="sync-icon">⟳</span>
    </button>
  );
}

function Dashboard({ widgets, editing }: { widgets: WidgetRec[]; editing: boolean }) {
  const { width, containerRef, mounted } = useContainerWidth();
  const mobile = width < MOBILE_BREAKPOINT;

  const layout: Layout = widgets.map((w) => ({
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: WIDGETS[w.type]?.size.minW,
    minH: WIDGETS[w.type]?.size.minH,
  }));

  function saveLayout(next: Layout) {
    if (!editing) return;
    const changed = widgets.flatMap((w) => {
      const l = next.find((n) => n.i === w.id);
      return l && (l.x !== w.x || l.y !== w.y || l.w !== w.w || l.h !== w.h) ? [{ ...w, x: l.x, y: l.y, w: l.w, h: l.h }] : [];
    });
    void putRecords('widgets', changed);
  }

  const render = (w: WidgetRec) => {
    const Component = WIDGETS[w.type]?.component;
    return Component ? <Component widget={w} editing={editing} onRemove={() => removeWidget(w)} /> : null;
  };

  // The container must always render so useContainerWidth can measure it.
  return (
    <main ref={containerRef} className="dashboard">
      {!widgets.length && <p className="empty-dashboard">Loading… (or click Edit to add widgets)</p>}
      {mounted && mobile && (
        // On phones: one column, ordered like the desktop layout (top-to-bottom, left-to-right).
        <div className="stack">
          {[...widgets]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((w) => (
              <div key={w.id} style={{ height: Math.max(w.h * ROW_HEIGHT, 260) }}>
                {render(w)}
              </div>
            ))}
        </div>
      )}
      {mounted && !mobile && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [12, 12], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: '.drag-handle', cancel: 'button, input' }}
          resizeConfig={{ enabled: editing }}
          onLayoutChange={saveLayout}
        >
          {widgets.map((w) => (
            <div key={w.id}>{render(w)}</div>
          ))}
        </ReactGridLayout>
      )}
    </main>
  );
}

async function removeWidget(w: WidgetRec) {
  const cleanup = WIDGETS[w.type]?.cleanup;
  if (cleanup && !(await cleanup(w))) return;
  await remove('widgets', [w.id]);
}

/** Top-most, then left-most position where a w×h widget fits without overlapping others. */
function findFreeSlot(widgets: WidgetRec[], w: number, h: number): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    widgets.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
  const bottom = widgets.reduce((max, o) => Math.max(max, o.y + o.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

function AddWidgetBar({ widgets }: { widgets: WidgetRec[] }) {
  const [type, setType] = useState<WidgetType>('list');
  const [name, setName] = useState('');
  const [listKind, setListKind] = useState<ListRec['kind']>('shopping');

  async function add() {
    const { w, h } = WIDGETS[type].size;
    const { x, y } = findFreeSlot(widgets, w, h);
    const config: WidgetRec['config'] = {};
    if (type === 'list') {
      config.listId = await create('lists', { name: name.trim() || (listKind === 'shopping' ? 'Shopping' : 'To Do'), kind: listKind });
    }
    if (type === 'note') {
      config.noteId = await create('notes', { title: name.trim() || 'Notes', text: '' });
    }
    setName('');
    await create('widgets', { type, config, x, y, w, h });
  }

  return (
    <div className="add-bar">
      <select value={type} onChange={(e) => setType(e.target.value as WidgetType)}>
        {Object.entries(WIDGETS).map(([key, def]) => (
          <option key={key} value={key}>
            {def.label}
          </option>
        ))}
      </select>
      {(type === 'list' || type === 'note') && (
        <input placeholder={type === 'list' ? 'List name' : 'Note title'} value={name} onChange={(e) => setName(e.target.value)} />
      )}
      {type === 'list' && (
        <select value={listKind} onChange={(e) => setListKind(e.target.value as ListRec['kind'])}>
          <option value="shopping">🛒 Shopping</option>
          <option value="todo">✅ To-Do</option>
        </select>
      )}
      <button className="primary" onClick={add}>
        ＋ Add widget
      </button>
      <span className="hint">Drag widgets by their header, resize from the bottom-right corner.</span>
    </div>
  );
}
