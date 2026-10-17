// Recognises common (mostly German) waste types from calendar entry titles.

export interface WasteStyle {
  emoji: string;
  color: string;
}

const RULES: [RegExp, WasteStyle][] = [
  [/weihnacht|tannenbaum|christbaum/i, { emoji: '🎄', color: '#22a35a' }],
  [/sperr/i, { emoji: '🛋️', color: '#f08c00' }],
  [/schadstoff|problemabfall|sondermüll|hazard/i, { emoji: '☣️', color: '#e5484d' }],
  [/bio|organic|compost/i, { emoji: '🟤', color: '#8b5a2b' }],
  [/grün|garten|laub|baum|strauch|green waste|garden/i, { emoji: '🌿', color: '#22a35a' }],
  [/papier|pappe|karton|blaue|paper/i, { emoji: '🔵', color: '#3b82f6' }],
  [/gelb|wertstoff|verpackung|lvp|recycl|plastic/i, { emoji: '🟡', color: '#e8b500' }],
  [/glas|glass/i, { emoji: '🟢', color: '#12a594' }],
  [/rest|grau|schwarz|hausmüll|residual|general/i, { emoji: '⚫', color: '#6e7781' }],
];

export function wasteStyle(summary: string): WasteStyle {
  return RULES.find(([re]) => re.test(summary))?.[1] ?? { emoji: '🗑️', color: '#8b8d98' };
}
