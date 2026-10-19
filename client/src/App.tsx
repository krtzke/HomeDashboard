import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ReactGridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import { db } from './db.ts';
import { create, putRecords, remove, update } from './data.ts';
import { syncNow, useSyncStatus } from './sync.ts';
import { COLS, findFreeSlot } from './layout.ts';
import { pageIdOf, sortPages, widgetsOnPage } from './pages.ts';
import { PageSettings, PageTabs, useActivePage, usePageTheme } from './PageBar.tsx';
import { PinScreen } from './PinScreen.tsx';
import { PinSettings } from './PinSettings.tsx';
import { WIDGETS } from './widgets/registry.ts';
import { WidgetContext } from './widgets/WidgetFrame.tsx';
import type { ListRec, PageRec, WidgetRec, WidgetType } from '../../shared/src/types.ts';

const ROW_HEIGHT = 40;
const MOBILE_BREAKPOINT = 760;

export function App() {
  const allWidgets = useLiveQuery(() => db.widgets.filter((w) => !w.deleted).toArray(), []);
  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deleted).toArray(), [], [] as PageRec[]);
  const [editing, setEditing] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [page, selectPage, pagePending] = useActivePage(pages);
  const locked = useSyncStatus().state === 'locked';
  usePageTheme(page);

  const widgets = widgetsOnPage(allWidgets ?? [], pages, page?.id ?? null);

  /** Moves a widget to another page, into the first free spot there. */
  async function moveToPage(w: WidgetRec, targetId: string) {
    const there = (allWidgets ?? []).filter((o) => o.id !== w.id && pageIdOf(o, pages) === targetId);
    await update('widgets', w.id, { pageId: targetId, ...findFreeSlot(there, w.w, w.h) });
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>{page ? `${page.icon} ${page.name}` : '🏠 Home'}</h1>
        <SyncIndicator />
        {editing && <button onClick={() => setPinOpen(true)}>🔒 PIN</button>}
        <button className={editing ? 'primary' : ''} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : '✎ Edit'}
        </button>
      </header>
      <PageTabs pages={pages} active={page} editing={editing} onSelect={selectPage} />
      {editing && page && !pagePending && (
        <PageSettings key={page.id} page={page} pages={pages} widgets={allWidgets ?? []} onSelect={selectPage} />
      )}
      {editing && <AddWidgetBar widgets={widgets} pageId={page?.id} />}
      <Dashboard
        widgets={widgets}
        loading={allWidgets === undefined}
        editing={editing}
        pages={sortPages(pages)}
        currentPageId={page?.id ?? null}
        onMoveToPage={moveToPage}
      />
      {pinOpen && <PinSettings onClose={() => setPinOpen(false)} />}
      {locked && <PinScreen />}
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
          : status.state === 'locked'
            ? '🔒 Locked'
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

/** Collapsed widgets are remembered per device (not synced), like collapsed list categories. */
const COLLAPSED_WIDGETS_KEY = 'collapsed-widgets';

function useCollapsedWidgets() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_WIDGETS_KEY) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(COLLAPSED_WIDGETS_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — state just isn't remembered */
      }
      return next;
    });
  return [collapsed, toggle] as const;
}

interface DashboardProps {
  widgets: WidgetRec[];
  loading: boolean;
  editing: boolean;
  pages: PageRec[];
  currentPageId: string | null;
  onMoveToPage: (w: WidgetRec, pageId: string) => Promise<void>;
}

function Dashboard({ widgets, loading, editing, pages, currentPageId, onMoveToPage }: DashboardProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const mobile = width < MOBILE_BREAKPOINT;
  const [collapsed, toggleCollapsed] = useCollapsedWidgets();

  // A collapsed widget takes one row (its header) and can't be resized; its real height stays in the record.
  const layout: Layout = widgets.map((w) =>
    collapsed.has(w.id)
      ? { i: w.id, x: w.x, y: w.y, w: w.w, h: 1, minW: WIDGETS[w.type]?.size.minW, isResizable: false }
      : { i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: WIDGETS[w.type]?.size.minW, minH: WIDGETS[w.type]?.size.minH },
  );

  function saveLayout(next: Layout) {
    if (!editing) return;
    const changed = widgets.flatMap((w) => {
      const l = next.find((n) => n.i === w.id);
      const h = collapsed.has(w.id) ? w.h : l?.h;
      return l && (l.x !== w.x || l.y !== w.y || l.w !== w.w || h !== w.h) ? [{ ...w, x: l.x, y: l.y, w: l.w, h: h ?? w.h }] : [];
    });
    void putRecords('widgets', changed);
  }

  const render = (w: WidgetRec) => {
    const Component = WIDGETS[w.type]?.component;
    return Component ? (
      <WidgetContext.Provider
        value={{
          widget: w,
          collapsed: collapsed.has(w.id),
          toggleCollapsed: () => toggleCollapsed(w.id),
          otherPages: pages.filter((p) => p.id !== currentPageId),
          moveToPage: (pageId) => onMoveToPage(w, pageId),
        }}
      >
        <Component widget={w} editing={editing} onRemove={() => removeWidget(w)} />
      </WidgetContext.Provider>
    ) : null;
  };

  // The container must always render so useContainerWidth can measure it.
  return (
    <main ref={containerRef} className="dashboard">
      {!widgets.length && (
        <p className="empty-dashboard">{loading ? 'Loading…' : editing ? 'This page is empty — add a widget above.' : 'This page is empty — click ✎ Edit to add widgets.'}</p>
      )}
      {mounted && mobile && (
        // On phones: one column, ordered like the desktop layout (top-to-bottom, left-to-right).
        <div className="stack">
          {[...widgets]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((w) => (
              <div key={w.id} style={collapsed.has(w.id) ? undefined : { height: Math.max(w.h * ROW_HEIGHT, 260) }}>
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

function AddWidgetBar({ widgets, pageId }: { widgets: WidgetRec[]; pageId?: string }) {
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
    await create('widgets', { type, config, x, y, w, h, ...(pageId && { pageId }) });
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
