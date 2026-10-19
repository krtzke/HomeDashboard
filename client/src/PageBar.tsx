// Page tabs, page settings (name, icon, theme, accent) and the per-device active page.
import { useEffect, useRef, useState } from 'react';
import { create, putRecords, remove, update } from './data.ts';
import { COLOR_HEX } from './colors.ts';
import { findFreeSlot } from './layout.ts';
import { pageIdOf, resolveActivePage, sortPages, widgetsOnPage } from './pages.ts';
import { EVENT_COLORS } from '../../shared/src/types.ts';
import type { EventColor, PageRec, PageTheme, WidgetRec } from '../../shared/src/types.ts';

const ACTIVE_PAGE_KEY = 'active-page';
const DEFAULT_THEME_COLOR = '#1f6feb';

const readHash = () => decodeURIComponent(location.hash.slice(1)) || null;

/** Active page per device: the URL hash (bookmarkable, e.g. for a kitchen tablet) wins over the last used page. */
export function useActivePage(pages: PageRec[]) {
  const [requested, setRequested] = useState<string | null>(() => {
    try {
      return readHash() ?? localStorage.getItem(ACTIVE_PAGE_KEY);
    } catch {
      return readHash();
    }
  });

  useEffect(() => {
    const onHash = () => setRequested(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const justSelected = useRef<string | null>(null);
  const select = (id: string) => {
    justSelected.current = id;
    setRequested(id);
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    try {
      localStorage.setItem(ACTIVE_PAGE_KEY, id);
    } catch {
      /* not remembered — fine */
    }
  };

  const page = resolveActivePage(pages, requested);
  // True right after selecting a page that hasn't shown up in `pages` yet (e.g. just created).
  const pending = requested !== null && page?.id !== requested && justSelected.current === requested;
  return [page, select, pending] as const;
}

/** Applies the page's theme (light/dark/auto) and accent color to the whole app. */
export function usePageTheme(page: PageRec | null) {
  const theme = page?.theme ?? 'auto';
  const accent = page?.accent ?? '';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    if (accent) root.style.setProperty('--accent', COLOR_HEX[accent]);
    else root.style.removeProperty('--accent');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent ? COLOR_HEX[accent] : DEFAULT_THEME_COLOR);
  }, [theme, accent]);
}

interface PageTabsProps {
  pages: PageRec[];
  active: PageRec | null;
  editing: boolean;
  onSelect: (id: string) => void;
}

export function PageTabs({ pages, active, editing, onSelect }: PageTabsProps) {
  const sorted = sortPages(pages);
  // A single page needs no tab bar, except in edit mode to add more.
  if (sorted.length < 2 && !editing) return null;

  async function addPage() {
    const sortOrder = sorted.reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1;
    const id = await create('pages', { name: 'New page', icon: '📄', sortOrder, theme: 'auto', accent: '' });
    onSelect(id);
  }

  return (
    <nav className="page-tabs" aria-label="Pages">
      {sorted.map((p) => (
        <button
          key={p.id}
          className={`page-tab${p.id === active?.id ? ' active' : ''}`}
          aria-current={p.id === active?.id ? 'page' : undefined}
          onClick={() => onSelect(p.id)}
        >
          <span aria-hidden>{p.icon}</span> {p.name}
        </button>
      ))}
      {editing && (
        <button className="page-tab add" title="Add page" onClick={addPage}>
          ＋ Page
        </button>
      )}
    </nav>
  );
}

const THEMES: { value: PageTheme; label: string }[] = [
  { value: 'auto', label: '◐ Auto' },
  { value: 'light', label: '☀ Light' },
  { value: 'dark', label: '☾ Dark' },
];

interface PageSettingsProps {
  page: PageRec;
  pages: PageRec[];
  widgets: WidgetRec[];
  onSelect: (id: string) => void;
}

