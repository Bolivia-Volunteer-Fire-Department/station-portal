// The rich document editor's engine: markdown in, editable HTML out, and back again.
//
// WHY THIS EXISTS. Markdown is what a document IS - it is what the sheet stores and what components/Markdown.jsx
// renders - so a WYSIWYG editor here must not introduce a second dialect, or "what you see" would stop being what
// a member reads. Two rules keep that promise:
//
//   * The BLOCK MODEL is the editor's own, but it is built from the SAME parser the preview uses
//     (utils/markdown), including the inline markdown each block was parsed from. The editor renders `**bold**`
//     with the parser the reader will, so a construct the preview understands cannot be invisible here.
//   * The editable HTML is GENERATED here and never hand-authored, and every block carries a `data-block` kind.
//     The reverse direction reads those kinds rather than guessing from tags, which is what makes the round trip
//     exact instead of approximately right.
//
// Everything here is pure: strings and plain objects, no DOM, no React, no browser. The component that hosts the
// contenteditable surface is deliberately thin because of it - and this file is why the editor can be tested at
// all (scripts/verify-rich-markdown.mjs runs in node, where there is no DOM to test against).

import { ALERT_KINDS, parseInline, parseMarkdown } from './markdown';
import { BLOCK_CLASSES, CALLOUT_CLASSES, INLINE_CLASSES, headingClass } from './markdownStyles';

// ---------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------
// One table, three readers: the toolbar renders it, the command dispatcher switches on it, and the verifier
// asserts every entry is actually handled. A button that does nothing is therefore a test failure rather than
// something an author finds out about after clicking it.
//
// `icon` is a NAME, not a component: this module stays free of React, and the component maps the name to a lucide
// icon. The verifier checks that every name here has a mapping there, so the two cannot drift apart.
//
// `mode` says which surface the action knows how to drive: 'inline' wraps the selection, 'block' changes the
// paragraph's kind, and 'insert' adds a new block at the cursor.
export const INLINE_ACTIONS = [
  { id: 'bold', label: 'Bold', icon: 'Bold', mode: 'inline', syntax: '**' },
  { id: 'italic', label: 'Italic', icon: 'Italic', mode: 'inline', syntax: '*' },
  { id: 'highlight', label: 'Highlight', icon: 'Highlighter', mode: 'inline', syntax: '==' },
  { id: 'code', label: 'Inline code', icon: 'Code', mode: 'inline', syntax: '`' },
  { id: 'link', label: 'Link', icon: 'Link', mode: 'inline' },
];

export const BLOCK_ACTIONS = [
  { id: 'paragraph', label: 'Normal text', icon: 'Pilcrow', mode: 'block' },
  { id: 'heading', label: 'Heading 1', icon: 'Heading1', mode: 'block', level: 1 },
  { id: 'heading', label: 'Heading 2', icon: 'Heading2', mode: 'block', level: 2 },
  { id: 'heading', label: 'Heading 3', icon: 'Heading3', mode: 'block', level: 3 },
  { id: 'bullet', label: 'Bulleted list', icon: 'List', mode: 'block', ordered: false },
  { id: 'numbered', label: 'Numbered list', icon: 'ListOrdered', mode: 'block', ordered: true },
  { id: 'quote', label: 'Quote', icon: 'TextQuote', mode: 'block' },
  { id: 'codeBlock', label: 'Code block', icon: 'SquareCode', mode: 'block' },
];

export const INSERT_ACTIONS = [
  { id: 'table', label: 'Table', icon: 'Table', mode: 'insert' },
  { id: 'rule', label: 'Divider', icon: 'Minus', mode: 'insert' },
];

// The five callouts are one action with five answers, and they come from the PARSER's own list - so the editor can
// never offer a box the preview would not draw.
export const CALLOUT_ACTIONS = ALERT_KINDS.map((kind) => ({
  id: 'callout',
  callout: kind,
  label: `Callout: ${kind}`,
  mode: 'block',
}));

// The table's own toolbar: the five things an author wants to do to a grid, which the main toolbar could not offer
// because a table is the only block whose SHAPE is editable.
//
// WHY THIS IS A THIRD `mode`. The main toolbar's actions change what a block IS (a heading, a list, a quote) or insert a
// new one, and every one of them is meaningful on a paragraph. These are meaningful only INSIDE a table and refer to the
// cell the caret is in, so they are a group of their own: the component shows them only while the caret is in a table,
// and the verifier knows not to demand that "Add column" do something to a paragraph.
//
// DECLARED ABOVE `EDITOR_ACTIONS`, which spreads it. A `const` is not hoisted, so declaring it below was not a style
// mistake - it was a `TypeError: TABLE_ACTIONS is not iterable` at module load, and the kind of thing the verifier
// catches for free by importing this file.
export const TABLE_ACTIONS = [
  { id: 'tableAddRow', label: 'Add row below', icon: 'TableRowAdd', mode: 'table' },
  { id: 'tableAddColumn', label: 'Add column right', icon: 'TableColumnAdd', mode: 'table' },
  { id: 'tableRemoveRow', label: 'Delete this row', icon: 'TableRowRemove', mode: 'table' },
  { id: 'tableRemoveColumn', label: 'Delete this column', icon: 'TableColumnRemove', mode: 'table' },
  { id: 'tableRemove', label: 'Delete the table', icon: 'TableRemove', mode: 'table' },
];

