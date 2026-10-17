import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { differenceInCalendarDays, format, getDaysInMonth } from 'date-fns';
import { db } from '../db.ts';
import { create, remove, update } from '../data.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { BirthdayRec } from '../../../shared/src/types.ts';

/** Next occurrence on or after today. Feb 29 falls on Feb 28 in non-leap years. */
export function nextBirthday(b: Pick<BirthdayRec, 'month' | 'day'>, today: Date): Date {
  const at = (year: number) => new Date(year, b.month - 1, Math.min(b.day, getDaysInMonth(new Date(year, b.month - 1))));
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const thisYear = at(t.getFullYear());
  return thisYear >= t ? thisYear : at(t.getFullYear() + 1);
}

function whenLabel(days: number) {
  if (days === 0) return 'Today 🎉';
  if (days === 1) return 'Tomorrow';
  return `in ${days} days`;
}

export function BirthdaysWidget({ editing, onRemove }: WidgetProps) {
  const birthdays = useLiveQuery(() => db.birthdays.filter((b) => !b.deleted).toArray(), [], [] as BirthdayRec[]);
  const [form, setForm] = useState<BirthdayRec | 'new' | null>(null);
  const today = new Date();

  const rows = birthdays
    .map((b) => {
      const next = nextBirthday(b, today);
      return { b, next, days: differenceInCalendarDays(next, today), age: b.year ? next.getFullYear() - b.year : null };
    })
    .sort((x, y) => x.days - y.days || x.b.name.localeCompare(y.b.name));

  return (
    <WidgetFrame
      title="Birthdays"
      icon="🎂"
      editing={editing}
      onRemove={onRemove}
      actions={
        <button className="icon-btn" title="Add birthday" onClick={() => setForm(form ? null : 'new')}>
          ＋
        </button>
      }
    >
      {form ? (
        <BirthdayForm key={form === 'new' ? 'new' : form.id} birthday={form === 'new' ? null : form} onDone={() => setForm(null)} />
      ) : (
        <ul className="birthdays">
          {rows.map(({ b, next, days, age }) => (
            <li key={b.id} className={days === 0 ? 'is-today' : days <= 7 ? 'soon' : ''} onClick={() => setForm(b)} title="Edit">
              <span className="bd-date">
                <strong>{format(next, 'd')}</strong>
                <small>{format(next, 'MMM')}</small>
              </span>
              <span className="bd-info">
                <span className="bd-name">{b.name}</span>
                {age !== null && <span className="bd-age">turns {age}</span>}
              </span>
              <span className="bd-when">{whenLabel(days)}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="empty">No birthdays yet — click ＋</li>}
        </ul>
      )}
    </WidgetFrame>
  );
}

function BirthdayForm({ birthday, onDone }: { birthday: BirthdayRec | null; onDone: () => void }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const [name, setName] = useState(birthday?.name ?? '');
  // Year-less birthdays are edited with a placeholder leap year so Feb 29 stays selectable.
  const [date, setDate] = useState(birthday ? `${birthday.year ?? 2000}-${pad(birthday.month)}-${pad(birthday.day)}` : '');
  const [yearKnown, setYearKnown] = useState(birthday ? birthday.year !== null : true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!name.trim() || !m) return;
    const fields = { name: name.trim(), year: yearKnown ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]) };
    if (birthday) await update('birthdays', birthday.id, fields);
    else await create('birthdays', fields);
    onDone();
  }

  async function del() {
    if (birthday && confirm(`Delete ${birthday.name}'s birthday?`)) {
      await remove('birthdays', [birthday.id]);
      onDone();
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input autoFocus placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <label className="check">
          <input type="checkbox" checked={!yearKnown} onChange={(e) => setYearKnown(!e.target.checked)} /> Year unknown
        </label>
      </div>
      <div className="row">
        <button type="submit" className="primary">
          {birthday ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        {birthday && (
          <button type="button" className="danger push-right" onClick={del}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
