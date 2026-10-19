// To add a new widget type: add it to WidgetType in shared/src/types.ts and register it here.
import type { FC } from 'react';
import type { WidgetRec, WidgetType } from '../../../shared/src/types.ts';
import type { WidgetProps } from './WidgetFrame.tsx';
import { ListWidget, cleanupList } from './ListWidget.tsx';
import { CalendarWidget } from './CalendarWidget.tsx';
import { TimelineWidget } from './TimelineWidget.tsx';
import { TimerWidget } from './TimerWidget.tsx';
import { NoteWidget, cleanupNote } from './NoteWidget.tsx';
import { ClockWidget } from './ClockWidget.tsx';
import { CountdownWidget } from './CountdownWidget.tsx';
import { LinksWidget } from './LinksWidget.tsx';
import { ChoresWidget, cleanupChores } from './ChoresWidget.tsx';
import { BirthdaysWidget } from './BirthdaysWidget.tsx';
import { WeatherWidget } from './WeatherWidget.tsx';
import { WasteWidget } from './WasteWidget.tsx';
import { SystemWidget } from './SystemWidget.tsx';
import { WakeWidget } from './WakeWidget.tsx';

export interface WidgetDef {
  label: string;
  component: FC<WidgetProps>;
  size: { w: number; h: number; minW: number; minH: number };
  /** Deletes data owned by the widget before it's removed. Return false to cancel the removal. */
  cleanup?: (w: WidgetRec) => Promise<boolean>;
}

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  list: { label: 'List (To-Do / Shopping)', component: ListWidget, size: { w: 3, h: 9, minW: 2, minH: 4 }, cleanup: cleanupList },
  calendar: { label: 'Calendar', component: CalendarWidget, size: { w: 3, h: 9, minW: 3, minH: 7 } },
  timeline: { label: 'Day timeline', component: TimelineWidget, size: { w: 3, h: 9, minW: 2, minH: 5 } },
  timer: { label: 'Timers', component: TimerWidget, size: { w: 3, h: 6, minW: 2, minH: 4 } },
  note: { label: 'Notepad', component: NoteWidget, size: { w: 3, h: 8, minW: 2, minH: 4 }, cleanup: cleanupNote },
  clock: { label: 'Clock & date', component: ClockWidget, size: { w: 3, h: 5, minW: 2, minH: 3 } },
  countdown: { label: 'Countdown', component: CountdownWidget, size: { w: 3, h: 6, minW: 2, minH: 3 } },
  links: { label: 'Quick links', component: LinksWidget, size: { w: 3, h: 5, minW: 2, minH: 3 } },
  chores: { label: 'Recurring chores', component: ChoresWidget, size: { w: 3, h: 8, minW: 2, minH: 4 }, cleanup: cleanupChores },
  birthdays: { label: 'Birthdays', component: BirthdaysWidget, size: { w: 3, h: 7, minW: 2, minH: 4 } },
  weather: { label: 'Weather', component: WeatherWidget, size: { w: 3, h: 9, minW: 2, minH: 5 } },
  waste: { label: 'Waste collection', component: WasteWidget, size: { w: 3, h: 7, minW: 2, minH: 4 } },
  system: { label: 'Pi status', component: SystemWidget, size: { w: 3, h: 7, minW: 2, minH: 5 } },
  wake: { label: 'Wake PC (Wake-on-LAN)', component: WakeWidget, size: { w: 3, h: 4, minW: 2, minH: 3 } },
};