export const EDITOR_ACTIONS = [...INLINE_ACTIONS, ...BLOCK_ACTIONS, ...CALLOUT_ACTIONS, ...INSERT_ACTIONS, ...TABLE_ACTIONS];

// Every action id the dispatcher must handle, for the verifier to check the toolbar against.
export const ACTION_IDS = [...new Set(EDITOR_ACTIONS.map((action) => action.id))].sort();

// A new table's shape. Three columns by default because the tables in these guides are two or three wide, and two
// body rows so the divider is visibly a divider. Cells start empty and the caret lands in the first one.
export const NEW_TABLE_COLUMNS = 3;
export const NEW_TABLE_ROWS = 2;

// ---------------------------------------------------------------------------
// The block model
// ---------------------------------------------------------------------------
// Deliberately close to the parser's own shapes, with one difference that matters: a block carries its INLINE
// MARKDOWN as text (`text`, `items`, `head`/`rows`) rather than parsed tokens. The editor needs the markdown
// because it hands it straight back to the parser when rendering, and because that is what gets written to the
// sheet. Regenerating markdown from tokens would quietly rewrite what an author typed (`_a_` becoming `*a*`).
export const emptyParagraph = () => ({ type: 'paragraph', text: '' });

const tableLine = (cells) => `| ${cells.map((cell) => String(cell ?? '').trim()).join(' | ')} |`;

// The editor's blocks -> markdown. This is the canonical form: bullets are always `-` and numbers always restart
// at 1, because the numbers are decoration and a stored document should not argue about them.
export const blocksToMarkdown = (blocks) => {
  const parts = [];

  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(block.level) || 1));
        parts.push(`${'#'.repeat(level)} ${String(block.text ?? '').trim()}`);
        break;
      }
      case 'list': {
        const items = Array.isArray(block.items) ? block.items : [];
        parts.push(
          items
            .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${String(item ?? '').trim()}`)
            .join('\n')
        );
        break;
      }
      case 'quote':
        parts.push(`> ${String(block.text ?? '').trim()}`);
        break;
      case 'callout': {
        // A callout is a blockquote carrying a marker, so its body is quoted again - and a body of several blocks
        // is separated by the blank `>` line the parser reads as a paragraph break.
        const body = blocksToMarkdown(block.blocks || []);
        const quoted = body
          ? body
              .split('\n\n')
              .map((chunk) => chunk.split('\n').map((line) => `> ${line}`).join('\n'))
              .join('\n>\n')
          : '';
        parts.push(`> [!${String(block.kind || 'note').toUpperCase()}]${quoted ? `\n${quoted}` : ''}`);
        break;
      }
      case 'code':
        parts.push(`\`\`\`${block.language || ''}\n${block.value ?? ''}\n\`\`\``);
        break;
      case 'table': {
        const head = Array.isArray(block.head) ? block.head : [];
        const rows = Array.isArray(block.rows) ? block.rows : [];
        // Every row is padded to the header's width: a short row would otherwise become a table the parser reads
        // with fewer columns than the row above it.
        const width = Math.max(head.length, ...rows.map((row) => row.length), 1);
        const pad = (cells) => {
          const padded = (cells || []).slice(0, width);
          while (padded.length < width) padded.push('');
          return padded;
        };
        parts.push(
          [tableLine(pad(head)), `|${' --- |'.repeat(width)}`, ...rows.map((row) => tableLine(pad(row)))].join('\n')
        );
        break;
      }
      case 'rule':
        parts.push('---');
        break;
      default:
        parts.push(String(block.text ?? '').trim());
        break;
    }
  });

  // An empty paragraph is a place to put the caret, not content: it never reaches the sheet, which is why a
  // document of nothing but blank lines stores as an empty document.
  return parts.filter((part) => part !== '').join('\n\n');
};

// The parser's blocks -> the editor's, keeping the inline markdown and dropping the tokens.
//
// Recursive because a callout's body is itself a list of blocks, and those are PARSER blocks - the same conversion
// has to happen to them. Passing them through blocksToMarkdown instead would read `text` off a block that keeps
// `children`, which is how a callout body silently loses its first paragraph.
const editorBlockFromParsed = (block) => {
  switch (block.type) {
    case 'heading':
      return { type: 'heading', level: block.level, text: block.inlineSource || '' };
    case 'list':
      return { type: 'list', ordered: Boolean(block.ordered), items: (block.itemSources || []).slice() };
    case 'quote':
      return { type: 'quote', text: block.inlineSource || '' };
    case 'alert':
      return {
        type: 'callout',
        kind: ALERT_KINDS.indexOf(block.kind) === -1 ? 'note' : block.kind,
        blocks: (block.blocks || []).map(editorBlockFromParsed),
      };
    case 'code':
      return { type: 'code', language: block.language || '', value: block.value || '' };
    case 'table':
      return {
        type: 'table',
        head: (block.headSources || []).slice(),
        rows: (block.rowSources || []).map((row) => row.slice()),
      };
    case 'rule':
      return { type: 'rule' };
    default:
      return { type: 'paragraph', text: block.inlineSource || '' };
  }
};

export const editorBlocksFromMarkdown = (markdown) => parseMarkdown(markdown).map(editorBlockFromParsed);

// ---------------------------------------------------------------------------
// Inline markdown -> HTML
// ---------------------------------------------------------------------------
const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const htmlFromTokens = (tokens) => (tokens || []).map(htmlFromToken).join('');

