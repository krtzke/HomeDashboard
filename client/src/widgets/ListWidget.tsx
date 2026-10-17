import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.ts';
import { create, remove, update, updateMany } from '../data.ts';
import { buildTree, checkState, checkedCount, clearPlan, type ListNode } from '../listTree.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { ItemRec, WidgetRec } from '../../../shared/src/types.ts';

/** Collapsed categories are remembered per device (not synced). */
const COLLAPSED_KEY = 'collapsed-categories';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable — collapse state just isn't remembered */
  }
}

export function ListWidget({ widget, editing, onRemove }: WidgetProps) {
  const listId = widget.config.listId ?? '';
  const list = useLiveQuery(() => db.lists.get(listId), [listId]);
  const items = useLiveQuery(
    () => db.items.where('listId').equals(listId).filter((i) => !i.deleted).toArray(),
    [listId],
    [] as ItemRec[],
  );
  const [text, setText] = useState('');
  const [persistent, setPersistent] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const tree = buildTree(items);
  const doneCount = checkedCount(tree);
  const nextOrder = () => items.reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    await create('items', { listId, text: value, checked: false, persistent, sortOrder: nextOrder(), parentId: null });
    setText('');
  }

  async function addSub(parent: ItemRec, value: string) {
    // Sub-items inherit the category's persistence (e.g. a persistent "Weekly groceries" category).
    await create('items', { listId, text: value, checked: false, persistent: parent.persistent, sortOrder: nextOrder(), parentId: parent.id });
    if (parent.checked) await update('items', parent.id, { checked: false });
    setExpanded(parent.id, true);
  }

  function setExpanded(id: string, expanded: boolean) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (expanded) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }

  async function clearChecked() {
    const plan = clearPlan(tree);
    await remove('items', plan.remove);
    await updateMany('items', plan.uncheck, () => ({ checked: false }));
  }

  async function rename() {
    const name = prompt('List name', list?.name)?.trim();
    if (name && list) await update('lists', list.id, { name });
  }

  const icon = list?.kind === 'shopping' ? '🛒' : '✅';
  const title = editing ? (
    <button className="link-btn" onClick={rename} title="Rename list">
      {list?.name ?? 'List'} ✎
    </button>
  ) : (
    list?.name ?? 'List'
  );

  return (
    <WidgetFrame
      title={title}
      icon={icon}
      editing={editing}
      onRemove={onRemove}
      footer={
        doneCount > 0 && (
          <button
            className="small"
            onClick={clearChecked}
            title="Remove checked one-time items (and finished one-time categories), uncheck persistent ones"
          >
            Clear checked ({doneCount})
          </button>
        )
      }
    >
      <form className="add-row" onSubmit={add}>
        <input placeholder="Add item…" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className={`icon-btn pin${persistent ? ' active' : ''}`}
          title={persistent ? 'Persistent: stays on the list' : 'One-time: removed when cleared'}
          onClick={() => setPersistent((p) => !p)}
        >
          📌
        </button>
        <button type="submit" className="icon-btn" title="Add">
          ＋
        </button>
      </form>
      <ul className="items">
        {tree.map((node) => (
          <NodeRow
            key={node.item.id}
            node={node}
            expanded={!collapsed.has(node.item.id)}
            onToggleExpanded={() => setExpanded(node.item.id, collapsed.has(node.item.id))}
            adding={addingTo === node.item.id}
            onStartAdding={() => setAddingTo(node.item.id)}
            onStopAdding={() => setAddingTo(null)}
            onAddSub={(value) => addSub(node.item, value)}
          />
        ))}
        {items.length === 0 && <li className="empty">Nothing here yet</li>}
      </ul>
    </WidgetFrame>
  );
}

interface NodeRowProps {
  node: ListNode;
  expanded: boolean;
  onToggleExpanded: () => void;
  adding: boolean;
  onStartAdding: () => void;
  onStopAdding: () => void;
  onAddSub: (value: string) => Promise<void>;
}