/** Shown in edit mode for the active page. */
export function PageSettings({ page, pages, widgets, onSelect }: PageSettingsProps) {
  const sorted = sortPages(pages);
  const index = sorted.findIndex((p) => p.id === page.id);
  // Rendered with key={page.id}, so these never carry over to another page.
  const [name, setName] = useState(page.name);
  const [icon, setIcon] = useState(page.icon);

  // Pick up renames synced from another device.
  useEffect(() => setName(page.name), [page.name]);
  useEffect(() => setIcon(page.icon), [page.icon]);

  const saveName = () => name.trim() && name.trim() !== page.name && update('pages', page.id, { name: name.trim() });
  const saveIcon = () => icon.trim() !== page.icon && update('pages', page.id, { icon: icon.trim() || '📄' });

  /** Moves the page left/right; renumbers all pages so equal sortOrders can't get stuck. */
  async function move(dir: -1 | 1) {
    const order = [...sorted];
    [order[index], order[index + dir]] = [order[index + dir], order[index]];
    await putRecords('pages', order.flatMap((p, i) => (p.sortOrder === i ? [] : [{ ...p, sortOrder: i }])));
  }

  /** Deleting a page never deletes widgets: they move to the first remaining page. */
  async function deletePage() {
    const target = sorted.find((p) => p.id !== page.id);
    if (!target) return;
    const onPage = widgetsOnPage(widgets, pages, page.id);
    const msg = onPage.length
      ? `Delete page "${page.name}"? Its ${onPage.length} widget(s) move to "${target.name}".`
      : `Delete page "${page.name}"?`;
    if (!confirm(msg)) return;
    const placed = widgets.filter((w) => pageIdOf(w, pages) === target.id);
    const moved = onPage.map((w) => {
      const slot = findFreeSlot(placed, w.w, w.h);
      const next = { ...w, pageId: target.id, ...slot };
      placed.push(next);
      return next;
    });
    await putRecords('widgets', moved);
    await remove('pages', [page.id]);
    onSelect(target.id);
  }

  return (
    <div className="page-settings">
      <div className="ps-group">
        <input
          className="emoji-input"
          value={icon}
          maxLength={8}
          title="Page icon (emoji)"
          onChange={(e) => setIcon(e.target.value)}
          onBlur={saveIcon}
        />
        <input
          className="ps-name"
          value={name}
          placeholder="Page name"
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="ps-group segmented" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.value}
            role="radio"
            aria-checked={page.theme === t.value}
            className={page.theme === t.value ? 'active' : ''}
            onClick={() => update('pages', page.id, { theme: t.value })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ps-group swatches" role="radiogroup" aria-label="Accent color">
        <button
          className={`swatch default-accent${page.accent === '' ? ' active' : ''}`}
          role="radio"
          aria-checked={page.accent === ''}
          aria-label="Default accent"
          title="Default"
          onClick={() => update('pages', page.id, { accent: '' })}
        />
        {EVENT_COLORS.map((c: EventColor) => (
          <button
            key={c}
            className={`swatch${page.accent === c ? ' active' : ''}`}
            role="radio"
            aria-checked={page.accent === c}
            aria-label={c}
            title={c}
            style={{ background: COLOR_HEX[c] }}
            onClick={() => update('pages', page.id, { accent: c })}
          />
        ))}
      </div>
      <div className="ps-group push-right">
        <button className="icon-btn" title="Move page left" aria-label="Move page left" disabled={index <= 0} onClick={() => move(-1)}>
          ←
        </button>
        <button
          className="icon-btn"
          title="Move page right"
          aria-label="Move page right"
          disabled={index >= sorted.length - 1}
          onClick={() => move(1)}
        >
          →
        </button>
        <button className="small danger" disabled={sorted.length < 2} title={sorted.length < 2 ? 'The last page cannot be deleted' : 'Delete page'} onClick={deletePage}>
          🗑 Delete page
        </button>
      </div>
    </div>
  );
}