const htmlFromToken = (token) => {
  switch (token.type) {
    case 'text':
      return escapeHtml(token.value);
    case 'bold':
      return `<strong>${htmlFromTokens(token.children)}</strong>`;
    case 'italic':
      return `<em>${htmlFromTokens(token.children)}</em>`;
    case 'code':
      return `<code class="${INLINE_CLASSES.code}">${escapeHtml(token.value)}</code>`;
    case 'color':
      return `<mark class="${INLINE_CLASSES.highlight}">${htmlFromTokens(token.children)}</mark>`;
    case 'link':
      return `<a class="${INLINE_CLASSES.link}" href="${escapeHtml(token.href)}">${htmlFromTokens(token.children)}</a>`;
    default:
      return '';
  }
};

// Inline markdown as the HTML an author edits. This is the SAME parseInline the preview uses, so a construct the
// reader understands cannot be invisible in the editor.
export const inlineHtml = (markdown) => htmlFromTokens(parseInline(markdown));

// ---------------------------------------------------------------------------
// Blocks -> editable HTML
// ---------------------------------------------------------------------------
// Every block carries `data-block` and `data-index`. The kind is what makes the reverse direction exact (tags alone
// could not tell an empty paragraph from an empty list item), and the index is how the caret is put back after a
// command re-renders the surface.
const blockAttrs = (index, kind) => ` data-block="${kind}" data-index="${index}"`;

const headingHtml = (block, index) => {
  const level = Math.min(6, Math.max(1, Number(block.level) || 1));
  return (
    `<p${blockAttrs(index, 'heading')} data-level="${level}" class="${headingClass(level)}">` +
    `${inlineHtml(block.text) || '<br>'}</p>`
  );
};

const listHtml = (block, index) => {
  const tag = block.ordered ? 'ol' : 'ul';
  const items = (Array.isArray(block.items) ? block.items : [''])
    .map((item) => `<li>${inlineHtml(item) || '<br>'}</li>`)
    .join('');
  return (
    `<${tag}${blockAttrs(index, 'list')} class="${BLOCK_CLASSES.list} ${
      block.ordered ? BLOCK_CLASSES.numbers : BLOCK_CLASSES.bullets
    }">${items || '<li><br></li>'}</${tag}>`
  );
};

const calloutHtml = (block, index) => {
  const kind = CALLOUT_CLASSES[block.kind] ? block.kind : 'note';
  const style = CALLOUT_CLASSES[kind];
  const body = (Array.isArray(block.blocks) ? block.blocks : []).map(blockToHtml).join('');
  return (
    `<div${blockAttrs(index, 'callout')} data-kind="${kind}" class="${BLOCK_CLASSES.calloutBox} ${style.box}">` +
    // The head is DRAWN, not typed: it says what kind of box this is, so it must not be editable content - and the
    // reader skips it by this attribute rather than by position, so it cannot end up in the document's text.
    `<p data-callout-head="1" contenteditable="false" class="${BLOCK_CLASSES.calloutHead} ${style.head}">${style.label}</p>` +
    `<div class="${BLOCK_CLASSES.calloutBody}">${body || '<p data-block="paragraph" data-index="0"><br></p>'}</div>` +
    `</div>`
  );
};

const tableHtml = (block, index) => {
  const head = Array.isArray(block.head) ? block.head : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  const width = Math.max(head.length, ...rows.map((row) => row.length), 1);
  const pad = (cells) => {
    const padded = (cells || []).slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  };
  const cell = (tag, value) =>
    `<${tag} class="${tag === 'th' ? BLOCK_CLASSES.tableHeadCell : BLOCK_CLASSES.tableCell}">${
      inlineHtml(value) || '<br>'
    }</${tag}>`;
  const row = (cells, tag) =>
    `<tr class="${tag === 'th' ? BLOCK_CLASSES.tableHeadRow : BLOCK_CLASSES.tableRow}">${pad(cells)
      .map((value) => cell(tag, value))
      .join('')}</tr>`;

  return (
    `<div${blockAttrs(index, 'table')} class="${BLOCK_CLASSES.tableWrap}">` +
    `<table class="${BLOCK_CLASSES.table}">` +
    `<thead>${row(head, 'th')}</thead>` +
    `<tbody>${rows.length ? rows.map((cells) => row(cells, 'td')).join('') : row([], 'td')}</tbody>` +
    `</table></div>`
  );
};

// One block as HTML. Nested blocks (a callout's body) number from zero: a nested command re-renders from the model
// anyway, so their indices only have to be unique within the sequence they belong to.
export const blockToHtml = (block, index = 0) => {
  switch (block.type) {
    case 'heading':
      return headingHtml(block, index);
    case 'list':
      return listHtml(block, index);
    case 'quote':
      return `<blockquote${blockAttrs(index, 'quote')} class="${BLOCK_CLASSES.quote}">${
        inlineHtml(block.text) || '<br>'
      }</blockquote>`;
    case 'callout':
      return calloutHtml(block, index);
    case 'code':
      return (
        `<pre${blockAttrs(index, 'code')} data-language="${escapeHtml(block.language || '')}" class="${
          BLOCK_CLASSES.code
        }"><code>${escapeHtml(block.value ?? '')}</code></pre>`
      );
    case 'table':
      return tableHtml(block, index);
    case 'rule':
      return `<hr${blockAttrs(index, 'rule')} class="${BLOCK_CLASSES.rule}">`;
    default:
      return `<p${blockAttrs(index, 'paragraph')}>${inlineHtml(block.text) || '<br>'}</p>`;
  }
};

