import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, checkState, checkedCount, clearPlan } from '../src/listTree.ts';
import type { ItemRec } from '../../shared/src/types.ts';

let order = 0;
function item(id: string, patch: Partial<ItemRec> = {}): ItemRec {
  return { id, updatedAt: 1, deleted: false, listId: 'l', text: id, checked: false, persistent: false, sortOrder: ++order, ...patch };
}

test('groups sub-items under categories and sorts open before done', () => {
  const tree = buildTree([
    item('done', { checked: true }),
    item('cat'),
    item('c1', { parentId: 'cat', checked: true }),
    item('c2', { parentId: 'cat' }),
    item('plain'),
  ]);
  assert.deepEqual(
    tree.map((n) => [n.item.id, n.children.map((c) => c.id)]),
    [['cat', ['c2', 'c1']], ['plain', []], ['done', []]],
  );
});

test('fully checked categories sort to the bottom; orphans become top-level', () => {
  const tree = buildTree([item('cat'), item('c1', { parentId: 'cat', checked: true }), item('open'), item('orphan', { parentId: 'gone' })]);
  assert.deepEqual(tree.map((n) => n.item.id), ['open', 'orphan', 'cat']);
});

test('category check state is derived from sub-items', () => {
  const [node] = buildTree([item('cat', { checked: true }), item('a', { parentId: 'cat' }), item('b', { parentId: 'cat', checked: true })]);
  assert.equal(checkState(node), 'partial');
  assert.equal(checkState({ ...node, children: node.children.map((c) => ({ ...c, checked: true })) }), 'checked');
  assert.equal(checkState({ ...node, children: node.children.map((c) => ({ ...c, checked: false })) }), 'unchecked');
});

test('clear checked: plain items, partial category, done one-time category', () => {
  const tree = buildTree([
    item('milk', { checked: true, persistent: true }),
    item('bread', { checked: true }),
    item('party'),
    item('balloons', { parentId: 'party', checked: true }),
    item('cake', { parentId: 'party', checked: true, persistent: true }),
    item('music', { parentId: 'party' }),
    item('move'),
    item('boxes', { parentId: 'move', checked: true }),
    item('van', { parentId: 'move', checked: true, persistent: true }),
  ]);
  assert.equal(checkedCount(tree), 6);
  const plan = clearPlan(tree);
  assert.deepEqual(plan.remove.sort(), ['balloons', 'boxes', 'bread', 'move', 'van']);
  assert.deepEqual(plan.uncheck.sort(), ['cake', 'milk']);
});

test('clear checked: done persistent category keeps itself and persistent sub-items', () => {
  const tree = buildTree([
    item('weekly', { persistent: true }),
    item('veg', { parentId: 'weekly', checked: true, persistent: true }),
    item('extra', { parentId: 'weekly', checked: true }),
  ]);
  assert.deepEqual(clearPlan(tree), { remove: ['extra'], uncheck: ['veg'] });
});
