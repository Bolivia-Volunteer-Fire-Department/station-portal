// A small Markdown subset, parsed into plain data.
//
// The help guides are authored in this repository, so this only covers what those files
// actually use: headings, paragraphs, emphasis, inline code, links, lists, block quotes,
// fenced code and tables.
//
// Two deliberate choices:
//
//   * **No raw HTML.** The output is a data tree that components/Markdown.jsx turns into React
//     elements, so there is no dangerouslySetInnerHTML anywhere and a `<script>` in a guide
//     shows up as literal text.
//   * **Plain data, no React.** The parser is a pure function, which is what makes the whole
//     syntax testable - see scripts/verify-help-guides.mjs.
//
// Not supported (and not needed by the guides): nested lists, images, setext headings,
// reference links, tables inside lists, or emphasis nested more than one level deep.

// ---------------------------------------------------------------------------
// Colored marks
// ---------------------------------------------------------------------------
// Markdown has no color syntax, so a colored run of text needs a delimiter of its own. Rather than bury that
// delimiter in the inline pattern, the marks live in a TABLE: the parser builds its alternation from it, the
// renderer maps a tone to classes, and the editing toolbar will read the same list. Adding a second color is
// adding a row here - not touching the parser, the renderer and the toolbar separately, which is how the three
// would drift apart.
//
// `tone` names the color rather than the syntax, so `==text==` is "a highlight" and a future `++text++` could be
// the same tone reached differently. The tones are the callout palette's words on purpose: a highlighted phrase
// and the note box it sits in should be able to be the same color rather than two unrelated palettes.
//
// The delimiter may not appear inside its own mark (`[^=]+?`), so an unclosed `==` stays literal text instead of
// swallowing the rest of the line.
export const COLOR_MARKS = [
  { id: 'highlight', open: '==', close: '==', tone: 'highlight' }
];

const escapeForRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One capture group per mark, in table order.
const COLOR_MARK_SOURCE = COLOR_MARKS.map((mark) => {
  const inner = `[^${escapeForRegex(mark.close.slice(0, 1))}]+?`;
  return `(${escapeForRegex(mark.open)}${inner}${escapeForRegex(mark.close)})`;
}).join('|');

// The mark whose delimiters `raw` starts and ends with, or null. Derived from the table rather than named in the
// parser, so a second color is recognized without a second branch.
const colorMarkFor = (raw) =>
  COLOR_MARKS.find(
    (mark) => raw.startsWith(mark.open) && raw.endsWith(mark.close) && raw.length > mark.open.length + mark.close.length
  ) || null;

// Inline patterns, tried in order. Bold is checked before italic, and `.` is non-greedy so a
// line can hold several runs of each.
//
// Kept as a SOURCE string rather than a shared /g regex: parseInline recurses into the bodies of
// bold/italic/link tokens, and a shared global regex would have its lastIndex reset by the inner
// call - which silently rewinds the outer loop and spins forever. Each call builds its own.
const INLINE_SOURCE =
  '(\\*\\*\\*[^*]+?\\*\\*\\*)|(\\*\\*.+?\\*\\*)|(`[^`]+`)|(\\*[^*]+\\*)|(_[^_]+_)|(\\[[^\\]]+\\]\\([^)\\s]+\\))|(' +
  COLOR_MARK_SOURCE +
  ')';

const isWhitespace = (char) => char === undefined || /\s/.test(char);

// Emphasis delimiters must hug their content: "* not italic *" and arithmetic like
// "2 * 3 * 4" stay literal, which is what someone writing a help guide expects.
const delimitersHugContent = (raw, markerLength) =>
  raw.length > markerLength * 2 &&
  !isWhitespace(raw[markerLength]) &&
  !isWhitespace(raw[raw.length - markerLength - 1]);

export function parseInline(text) {
  const source = String(text ?? '');
  const pattern = new RegExp(INLINE_SOURCE, 'g');
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const raw = match[0];
    let token = null;

    if (raw.startsWith('***')) {
      // Bold and italic on the same words, which is what a WYSIWYG toolbar produces the moment somebody selects a
      // phrase and presses both buttons - and the only spelling of it this subset can read. Without this the
      // editor would write `***x***` and the reader would show the asterisks.
      if (delimitersHugContent(raw, 3)) {
        token = { type: 'bold', children: [{ type: 'italic', children: parseInline(raw.slice(3, -3)) }] };
      }
    } else if (raw.startsWith('**')) {
      if (delimitersHugContent(raw, 2)) {
        token = { type: 'bold', children: parseInline(raw.slice(2, -2)) };
      }
    } else if (raw.startsWith('`')) {
      token = { type: 'code', value: raw.slice(1, -1) };
    } else if (raw.startsWith('*') || raw.startsWith('_')) {
      // `_` must not fire inside a word, so snake_case stays literal.
      const before = source[match.index - 1];
      const after = source[match.index + raw.length];
      const insideWord = raw.startsWith('_') && (/\w/.test(before || '') || /\w/.test(after || ''));
      if (!insideWord && delimitersHugContent(raw, 1)) {
        token = { type: 'italic', children: parseInline(raw.slice(1, -1)) };
      }
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(raw);
      if (link) token = { type: 'link', href: link[2], children: parseInline(link[1]) };
      else {
        // A colored mark, looked up in the table rather than matched by a second copy of its delimiters. The
        // hugging rule applies here too, so `== spaced ==` stays literal text like `* spaced *` does.
        const mark = colorMarkFor(raw);
        if (mark && delimitersHugContent(raw, mark.open.length)) {
          token = {
            type: 'color',
            tone: mark.tone,
            children: parseInline(raw.slice(mark.open.length, raw.length - mark.close.length)),
          };
        }
      }
    }

    // A rejected candidate is simply left in the text run for the next pass.
    if (!token) continue;

    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: source.slice(lastIndex, match.index) });
    }
    lastIndex = match.index + raw.length;
    tokens.push(token);
  }

  if (lastIndex < source.length) {
    tokens.push({ type: 'text', value: source.slice(lastIndex) });
  }

  return tokens;
}