// The whole document as the editable surface's HTML.
export const htmlFromBlocks = (blocks) =>
  (Array.isArray(blocks) ? blocks : []).map((block, index) => blockToHtml(block, index)).join('\n');


// ---------------------------------------------------------------------------
// Editable HTML -> blocks
// ---------------------------------------------------------------------------
// A small tokenizer, not an HTML parser: the HTML was generated here and the browser only ever edits it in ways
// this vocabulary covers. Anything unrecognized is FLATTENED to its text rather than dropped, so nothing an author
// typed can disappear because a tag was unexpected - and nothing here can execute, because nothing here becomes
// anything but text.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'blockquote', 'ul', 'ol', 'li', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
]);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

export const decodeEntities = (text) =>
  String(text ?? '').replace(/&[a-zA-Z#0-9]+;/g, (entity) => {
    if (ENTITIES[entity] !== undefined) return ENTITIES[entity];
    const numeric = /^&#(\d+);$/.exec(entity);
    return numeric ? String.fromCharCode(Number(numeric[1])) : entity;
  });

const parseAttributes = (source) => {
  const attrs = {};
  const pattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;
  let match;

  while ((match = pattern.exec(source || '')) !== null) {
    const name = (match[1] || match[6] || '').toLowerCase();
    if (!name) continue;
    const value = match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5];
    attrs[name] = decodeEntities(value === undefined ? '1' : value);
  }

  return attrs;
};

export const tokenizeHtml = (html) => {
  const tokens = [];
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    if (match.index > last) tokens.push({ type: 'text', value: decodeEntities(html.slice(last, match.index)) });
    last = match.index + match[0].length;

    const name = match[2].toLowerCase();
    if (match[1] === '/') tokens.push({ type: 'close', name });
    else if (match[4] === '/' || VOID_TAGS.has(name)) {
      tokens.push({ type: 'open', name, attrs: parseAttributes(match[3]), void: true });
    } else tokens.push({ type: 'open', name, attrs: parseAttributes(match[3]) });
  }

  if (last < html.length) tokens.push({ type: 'text', value: decodeEntities(html.slice(last)) });
  return tokens;
};

// A cursor over the token stream, so the readers below read as prose rather than as index arithmetic.
const readerFor = (tokens) => ({
  tokens,
  index: 0,
  more: function () {
    return this.index < this.tokens.length;
  },
  peek: function () {
    return this.tokens[this.index];
  },
  next: function () {
    return this.tokens[this.index++];
  },
  // Skips a whole element, for content that is drawn rather than typed (a callout's head label).
  skipElement: function (name) {
    let depth = 1;
    while (this.more() && depth > 0) {
      const token = this.next();
      if (token.type === 'open' && token.name === name && !token.void) depth++;
      if (token.type === 'close' && token.name === name) depth--;
    }
  },
  // Looks at everything up to this element's closing tag without consuming it. Two questions need the answer
  // before the element's content is read: is it a container of blocks, or a paragraph (the browser nests bare
  // <div>s when the content is block-level), and does it hold a <br> (which is how it marks an empty paragraph it
  // wants to keep)?
  inspectElement: function (name) {
    // The opening tag has already been consumed, so depth 0 is this element's OWN content - which is what these
    // two questions are about.
    let depth = 0;
    let hasBlockChild = false;
    let hasBreak = false;

    for (let i = this.index; i < this.tokens.length; i += 1) {
      const token = this.tokens[i];
      if (token.type === 'text') continue;

      if (token.type === 'open') {
        if (token.name === name && !token.void) {
          depth += 1;
          continue;
        }
        if (depth === 0) {
          if (token.void) {
            if (token.name === 'br') hasBreak = true;
          } else if (BLOCK_TAGS.has(token.name) || HEADING_TAGS.has(token.name)) {
            hasBlockChild = true;
          }
        }
        continue;
      }

      if (token.type === 'close' && token.name === name) {
        if (depth === 0) break;
        depth -= 1;
      }
    }

    return { hasBlockChild, hasBreak };
  },
});

const INLINE_WRAPPERS = { strong: '**', b: '**', em: '*', i: '*', mark: '==', u: '' };

// Inline markdown from a run of tokens, stopping at a closing tag in `stops` or at the start of a block.
const readInline = (reader, stops) => {
  let out = '';

  while (reader.more()) {
    const token = reader.peek();

    if (token.type === 'close') {
      if (stops.has(token.name)) break;
      reader.next();
      continue;
    }

    if (token.type === 'open') {
      // An inline tag the toolbar did not add but the browser did (a `<span>` around a paste, say) is transparent:
      // its content counts, its tag does not.
      if (BLOCK_TAGS.has(token.name) || HEADING_TAGS.has(token.name)) break;

      reader.next();
      if (token.void) {
        if (token.name === 'br') out += ' ';
        continue;
      }

      const inner = readInline(reader, new Set([token.name]));
      if (token.name === 'code') {
        // Inline code holds no markdown: its text is literal, which is exactly what the parser does with a
        // backtick run.
        out += inner.includes('`') ? inner : `\`${inner}\``;
      } else if (token.name === 'a') {
        out += inner.includes(']') ? inner : `[${inner}](${token.attrs.href || ''})`;
      } else {
        const wrapper = INLINE_WRAPPERS[token.name];
        out += wrapper ? `${wrapper}${inner}${wrapper}` : inner;
      }
      continue;
    }

    reader.next();
    out += token.value;
  }

  return out;
};

