import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.ts';
import { create, remove, update, updateMany } from '../data.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { ItemRec, WidgetRec } from '../../../shared/src/types.ts';

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

  const open = items.filter((i) => !i.checked).sort((a, b) => a.sortOrder - b.sortOrder);
  const done = items.filter((i) => i.checked).sort((a, b) => a.sortOrder - b.sortOrder);

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const maxOrder = items.reduce((m, i) => Math.max(m, i.sortOrder), 0);
    await create('items', { listId, text: value, checked: false, persistent, sortOrder: maxOrder + 1 });
    setText('');
  }

  /** One-time items are removed, persistent items are unchecked for the next round. */
  async function clearChecked() {
    await remove('items', done.filter((i) => !i.persistent).map((i) => i.id));
    await updateMany('items', done.filter((i) => i.persistent).map((i) => i.id), () => ({ checked: false }));
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
        done.length > 0 && (
          <button className="small" onClick={clearChecked} title="Remove checked one-time items, uncheck persistent ones">
            Clear checked ({done.length})
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
        {[...open, ...done].map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
        {items.length === 0 && <li className="empty">Nothing here yet</li>}
      </ul>
    </WidgetFrame>
  );
}

function ItemRow({ item }: { item: ItemRec }) {
  return (
    <li className={`item${item.checked ? ' checked' : ''}`}>
      <label>
        <input type="checkbox" checked={item.checked} onChange={(e) => update('items', item.id, { checked: e.target.checked })} />
        <span>{item.text}</span>
      </label>
      <button
        className={`icon-btn pin${item.persistent ? ' active' : ''}`}
        title={item.persistent ? 'Persistent (click to make one-time)' : 'One-time (click to make persistent)'}
        onClick={() => update('items', item.id, { persistent: !item.persistent })}
      >
        📌
      </button>
      <button className="icon-btn subtle" title="Delete" onClick={() => remove('items', [item.id])}>
        ✕
      </button>
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
