import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown, safeHref } from '../src/markdown.ts';

const html = (md: string) => renderToStaticMarkup(createElement('div', null, renderMarkdown(md)));

test('inline formatting', () => {
  assert.equal(
    html('**b** *i* ++u++ ~~s~~ `c`'),
    '<div><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p></div>',
  );
});

test('nested formatting and colors', () => {
  assert.equal(
    html('{red|**urgent** ~~old~~}'),
    '<div><p><span style="color:#e5484d"><strong>urgent</strong> <s>old</s></span></p></div>',
  );
});

test('links: markdown, bare and www', () => {
  const out = html('[Docs](https://example.com) see https://a.b/c?d=1. or www.x.de');
  assert.match(out, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">Docs<\/a>/);
  assert.match(out, /<a href="https:\/\/a.b\/c\?d=1"[^>]*>https:\/\/a.b\/c\?d=1<\/a>\. or/);
  assert.match(out, /<a href="https:\/\/www.x.de"[^>]*>www.x.de<\/a>/);
});

test('unsafe links and HTML are not rendered', () => {
  const out = html('[x](javascript:alert(1)) <img src=x onerror=alert(1)> <script>bad()</script>');
  assert.ok(!out.includes('href="javascript'));
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.equal(safeHref('data:text/html,hi'), null);
});

test('blocks: headings, lists, quote, rule, paragraphs', () => {
  assert.equal(
    html('# Title\n- a\n- **b**\n\n1. one\n2. two\n> quote\n---\nline 1\nline 2'),
    '<div><h3>Title</h3><ul><li>a</li><li><strong>b</strong></li></ul><ol><li>one</li><li>two</li></ol>' +
      '<blockquote>quote</blockquote><hr/><p>line 1<br/>line 2</p></div>',
  );
});

test('stray markers stay as text', () => {
  assert.equal(html('2 * 3 * 4 and snake_case_name'), '<div><p>2 * 3 * 4 and snake_case_name</p></div>');
});