const readListItems = (reader, listName) => {
  const items = [];

  while (reader.more()) {
    const token = reader.next();
    if (token.type === 'close' && token.name === listName) break;
    if (token.type === 'open' && token.name === 'li') items.push(readInline(reader, new Set(['li'])).trim());
  }

  return items.length ? items : [''];
};

const readTableRow = (reader, rowName) => {
  const cells = [];
  while (reader.more()) {
    const inner = reader.next();
    if (inner.type === 'close' && inner.name === rowName) break;
    if (inner.type === 'open' && (inner.name === 'td' || inner.name === 'th')) {
      cells.push(readInline(reader, new Set([inner.name])).trim());
    }
  }
  return cells;
};

// One block element, with its opening tag already consumed. Returns a block, an ARRAY of blocks (a bare <div>
// wrapping other blocks is a container, not a paragraph), or null for something with no content at all.
const readBlock = (reader, opening) => {
  const name = opening.name;
  const attrs = opening.attrs || {};

  if (name === 'hr') return { type: 'rule' };

  if (name === 'pre') {
    let value = '';
    while (reader.more()) {
      const inner = reader.next();
      if (inner.type === 'close' && inner.name === 'pre') break;
      if (inner.type === 'text') value += inner.value;
      else if (inner.type === 'open' && (inner.name === 'br' || inner.name === 'div')) value += '\n';
    }
    // Leading and trailing newlines are the browser's separators, not blank lines the author typed - a code block
    // whose lines are each wrapped in a <div> would otherwise gain an empty first line.
    return { type: 'code', language: attrs['data-language'] || '', value: value.replace(/^\n+/, '').replace(/\n+$/, '') };
  }

  if (name === 'table') {
    let head = [];
    const rows = [];
    let inHead = false;

    while (reader.more()) {
      const inner = reader.peek();
      if (inner.type === 'close' && inner.name === 'table') {
        reader.next();
        break;
      }
      reader.next();
      if (inner.type !== 'open') continue;
      if (inner.name === 'thead') inHead = true;
      if (inner.name === 'tbody') inHead = false;
      if (inner.name === 'tr') {
        const cells = readTableRow(reader, 'tr');
        if (inHead && head.length === 0) head = cells;
        else rows.push(cells);
      }
    }

    // A table with no <thead> - or one the browser rewrote - keeps its first row as the header: a table without a
    // header row is not something this markdown subset can write.
    if (head.length === 0 && rows.length > 0) head = rows.shift();
    if (head.length === 0 && rows.length === 0) return null;
    return { type: 'table', head, rows };
  }

  if (name === 'ul' || name === 'ol') {
    return { type: 'list', ordered: name === 'ol', items: readListItems(reader, name) };
  }

  if (name === 'blockquote') {
    return { type: 'quote', text: readInline(reader, new Set(['blockquote'])).trim() };
  }

  if (name === 'div' && attrs['data-block'] === 'callout') {
    const kind = ALERT_KINDS.indexOf(attrs['data-kind']) === -1 ? 'note' : attrs['data-kind'];
    const body = [];

    while (reader.more()) {
      const inner = reader.peek();
      if (inner.type === 'close' && inner.name === 'div') {
        reader.next();
        break;
      }
      if (inner.type === 'open' && inner.name === 'p' && inner.attrs && inner.attrs['data-callout-head'] !== undefined) {
        // The head label is drawn from the kind, so it is skipped rather than read as content.
        reader.next();
        reader.skipElement('p');
        continue;
      }
      pushBlocks(body, readBlock(reader, reader.next()));
    }

    return { type: 'callout', kind, blocks: body };
  }

  if (name === 'p' || name === 'div' || HEADING_TAGS.has(name)) {
    // A bare <div> is how the browser continues a paragraph - unless it wraps blocks, in which case it is a
    // container and its children are the document's blocks. Reading it as a paragraph would put the whole
    // structure into one line and invent an empty paragraph for every nesting level.
    if (name === 'div' && !attrs['data-block'] && reader.inspectElement('div').hasBlockChild) {
      return readBlocks(reader, new Set(['div']));
    }

    const wasEmpty = reader.inspectElement(name);
    const text = readInline(reader, new Set([name])).trim();
    const tagLevel = HEADING_TAGS.has(name) ? Number(name.slice(1)) : 0;
    const level = tagLevel || Number(attrs['data-level']);

    if (text === '' && !wasEmpty.hasBreak) {
      // An empty wrapper with nothing in it at all: the browser leaves these behind when a block is emptied or
      // re-parented. An empty paragraph is KEPT when it holds a <br>, because that is how the browser marks one the
      // author can put the caret in - and it never reaches the sheet either way, since blocksToMarkdown drops a
      // block whose text is empty.
      return null;
    }

    if (attrs['data-block'] === 'heading' || tagLevel) {
      return { type: 'heading', level: level >= 1 && level <= 6 ? level : 2, text };
    }
    return { type: 'paragraph', text };
  }

  // A stray cell, item, or anything else entirely: keep its text, drop its tag.
  const text = readInline(reader, new Set([name])).trim();
  return text === '' ? null : { type: 'paragraph', text };
};

// Reads a sequence of blocks, stopping at any close tag in `stops`.
//
// A block may be SEVERAL blocks: a container <div> returns the blocks it wraps. Both readers below go through
// pushBlocks for that reason, so a container nested inside a callout body cannot silently swallow its children.
const pushBlocks = (target, block) => {
  if (Array.isArray(block)) block.forEach((entry) => target.push(entry));
  else if (block) target.push(block);
};