/** A top-level item; with sub-items it acts as a category. */
function NodeRow({ node, expanded, onToggleExpanded, adding, onStartAdding, onStopAdding, onAddSub }: NodeRowProps) {
  const { item, children } = node;
  const isCategory = children.length > 0;
  const state = checkState(node);
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = state === 'partial';
  }, [state]);

  /** Checking a category checks all sub-items; unchecking unchecks them all. */
  async function toggle(checked: boolean) {
    if (!isCategory) return update('items', item.id, { checked });
    await updateMany('items', [item.id, ...children.map((c) => c.id)], () => ({ checked }));
  }

  /** Toggling a sub-item keeps the category's stored flag in sync with its sub-items. */
  async function toggleChild(child: ItemRec, checked: boolean) {
    await update('items', child.id, { checked });
    const allDone = children.every((c) => (c.id === child.id ? checked : c.checked));
    if (item.checked !== allDone) await update('items', item.id, { checked: allDone });
  }

  async function del() {
    if (isCategory && !confirm(`Delete "${item.text}" and its ${children.length} sub-item(s)?`)) return;
    await remove('items', [item.id, ...children.map((c) => c.id)]);
  }

  const done = children.filter((c) => c.checked).length;

  return (
    <li className={`node${isCategory ? ' category' : ''}`}>
      <div className={`item${state === 'checked' ? ' checked' : ''}`}>
        {isCategory ? (
          <button className="icon-btn subtle expander" title={expanded ? 'Collapse' : 'Expand'} onClick={onToggleExpanded}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="expander" />
        )}
        <label>
          <input ref={checkboxRef} type="checkbox" checked={state === 'checked'} onChange={(e) => toggle(e.target.checked)} />
          <span>{item.text}</span>
          {isCategory && (
            <small className="progress">
              {done}/{children.length}
            </small>
          )}
        </label>
        <button className="icon-btn subtle add-sub" title="Add sub-item" onClick={onStartAdding}>
          ＋
        </button>
        <PinButton item={item} />
        <button className="icon-btn subtle" title={isCategory ? 'Delete category and sub-items' : 'Delete'} onClick={del}>
          ✕
        </button>
      </div>
      {(expanded || adding) && (isCategory || adding) && (
        <ul className="subitems">
          {expanded &&
            children.map((child) => (
              <li key={child.id} className={`item${child.checked ? ' checked' : ''}`}>
                <label>
                  <input type="checkbox" checked={child.checked} onChange={(e) => toggleChild(child, e.target.checked)} />
                  <span>{child.text}</span>
                </label>
                <PinButton item={child} />
                <button className="icon-btn subtle" title="Delete" onClick={() => remove('items', [child.id])}>
                  ✕
                </button>
              </li>
            ))}
          {adding && <AddSubForm parent={item.text} onAdd={onAddSub} onClose={onStopAdding} />}
        </ul>
      )}
    </li>
  );
}

function PinButton({ item }: { item: ItemRec }) {
  return (
    <button
      className={`icon-btn pin${item.persistent ? ' active' : ''}`}
      title={item.persistent ? 'Persistent (click to make one-time)' : 'One-time (click to make persistent)'}
      onClick={() => update('items', item.id, { persistent: !item.persistent })}
    >
      📌
    </button>
  );
}

/** Stays open after adding so several sub-items can be entered in a row; Esc or an empty Enter closes it. */
function AddSubForm({ parent, onAdd, onClose }: { parent: string; onAdd: (value: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return onClose();
    await onAdd(value.trim());
    setValue('');
  }

  return (
    <li className="add-sub-row">
      <form className="add-row" onSubmit={submit}>
        <input
          autoFocus
          placeholder={`Add to "${parent}"…`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          onBlur={() => !value.trim() && onClose()}
        />
        <button type="submit" className="icon-btn" title="Add sub-item">
          ＋
        </button>
      </form>
    </li>
  );
}

/** Called when the widget is removed: deletes the list and its items (on all devices). */
export async function cleanupList(w: WidgetRec): Promise<boolean> {
  if (!w.config.listId) return true;
  if (!confirm('Remove this list widget? The list and its items will be deleted on all devices.')) return false;
  const itemIds = (await db.items.where('listId').equals(w.config.listId).primaryKeys()) as string[];
  await remove('items', itemIds);
  await remove('lists', [w.config.listId]);
  return true;
}
