// Nested to-do lists: top-level items can have sub-items (one level). An item with
// sub-items is a "category" whose checked state is derived from its sub-items.
import type { ItemRec } from '../../shared/src/types.ts';

export interface ListNode {
  item: ItemRec;
  children: ItemRec[];
}

export type CheckState = 'unchecked' | 'partial' | 'checked';

export function checkState(node: ListNode): CheckState {
  if (!node.children.length) return node.item.checked ? 'checked' : 'unchecked';
  const done = node.children.filter((c) => c.checked).length;
  return done === 0 ? 'unchecked' : done === node.children.length ? 'checked' : 'partial';
}

/** Open first, then done; each by sortOrder. */
const byStatus = (isDone: (x: ItemRec) => boolean) => (a: ItemRec, b: ItemRec) =>
  Number(isDone(a)) - Number(isDone(b)) || a.sortOrder - b.sortOrder;

/**
 * Groups items into top-level nodes with their sub-items. Sub-items whose category no longer
 * exists (e.g. deleted on another device while offline) are shown as top-level items.
 */
export function buildTree(items: ItemRec[]): ListNode[] {
  const ids = new Set(items.map((i) => i.id));
  const isChild = (i: ItemRec) => !!i.parentId && ids.has(i.parentId);
  const nodes = items
    .filter((i) => !isChild(i))
    .map((item) => ({
      item,
      children: items.filter((c) => c.parentId === item.id && isChild(c)).sort(byStatus((c) => c.checked)),
    }));
  const done = new Map(nodes.map((n) => [n.item.id, checkState(n) === 'checked']));
  return nodes.sort((a, b) => byStatus((x) => done.get(x.id)!)(a.item, b.item));
}

/** Count of checked entries the "Clear checked" button acts on (leaf items only). */
export function checkedCount(tree: ListNode[]): number {
  return tree.reduce((n, node) => n + (node.children.length ? node.children.filter((c) => c.checked).length : node.item.checked ? 1 : 0), 0);
}

/**
 * What "Clear checked" does:
 * - checked one-time items are removed, checked persistent items are unchecked;
 * - a fully checked one-time category is removed together with all its sub-items;
 * - in a persistent category, sub-items follow their own rule and the category stays.
 */
export function clearPlan(tree: ListNode[]): { remove: string[]; uncheck: string[] } {
  const remove: string[] = [];
  const uncheck: string[] = [];
  for (const node of tree) {
    const { item, children } = node;
    if (!children.length) {
      if (item.checked) (item.persistent ? uncheck : remove).push(item.id);
      continue;
    }
    if (checkState(node) === 'checked' && !item.persistent) {
      remove.push(item.id, ...children.map((c) => c.id));
      continue;
    }
    for (const c of children) if (c.checked) (c.persistent ? uncheck : remove).push(c.id);
    if (item.checked) uncheck.push(item.id);
  }
  return { remove, uncheck };
}