// --- Blocks -----------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```\s*([A-Za-z0-9_+-]*)\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/;

// GitHub-style alerts: a blockquote whose first line opens with `[!TYPE]`.
//
// Only these five are recognized, matching GitHub. An unrecognized marker stays a plain quote, so a
// typo shows the literal `[!DANGER]` text rather than silently becoming a styled box.
export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'];
const ALERT_MARKER = /^\[!([A-Za-z]+)\]\s*(.*)$/;

const isBlank = (line) => line.trim() === '';

// A line that would begin a new block, used to decide where a paragraph ends.
const startsBlock = (line) =>
  HEADING.test(line) || FENCE.test(line) || RULE.test(line) || QUOTE.test(line) ||
  BULLET.test(line) || NUMBERED.test(line);

const splitTableRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

// A table row as both its inline markdown and its parsed tokens. The SOURCES are what the editor needs: it renders
// a cell by parsing that markdown itself, and regenerating a table from tokens would lose the difference between
// `*a*` and `_a_`. The tokens are what components/Markdown.jsx renders, unchanged.
const tableRow = (line) => {
  const cells = splitTableRow(line);
  return { cells, children: cells.map((cell) => parseInline(cell)) };
};

const isTableStart = (lines, index) =>
  lines[index].includes('|') &&
  index + 1 < lines.length &&
  TABLE_DIVIDER.test(lines[index + 1]);

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code. An unterminated fence runs to the end of the file rather than throwing.
    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push({ type: 'code', language: fence[1] || '', value: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        // The inline markdown this heading was parsed from, so the editor can render it as editable HTML and
        // write it back unchanged. Not a second parser: the same string parseInline was handed.
        inlineSource: heading[2].trim(),
        children: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = tableRow(lines[i]);
      i += 2; // header row + divider
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(tableRow(lines[i]));
        i++;
      }
      blocks.push({
        type: 'table',
        head: head.children,
        headSources: head.cells,
        rows: rows.map((row) => row.children),
        rowSources: rows.map((row) => row.cells),
      });
      continue;
    }

    // Consecutive `>` lines become one quote block, or an alert when the first line is a marker.
    //
    // An alert's body is de-quoted and parsed as markdown in its own right, so it can hold
    // paragraphs, lists, emphasis and code like any other block - and blank `>` lines, which become
    // blank lines and therefore paragraph breaks.
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])[1]);
        i++;
      }
      const alert = parseAlert(quoted);
      if (alert) {
        blocks.push(alert);
        continue;
      }
      blocks.push({
        type: 'quote',
        inlineSource: quoted.join(' ').trim(),
        children: parseInline(quoted.join(' ').trim()),
      });
      continue;
    }

    // A list runs until a line no longer matches ITS OWN marker, so a bullet list ends when a
    // numbered list begins (mixed lists are not supported - see the note at the top).
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const items = [];
      const itemSources = [];
      while (i < lines.length) {
        const match = ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (!match) break;
        itemSources.push(match[1].trim());
        items.push(parseInline(match[1].trim()));
        i++;
      }
      blocks.push({ type: 'list', ordered, itemSources, items });
      continue;
    }

    const paragraph = [];
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({
      type: 'paragraph',
      inlineSource: paragraph.join(' '),
      children: parseInline(paragraph.join(' ')),
    });
  }

  return blocks;
}

// An alert, or null when this quote is not one.
//
// Declared after the parser so it can reuse parseMarkdown for the body - function declarations are
// hoisted - which keeps the alert logic out of the main loop and means an alert body supports
// everything a document does.
function parseAlert(quoted) {
  if (!Array.isArray(quoted) || quoted.length === 0) return null;

  const marker = ALERT_MARKER.exec(String(quoted[0]).trim());
  if (!marker) return null;

  const kind = marker[1].toLowerCase();
  if (ALERT_KINDS.indexOf(kind) === -1) return null;

  const body = quoted.slice(1);
  // The marker may share its line with the start of the body (`[!NOTE] Text`), which is what a
  // one-line alert looks like.
  if (marker[2].trim() !== '') body.unshift(marker[2]);

  return { type: 'alert', kind, blocks: parseMarkdown(body.join('\n')) };
}

// The first `# heading` in a guide, used as its title in the list. The filename is the
// fallback so a guide without a heading still gets a sensible label.
export const markdownTitle = (source) => {
  const match = /^#\s+(.+)$/m.exec(String(source ?? ''));
  return match ? match[1].trim() : '';
};