const readBlocks = (reader, stops) => {
  const blocks = [];

  while (reader.more()) {
    const token = reader.peek();

    if (token.type === 'close') {
      reader.next();
      if (stops.has(token.name)) break;
      continue;
    }

    if (token.type === 'text') {
      reader.next();
      if (token.value.trim() !== '') blocks.push({ type: 'paragraph', text: token.value.trim() });
      continue;
    }

    // A block may be several blocks (a container <div>), which is why this flattens rather than pushes.
    pushBlocks(blocks, readBlock(reader, reader.next()));
  }

  return blocks;
};

// The editable HTML the component just read, as the editor's blocks.
export const blocksFromHtml = (html) => {
  const blocks = readBlocks(readerFor(tokenizeHtml(html)), new Set());
  // An empty surface is a document with one empty paragraph, never no document - the caret needs somewhere to be.
  return blocks.length ? blocks : [emptyParagraph()];
};




// ---------------------------------------------------------------------------
// Commands, on the model
// ---------------------------------------------------------------------------
// The toolbar's block actions, as a transformation of the model rather than as DOM surgery. That is what makes them
// testable, and it is also what keeps the HTML in step: the surface is re-rendered from the result, so a heading
// cannot become a list on screen while staying a heading in the document.

// The one line of text a block shows, for conversions in either direction (a quote becoming a heading keeps its
// words; a list becoming a paragraph keeps its first item).
export const blockLineText = (block) => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return block.text || '';
    case 'list':
      return (block.items || [''])[0] || '';
    case 'callout':
      return blockLineText((block.blocks || [])[0] || emptyParagraph());
    case 'code':
      return block.value || '';
    case 'table':
      return (block.head || [''])[0] || '';
    default:
      return '';
  }
};

const asParagraph = (block) => ({ type: 'paragraph', text: blockLineText(block) });

// An inserted block, and the block the caret should end up in.
const inserted = (blocks, index, block) => {
  const next = blocks.slice();
  next.splice(index + 1, 0, block);
  return { blocks: next, index: index + 1 };
};

export const newTableBlock = (columns = NEW_TABLE_COLUMNS, rows = NEW_TABLE_ROWS) => ({
  type: 'table',
  head: new Array(columns).fill(''),
  rows: Array.from({ length: rows }, () => new Array(columns).fill('')),
});

// ---------------------------------------------------------------------------
// Reshaping a table
// ---------------------------------------------------------------------------
// The five commands behind TABLE_ACTIONS. Each takes the table and the CELL the caret is in, and each returns the table
// unchanged when the request does not apply - so "Delete this column" on a one-column table is a no-op the caller can
// detect rather than a table quietly destroyed.
//
// THE POSITIONS ARE THE RENDERED ONES: `row` is an index into the rows as drawn, where 0 is the HEADER row and 1 is the
// first body row. That is the number the DOM gives the component (`tr` index within the table), so nothing has to
// translate between the two views of a table - which is what makes "delete THIS row" mean the row the caret is in.
//
// A ROW IS ALWAYS RESHAPED AS A RECTANGLE. `tableHtml` pads short rows on the way out, so a table can be ragged in the
// model and still look right; these commands pad first, so an edit does not write the raggedness back as a change. And a
// table always keeps its HEADER: removing the header row promotes the first body row instead, because a headerless
// table is not a table the parser can read back (the first row would silently become the header on the next round trip).
export const tableWidth = (table) => {
  const head = Array.isArray(table?.head) ? table.head : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  return Math.max(head.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)), 1);
};

const paddedTable = (table) => {
  const width = tableWidth(table);
  const pad = (cells) => {
    const padded = (Array.isArray(cells) ? cells : []).slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  };
  return { head: pad(table?.head), rows: (Array.isArray(table?.rows) ? table.rows : []).map(pad) };
};

const at = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);

export const tableAddRow = (table, afterRow) => {
  const { head, rows } = paddedTable(table);
  const width = head.length;
  // A blank position means "at the end", which is what an author asking for a row with no caret in a cell expects.
  const insertAt = Math.min(at(afterRow, rows.length), rows.length);
  const next = rows.slice();
  next.splice(insertAt, 0, new Array(width).fill(''));
  return { ...table, head, rows: next };
};

export const tableAddColumn = (table, afterColumn) => {
  const { head, rows } = paddedTable(table);
  const width = head.length;
  const insertAt = Math.min(at(afterColumn, width - 1) + 1, width);
  const withGap = (cells) => {
    const next = cells.slice();
    next.splice(insertAt, 0, '');
    return next;
  };
  return { ...table, head: withGap(head), rows: rows.map(withGap) };
};

export const tableRemoveRow = (table, row) => {
  const { head, rows } = paddedTable(table);
  const index = Number.isFinite(row) ? row : -1;
  if (index <= 0) {
    // The header row: promote the first body row, and refuse when there is nothing to promote - a table with no head is
    // a table this editor would read back with somebody's data promoted into a header they never wrote.
    if (index < 0 || rows.length === 0) return table;
    const [promoted, ...rest] = rows;
    return { ...table, head: promoted, rows: rest };
  }
  const bodyIndex = index - 1;
  if (bodyIndex >= rows.length) return table;
  return { ...table, head, rows: rows.filter((_, position) => position !== bodyIndex) };
};

