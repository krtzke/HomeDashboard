// A small, safe Markdown renderer for notes. It builds React elements (never raw HTML),
// so synced note text can't inject markup or scripts.
//
// Block syntax:  # / ## / ### heading,  - bullet,  1. numbered,  > quote,  --- rule
// Inline syntax: **bold**  *italic*  ++underline++  ~~strike~~  `code`
//                {red|colored text}  [label](https://url)  bare https://links
import { createElement as h, type ReactNode } from 'react';
import { COLOR_HEX } from './colors.ts';
import type { EventColor } from '../../shared/src/types.ts';

const COLOR_NAMES = Object.keys(COLOR_HEX).join('|');

type InlineRule = {
  re: RegExp;
  render: (m: RegExpExecArray, key: string) => ReactNode;
};

/** Only allow harmless link targets; "www.x.y" gets https:// prepended. */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (/^www\.[^\s]+\.[^\s]+/i.test(url)) return `https://${url}`;
  return null;
}

const link = (href: string, children: ReactNode, key: string) =>
  h('a', { key, href, target: '_blank', rel: 'noopener noreferrer' }, children);

// Earlier rules win when two matches start at the same position (e.g. ** before *).
const INLINE_RULES: InlineRule[] = [
  { re: /`([^`\n]+)`/, render: (m, k) => h('code', { key: k }, m[1]) },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    render: (m, k) => {
      const href = safeHref(m[2]);
      return href ? link(href, inline(m[1], k), k) : h('span', { key: k }, m[0]);
    },
  },
  {
    re: /\b(?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;!?"')\]]/,
    render: (m, k) => link(safeHref(m[0])!, m[0], k),
  },
  { re: /\*\*(.+?)\*\*/, render: (m, k) => h('strong', { key: k }, inline(m[1], k)) },
  { re: /\+\+(.+?)\+\+/, render: (m, k) => h('u', { key: k }, inline(m[1], k)) },
  { re: /~~(.+?)~~/, render: (m, k) => h('s', { key: k }, inline(m[1], k)) },
  { re: /\*([^*\s](?:.*?[^*\s])?)\*/, render: (m, k) => h('em', { key: k }, inline(m[1], k)) },
  {
    re: new RegExp(`\\{(${COLOR_NAMES})\\|(.+?)\\}`),
    render: (m, k) => h('span', { key: k, style: { color: COLOR_HEX[m[1] as EventColor] } }, inline(m[2], k)),
  },
];

/** Renders inline formatting by repeatedly taking the earliest match. */
export function inline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { m: RegExpExecArray; rule: InlineRule } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyPrefix}.${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

/** Joins lines with <br>, rendering inline formatting per line. */
function lines(ls: string[], key: string): ReactNode[] {
  return ls.flatMap((l, i) => (i ? [h('br', { key: `${key}br${i}` }), ...inline(l, `${key}l${i}`)] : inline(l, `${key}l${i}`)));
}

export function renderMarkdown(text: string): ReactNode[] {
  const src = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    const key = `b${i}`;
    let m: RegExpMatchArray | null;

    if (!line.trim()) {
      i++;
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      blocks.push(h(`h${m[1].length + 2}`, { key }, inline(m[2], key)));
      i++;
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(h('hr', { key }));
      i++;
    } else if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const itemRe = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: ReactNode[] = [];
      while (i < src.length && itemRe.test(src[i])) {
        items.push(h('li', { key: `${key}-${i}` }, inline(src[i].match(itemRe)![1], `${key}-${i}`)));
        i++;
      }
      blocks.push(h(ordered ? 'ol' : 'ul', { key }, items));
    } else if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < src.length && /^>\s?/.test(src[i])) quoted.push(src[i++].replace(/^>\s?/, ''));
      blocks.push(h('blockquote', { key }, lines(quoted, key)));
    } else {
      // Paragraph: consecutive plain lines, kept as line breaks.
      const para: string[] = [];
      while (
        i < src.length &&
        src[i].trim() &&
        !/^(#{1,3}\s|>|\s*[-*]\s|\s*\d+[.)]\s|\s*(-{3,}|\*{3,})\s*$)/.test(src[i])
      ) {
        para.push(src[i++]);
      }
      blocks.push(h('p', { key }, lines(para, key)));
    }
  }
  return blocks;
}
