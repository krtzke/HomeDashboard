import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.ts';
import { remove, update } from '../data.ts';
import { COLOR_HEX } from '../colors.ts';
import { renderMarkdown } from '../markdown.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import { EVENT_COLORS } from '../../../shared/src/types.ts';
import type { WidgetRec } from '../../../shared/src/types.ts';

const SAVE_DELAY_MS = 600;

export function NoteWidget({ widget, editing, onRemove }: WidgetProps) {
  const noteId = widget.config.noteId ?? '';
  const note = useLiveQuery(() => db.notes.get(noteId), [noteId]);
  /** null = viewing; otherwise the text being edited (kept locally so incoming syncs don't disturb typing). */
  const [draft, setDraft] = useState<string | null>(null);
  const [showColors, setShowColors] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Selection to restore once React has updated the textarea (after toolbar actions). */
  const pendingSel = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta || !pendingSel.current) return;
    ta.focus();
    ta.setSelectionRange(...pendingSel.current);
    pendingSel.current = null;
  });

  const flush = () => {
    clearTimeout(saveTimer.current);
    if (pending.current !== null) void update('notes', noteId, { text: pending.current });
    pending.current = null;
  };
  // Save unsaved text if the widget unmounts mid-edit.
  useEffect(() => flush, [noteId]);

  const rendered = useMemo(() => renderMarkdown(note?.text ?? ''), [note?.text]);

  function change(text: string) {
    setDraft(text);
    pending.current = text;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
  }

  function startEditing() {
    const text = note?.text ?? '';
    setDraft(text);
    pendingSel.current = [text.length, text.length];
  }

  function stopEditing() {
    flush();
    setDraft(null);
    setShowColors(false);
  }

  /** Replaces the selection (or a placeholder) with before+text+after and selects the inner text. */
  function wrap(before: string, after: string, placeholder = 'text', select?: 'url') {
    const ta = taRef.current;
    if (!ta || draft === null) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const inner = draft.slice(s, e) || placeholder;
    change(draft.slice(0, s) + before + inner + after + draft.slice(e));
    let from = s + before.length;
    let to = from + inner.length;
    if (select === 'url') {
      from = to + 2; // after "]("
      to = from + after.length - 3;
    }
    pendingSel.current = [from, to];
  }

  /** Adds (or removes) a prefix at the start of the current line. */
  function linePrefix(prefix: string) {
    const ta = taRef.current;
    if (!ta || draft === null) return;
    const s = ta.selectionStart;
    const lineStart = draft.lastIndexOf('\n', s - 1) + 1;
    const has = draft.startsWith(prefix, lineStart);
    change(has ? draft.slice(0, lineStart) + draft.slice(lineStart + prefix.length) : draft.slice(0, lineStart) + prefix + draft.slice(lineStart));
    const pos = s + (has ? -prefix.length : prefix.length);
    pendingSel.current = [pos, pos];
  }

  function insertLink() {
    const ta = taRef.current;
    if (!ta || draft === null) return;
    const sel = draft.slice(ta.selectionStart, ta.selectionEnd);
    // Selected a URL → use it as the target; otherwise use the selection as the label.
    if (/^(https?:\/\/|www\.)/i.test(sel)) wrap('[link](', ')', sel);
    else wrap('[', '](https://)', 'link text', 'url');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') return stopEditing();
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    const actions: Record<string, () => void> = {
      b: () => wrap('**', '**'),
      i: () => wrap('*', '*'),
      u: () => wrap('++', '++'),
      k: insertLink,
      enter: stopEditing,
    };
    if (e.shiftKey && k === 'x') actions.x = () => wrap('~~', '~~');
    if (actions[k]) {
      e.preventDefault();
      actions[k]();
    }
  }

  async function rename() {
    const title = prompt('Note title', note?.title)?.trim();
    if (title && note) await update('notes', note.id, { title });
  }

  const isEditingText = draft !== null;
  const title = editing ? (
    <button className="link-btn" onClick={rename} title="Rename note">
      {note?.title ?? 'Notes'} ✎
    </button>
  ) : (
    (note?.title ?? 'Notes')
  );

  return (
    <WidgetFrame
      title={title}
      icon="📝"
      editing={editing}
      onRemove={() => {
        flush();
        onRemove();
      }}
      actions={
        isEditingText ? (
          <button className="small primary" onClick={stopEditing} title="Done (Ctrl+Enter)">
            Done
          </button>
        ) : (
          <button className="icon-btn" onClick={startEditing} title="Edit note">
            ✎
          </button>
        )
      }
    >
      {isEditingText ? (
        <div className="note-editor">
          <div className="note-toolbar">
            <button className="tb" title="Bold (Ctrl+B)  **text**" onClick={() => wrap('**', '**')}>
              <strong>B</strong>
            </button>
            <button className="tb" title="Italic (Ctrl+I)  *text*" onClick={() => wrap('*', '*')}>
              <em>I</em>
            </button>
            <button className="tb" title="Underline (Ctrl+U)  ++text++" onClick={() => wrap('++', '++')}>
              <u>U</u>
            </button>
            <button className="tb" title="Strikethrough (Ctrl+Shift+X)  ~~text~~" onClick={() => wrap('~~', '~~')}>
              <s>S</s>
            </button>
            <button className="tb" title="Text color  {red|text}" onClick={() => setShowColors((v) => !v)}>
              <span className="tb-color">A</span>
            </button>
            <button className="tb" title="Link (Ctrl+K)  [text](https://…)" onClick={insertLink}>
              🔗
            </button>
            <span className="tb-sep" />
            <button className="tb" title="Heading  # " onClick={() => linePrefix('# ')}>
              H
            </button>
            <button className="tb" title="Bullet list  - " onClick={() => linePrefix('- ')}>
              •
            </button>
            <button className="tb" title="Numbered list  1. " onClick={() => linePrefix('1. ')}>
              1.
            </button>
            <button className="tb" title="Quote  > " onClick={() => linePrefix('> ')}>
              ❝
            </button>
          </div>
          {showColors && (
            <div className="swatches">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  title={c}
                  aria-label={c}
                  style={{ background: COLOR_HEX[c] }}
                  onClick={() => {
                    wrap(`{${c}|`, '}');
                    setShowColors(false);
                  }}
                />
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            className="note-text"
            value={draft}
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={'Write something…\n\n**bold**  *italic*  ++underline++  ~~strike~~\n{red|colored}  [link](https://…)\n- list item'}
            spellCheck
          />
        </div>
      ) : (
        <div className="note-view" onDoubleClick={startEditing}>
          {rendered.length ? rendered : <p className="empty" onClick={startEditing}>Empty note — click ✎ to write</p>}
        </div>
      )}
    </WidgetFrame>
  );
}

/** Called when the widget is removed: deletes the note (on all devices), asking first if it has text. */
export async function cleanupNote(w: WidgetRec): Promise<boolean> {
  if (!w.config.noteId) return true;
  const note = await db.notes.get(w.config.noteId);
  if (note?.text.trim() && !confirm(`Remove the note "${note.title}"? Its text will be deleted on all devices.`)) return false;
  await remove('notes', [w.config.noteId]);
  return true;
}