export const tableRemoveColumn = (table, column) => {
  const { head, rows } = paddedTable(table);
  const width = head.length;
  // The last column stays: a table with no cells is not a table, and the renderer would draw it back as one empty
  // column anyway - so removing it would look like nothing happened.
  if (width <= 1) return table;
  const index = Number.isFinite(column) ? column : -1;
  if (index < 0 || index >= width) return table;
  const without = (cells) => cells.filter((_, position) => position !== index);
  return { ...table, head: without(head), rows: rows.map(without) };
};

export const applyTableCommand = (table, action) => {
  if (!table || table.type !== 'table') return table;
  const cell = action?.cell || {};
  switch (action?.id) {
    case 'tableAddRow':
      return tableAddRow(table, cell.row);
    case 'tableAddColumn':
      return tableAddColumn(table, cell.column);
    case 'tableRemoveRow':
      return tableRemoveRow(table, cell.row);
    case 'tableRemoveColumn':
      return tableRemoveColumn(table, cell.column);
    default:
      return table;
  }
};

// Applies one toolbar action to the block at `index`.
//
// Every styling action TOGGLES: asking for the style a block already has takes it off again, which is what a
// toolbar in a word processor does and what an author expects from a button that stays lit. Insertions are not
// toggles - there is no sensible way to un-insert a divider - so they only ever add.
export const applyBlockCommand = (blocks, index, action) => {
  const list = Array.isArray(blocks) ? blocks : [];
  if (index < 0 || index >= list.length) return { blocks: list, index };
  const block = list[index];
  const id = action && action.id;

  const replaceWith = (replacement) => {
    const next = list.slice();
    next[index] = replacement;
    return { blocks: next, index };
  };

  switch (id) {
    case 'paragraph':
      return block.type === 'paragraph' ? { blocks: list, index } : replaceWith(asParagraph(block));

    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(action.level) || 1));
      if (block.type === 'heading' && block.level === level) return replaceWith(asParagraph(block));
      return replaceWith({ type: 'heading', level, text: blockLineText(block) });
    }

    case 'bullet':
    case 'numbered': {
      const ordered = Boolean(action.ordered);
      if (block.type === 'list' && block.ordered === ordered) return replaceWith(asParagraph(block));
      if (block.type === 'list') return replaceWith({ type: 'list', ordered, items: block.items });
      return replaceWith({ type: 'list', ordered, items: [blockLineText(block)] });
    }

    case 'quote':
      return block.type === 'quote'
        ? replaceWith(asParagraph(block))
        : replaceWith({ type: 'quote', text: blockLineText(block) });

    case 'callout': {
      const kind = ALERT_KINDS.indexOf(action.callout) === -1 ? 'note' : action.callout;
      if (block.type === 'callout' && block.kind === kind) return replaceWith(asParagraph(block));
      return replaceWith({ type: 'callout', kind, blocks: [{ type: 'paragraph', text: blockLineText(block) }] });
    }

    case 'codeBlock':
      return block.type === 'code'
        ? replaceWith(asParagraph(block))
        : replaceWith({ type: 'code', language: '', value: blockLineText(block) });

    case 'table':
      return inserted(list, index, newTableBlock());

    // The table's own five, which act on the CELL the caret is in. A table action anywhere else is a no-op rather than
    // an error: the toolbar only offers them inside a table, and a stale screen that sent one anyway must not reshape
    // somebody's document. `cell` is the rendered position (row 0 = the header), passed in by the component.
    case 'tableAddRow':
    case 'tableAddColumn':
    case 'tableRemoveRow':
    case 'tableRemoveColumn': {
      const reshaped = applyTableCommand(block, { id, cell: action.cell });
      return reshaped === block ? { blocks: list, index } : replaceWith(reshaped);
    }

    // Deleting the grid itself, which is what an author wants after inserting one by mistake - and which they could
    // previously only do by switching to Markdown and deleting the pipes by hand. The block goes; the document cannot
    // become empty, so the last block standing is replaced with an empty paragraph to put the caret in.
    case 'tableRemove': {
      if (block.type !== 'table') return { blocks: list, index };
      const next = list.filter((_, position) => position !== index);
      return next.length
        ? { blocks: next, index: Math.max(0, index - 1) }
        : { blocks: [emptyParagraph()], index: 0 };
    }

    case 'rule':
      return inserted(list, index, { type: 'rule' });

    default:
      // Anything else - an inline action, or an action from a newer toolbar than this dispatcher - leaves the
      // document alone rather than guessing. The verifier asserts this is not reachable for today's toolbar.
      return { blocks: list, index };
  }
};


// ---------------------------------------------------------------------------
// Commands, on markdown text
// ---------------------------------------------------------------------------
// The Markdown mode's toolbar acts on the textarea's own text, which is a different problem from the rich surface
// and needs its own answer: there is no model to change, only characters and a selection. Both paths produce the
// same markdown, so an author can use either - and this one is arithmetic, which makes it the easier of the two to
// be certain about.
export const findMarkRange = (text, mark, start, end) => {
  const source = String(text ?? '');
  const selectionStart = Math.max(0, Math.min(start, source.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, source.length));
  const length = mark.length;

  // The selection already sits inside its own delimiters: `**bold**` with bold selected.
  if (
    source.slice(selectionStart - length, selectionStart) === mark &&
    source.slice(selectionEnd, selectionEnd + length) === mark
  ) {
    return {
      start: selectionStart - length,
      end: selectionEnd + length,
      innerStart: selectionStart,
      innerEnd: selectionEnd,
    };
  }

  // The caret is inside a marked run, or the selection is part of one: widen to the whole run, which is what a
  // second press of the button should act on.
  let left = selectionStart;
  let right = selectionEnd;
  while (left >= length && source.slice(left - length, left) !== mark) left -= 1;
  while (right + length <= source.length && source.slice(right, right + length) !== mark) right += 1;

  if (
    left >= length &&
    right + length <= source.length &&
    source.slice(left - length, left) === mark &&
    source.slice(right, right + length) === mark
  ) {
    return { start: left - length, end: right + length, innerStart: left, innerEnd: right };
  }

  return null;
};

