import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAGE_ID, pageIdOf, resolveActivePage, sortPages, widgetsOnPage } from '../src/pages.ts';
import type { PageRec, WidgetRec } from '../../shared/src/types.ts';

const page = (id: string, sortOrder: number, patch: Partial<PageRec> = {}): PageRec => ({
  id,
  updatedAt: 1,
  deleted: false,
  name: id,
  icon: '📄',
  sortOrder,
  theme: 'auto',
  accent: '',
  ...patch,
});
const widget = (id: string, pageId?: string): WidgetRec => ({
  id,
  updatedAt: 1,
  deleted: false,
  type: 'clock',
  config: {},
  x: 0,
  y: 0,
  w: 3,
  h: 4,
  ...(pageId && { pageId }),
});

const pages = [page('kitchen', 2), page(DEFAULT_PAGE_ID, 0), page('work', 1), page('old', 3, { deleted: true })];

test('pages are ordered and deleted ones hidden', () => {
  assert.deepEqual(sortPages(pages).map((p) => p.id), [DEFAULT_PAGE_ID, 'work', 'kitchen']);
});

test('widgets without or with an unknown page land on the default page', () => {
  assert.equal(pageIdOf(widget('a', 'kitchen'), pages), 'kitchen');
  assert.equal(pageIdOf(widget('b'), pages), DEFAULT_PAGE_ID);
  assert.equal(pageIdOf(widget('c', 'old'), pages), DEFAULT_PAGE_ID);
});

test('without the default page, orphans go to the first page', () => {
  const noDefault = [page('kitchen', 2), page('work', 1)];
  assert.equal(pageIdOf(widget('b'), noDefault), 'work');
  // Reordering pages doesn't move widgets that have an explicit page
  assert.equal(pageIdOf(widget('a', 'kitchen'), noDefault), 'kitchen');
});

test('filters widgets by page; shows all while pages are loading', () => {
  const ws = [widget('a', 'kitchen'), widget('b'), widget('c', 'work')];
  assert.deepEqual(widgetsOnPage(ws, pages, DEFAULT_PAGE_ID).map((w) => w.id), ['b']);
  assert.deepEqual(widgetsOnPage(ws, pages, 'kitchen').map((w) => w.id), ['a']);
  assert.equal(widgetsOnPage(ws, [], null).length, 3);
});

test('active page falls back to the first page', () => {
  assert.equal(resolveActivePage(pages, 'work')?.id, 'work');
  assert.equal(resolveActivePage(pages, 'old')?.id, DEFAULT_PAGE_ID);
  assert.equal(resolveActivePage(pages, null)?.id, DEFAULT_PAGE_ID);
  assert.equal(resolveActivePage([], 'x'), null);
});
