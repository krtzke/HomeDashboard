// Dashboard pages (tabs): ordering and which page a widget belongs to.
import type { PageRec, WidgetRec } from '../../shared/src/types.ts';

/** The page every device creates on first start (fixed ID, so devices converge on one record). */
export const DEFAULT_PAGE_ID = 'seed-page-home';

export const sortPages = (pages: PageRec[]) =>
  [...pages].filter((p) => !p.deleted).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

/**
 * The page a widget is shown on. Widgets from before pages existed (no pageId), or whose page
 * was deleted on another device, fall back to the default page, or the first page if that's gone.
 */
export function pageIdOf(widget: WidgetRec, pages: PageRec[]): string | null {
  const live = sortPages(pages);
  if (widget.pageId && live.some((p) => p.id === widget.pageId)) return widget.pageId;
  return (live.find((p) => p.id === DEFAULT_PAGE_ID) ?? live[0])?.id ?? null;
}

export function widgetsOnPage(widgets: WidgetRec[], pages: PageRec[], pageId: string | null): WidgetRec[] {
  if (!pageId) return widgets; // pages not loaded yet: show everything rather than nothing
  return widgets.filter((w) => pageIdOf(w, pages) === pageId);
}

/** Page to show: the requested one if it still exists, otherwise the first. */
export function resolveActivePage(pages: PageRec[], requestedId: string | null): PageRec | null {
  const live = sortPages(pages);
  return live.find((p) => p.id === requestedId) ?? live[0] ?? null;
}