// Toggles an inline mark around the selection: wraps, unwraps, or - with nothing selected - leaves the caret
// between the delimiters so the author can type into them.
export const toggleInlineText = (text, mark, start, end) => {
  const source = String(text ?? '');
  const selectionStart = Math.max(0, Math.min(start, source.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, source.length));
  const length = mark.length;
  const range = findMarkRange(source, mark, selectionStart, selectionEnd);

  if (range) {
    return {
      text: source.slice(0, range.start) + source.slice(range.innerStart, range.innerEnd) + source.slice(range.end),
      selectionStart: range.start,
      selectionEnd: range.start + (range.innerEnd - range.innerStart),
    };
  }

  const selected = source.slice(selectionStart, selectionEnd);
  return {
    text: source.slice(0, selectionStart) + mark + selected + mark + source.slice(selectionEnd),
    selectionStart: selectionStart + length,
    selectionEnd: selectionEnd + length,
  };
};

// The line boundaries the selection touches, so a block command applies to whole lines.
export const selectedLineRange = (text, start, end) => {
  const source = String(text ?? '');
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const breakIndex = source.indexOf('\n', to);
  return {
    lineStart: source.lastIndexOf('\n', Math.max(0, from - 1)) + 1,
    lineEnd: breakIndex === -1 ? source.length : breakIndex,
  };
};

// Toggles a line prefix (a heading's `#`, a bullet, a quote marker) across every selected line.
export const toggleLinePrefix = (text, prefix, start, end) => {
  const source = String(text ?? '');
  const { lineStart, lineEnd } = selectedLineRange(source, start, end);
  const lines = source.slice(lineStart, lineEnd).split('\n');
  const allHave = lines.every((line) => line.startsWith(prefix));
  const replacement = lines.map((line) => (allHave ? line.slice(prefix.length) : `${prefix}${line}`)).join('\n');

  return {
    text: source.slice(0, lineStart) + replacement + source.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
};


// Inserts a block of markdown at the caret, on its own lines: the text equivalent of the toolbar's insert actions.
export const insertTextBlock = (text, block, start, end) => {
  const source = String(text ?? '');
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  const before = source.slice(0, from);
  const after = source.slice(to);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${lead}${block}${tail}`;

  return {
    text: before + inserted + after,
    selectionStart: from + lead.length,
    selectionEnd: from + lead.length + block.length,
  };
};

// One entry point for the Markdown mode's toolbar, so the component does not have to know which action is which.
export const applyTextCommand = (text, action, start, end) => {
  const source = String(text ?? '');
  const id = action && action.id;
  const unchanged = { text: source, selectionStart: start, selectionEnd: end };
  const inline = INLINE_ACTIONS.find((entry) => entry.id === id);

  if (inline) {
    // A link needs a URL, so it cannot be done from the selection alone: the component asks, then wraps. Nothing is
    // inserted here, which is why this reports the need rather than half-building a link.
    if (id === 'link') return { ...unchanged, needsUrl: true };
    return toggleInlineText(source, inline.syntax, start, end);
  }

  switch (id) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(action.level) || 1));
      return toggleLinePrefix(source, `${'#'.repeat(level)} `, start, end);
    }
    case 'bullet':
      return toggleLinePrefix(source, '- ', start, end);
    case 'numbered':
      return toggleLinePrefix(source, '1. ', start, end);
    case 'quote':
      return toggleLinePrefix(source, '> ', start, end);
    case 'callout':
      return toggleLinePrefix(source, `> [!${String(action.callout || 'note').toUpperCase()}] `, start, end);
    case 'codeBlock':
      return toggleLinePrefix(source, '```\n', start, end);
    case 'rule':
      return insertTextBlock(source, '---', start, end);
    case 'table':
      return insertTextBlock(source, blocksToMarkdown([newTableBlock()]), start, end);
    case 'paragraph': {
      // Removing a block style in text is taking off whatever marker the line starts with.
      const { lineStart } = selectedLineRange(source, start, end);
      const marker = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|> \[![A-Z]+\]\s)/.exec(source.slice(lineStart));
      return marker ? toggleLinePrefix(source, marker[1], start, end) : unchanged;
    }
    default:
      return unchanged;
  }
};

// Wraps the selection in a link. Separate from applyTextCommand because the URL has to come from somewhere the
// selection cannot provide: the component asks for it and hands it in.
export const wrapLinkText = (text, url, start, end) => {
  const source = String(text ?? '');
  const selectionStart = Math.max(0, Math.min(start, source.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, source.length));
  const link = `[${source.slice(selectionStart, selectionEnd)}](${String(url ?? '').trim()})`;

  return {
    text: source.slice(0, selectionStart) + link + source.slice(selectionEnd),
    selectionStart: selectionStart + link.length,
    selectionEnd: selectionStart + link.length,
  };
};
