/**
 * Verifies the rich editor's engine: the block model, the markdown it writes, and the editable HTML it renders.
 *
 * What this exists for: a WYSIWYG editor is a ROUND TRIP, and a round trip fails quietly. A paragraph that comes
 * back one space different, a callout whose drawn label leaks into the document's text, a table whose first row
 * stops being its header - none of that breaks a build, and none of it looks wrong in a screenshot. The only place
 * those failures are visible is in the text that reaches the sheet, which is what this asserts.
 *
 * So the engine is RUN rather than read: markdown through the model, into HTML, back out of HTML, into markdown
 * again, and the two texts compared. Nothing here needs a browser - the whole engine is pure - which is why the
 * component that hosts it can be thin.
 *
 *   npm run verify:rich-markdown
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALERT_KINDS } from '../src/utils/markdown.js';
import { CALLOUT_CLASSES, HEADING_CLASSES, INLINE_CLASSES } from '../src/utils/markdownStyles.js';
import {
  ACTION_IDS,
  BLOCK_ACTIONS,
  CALLOUT_ACTIONS,
  EDITOR_ACTIONS,
  INLINE_ACTIONS,
  INSERT_ACTIONS,
  applyBlockCommand,
  applyTextCommand,
  blockLineText,
  blocksFromHtml,
  blocksToMarkdown,
  decodeEntities,
  editorBlocksFromMarkdown,
  findMarkRange,
  htmlFromBlocks,
  insertTextBlock,
  newTableBlock,
  selectedLineRange,
  toggleInlineText,
  toggleLinePrefix,
  tokenizeHtml,
  wrapLinkText,
} from '../src/utils/richMarkdown.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};
const types = (blocks) => blocks.map((block) => block.type);

// ---------------------------------------------------------------------------
// A document using every construct the editor can produce.
// ---------------------------------------------------------------------------
// Written in the CANONICAL form the editor writes: `-` bullets, numbers from 1, `---` dividers, and a divider row
// of ` --- ` cells. A document that is already canonical must come back byte for byte, which is the strongest
// statement this file can make about not rewriting an author's work.
const DOCUMENT = [
  '# Driver checklist',
  '',
  'Some **bold**, *italic*, ==highlighted== and `code` text with a [link](https://example.com).',
  '',
  '## Before leaving',
  '',
  '- Tire pressure',
  '- Lights and siren',
  '',
  '1. Log the mileage',
  '2. Sign the sheet',
  '',
  '> The pump is behind the seat.',
  '',
  '> [!WARNING]',
  '> Do not run the pump dry.',
  '>',
  '> - Check the intake first',
  '',
  '```js',
  'const pressure = 100;',
  '```',
  '',
  '| Check | Where |',
  '| --- | --- |',
  '| Tires | Front |',
  '| Lights | Front |',
  '',
  '---',
].join('\n');

console.log('--- markdown -> model -> markdown ---');
const blocks = editorBlocksFromMarkdown(DOCUMENT);
check('every construct becomes a block', types(blocks), [
  'heading',
  'paragraph',
  'heading',
  'list',
  'list',
  'quote',
  'callout',
  'code',
  'table',
  'rule',
]);
check('the heading keeps its level', blocks[0].level, 1);
check('the second heading is level 2', blocks[2].level, 2);
check('the bullet list is a list', blocks[3].ordered, false);
check('and keeps its items', blocks[3].items, ['Tire pressure', 'Lights and siren']);
check('the numbered list is ordered', blocks[4].ordered, true);
check('the callout keeps its kind', blocks[6].kind, 'warning');
check('and its body is blocks of its own', types(blocks[6].blocks), ['paragraph', 'list']);
check('the code block keeps its language', blocks[7].language, 'js');
check('the code block keeps its text', blocks[7].value, 'const pressure = 100;');
check('the table keeps its header', blocks[8].head, ['Check', 'Where']);
check('and its rows', blocks[8].rows.length, 2);
check('markdown inside an inline run is untouched', blocks[1].text.includes('**bold**'), true);
check('THE WHOLE DOCUMENT COMES BACK', blocksToMarkdown(blocks), DOCUMENT);
check('and parsing it again is stable', blocksToMarkdown(editorBlocksFromMarkdown(DOCUMENT)), DOCUMENT);
// Whitespace OUTSIDE a block is not content: a trailing newline is normalized away rather than stored as a blank
// block, and a paragraph's wrapped lines are joined, because that is how the preview reads them.
check('a trailing newline is normalized away', blocksToMarkdown(editorBlocksFromMarkdown(`${DOCUMENT}\n\n`)), DOCUMENT);
check(
  'and a paragraph split over two lines is joined',
  blocksToMarkdown(editorBlocksFromMarkdown('one line\nand its continuation')),
  'one line and its continuation'
);

console.log('\n--- markdown -> HTML -> markdown (the WYSIWYG promise) ---');
const html = htmlFromBlocks(blocks);
check('HTML round trip', blocksToMarkdown(blocksFromHtml(html)), DOCUMENT);
check(
  'a second HTML round trip is stable',
  blocksToMarkdown(blocksFromHtml(htmlFromBlocks(blocksFromHtml(html)))),
  DOCUMENT
);

console.log('\n--- HTML the browser produces while editing ---');
// What the browser makes of an edit is not what the editor generated: a Return inside a paragraph becomes a
// <div> in most engines, an empty line becomes <p><br></p>, and a paste arrives wrapped in spans. Each of these is
// a case the reader has to survive, and none of them can be produced by reading the generated HTML alone.
const browserCases = [
  ['a bare div is a paragraph', '<div>Typed after a Return</div>', { type: 'paragraph', text: 'Typed after a Return' }],
  ['a heading the browser made', '<h2>Made by the browser</h2>', { type: 'heading', level: 2, text: 'Made by the browser' }],
  ['a span is transparent', '<p><span style="color:red">still text</span></p>', { type: 'paragraph', text: 'still text' }],
  ['b tags are bold', '<p><b>bold</b></p>', { type: 'paragraph', text: '**bold**' }],
  ['i tags are italic', '<p><i>italic</i></p>', { type: 'paragraph', text: '*italic*' }],
  ['a nested mark reads back as both', '<p><strong><em>both</em></strong></p>', { type: 'paragraph', text: '***both***' }],
  ['an anchor keeps its href', '<p><a href="https://x.test">x</a></p>', { type: 'paragraph', text: '[x](https://x.test)' }],
  ['a br inside a paragraph is a space', '<p>one<br>two</p>', { type: 'paragraph', text: 'one two' }],
  ['an empty paragraph is kept', '<p><br></p>', { type: 'paragraph', text: '' }],
  ['a quote', '<blockquote>words</blockquote>', { type: 'quote', text: 'words' }],
  ['an unordered list', '<ul><li>a</li><li>b</li></ul>', { type: 'list', ordered: false, items: ['a', 'b'] }],
  ['an ordered list', '<ol><li>a</li></ol>', { type: 'list', ordered: true, items: ['a'] }],
  ['an empty list keeps a place to type', '<ul></ul>', { type: 'list', ordered: false, items: [''] }],
  ['a divider', '<hr>', { type: 'rule' }],
];

browserCases.forEach(([label, input, expected]) => {
  const parsed = blocksFromHtml(input);
  check(label, parsed.length === 1 ? parsed[0] : parsed, expected);
});

check('a callout the editor made keeps its kind and body', (() => {
  const callout = blocksFromHtml(htmlFromBlocks([{ type: 'callout', kind: 'caution', blocks: [{ type: 'paragraph', text: 'careful' }] }]))[0];
  return [callout.type, callout.kind, blocksToMarkdown(callout.blocks)];
})(), ['callout', 'caution', 'careful']);

checkIs(
  'and its drawn label never becomes text',
  (() => {
    const html = htmlFromBlocks([{ type: 'callout', kind: 'warning', blocks: [{ type: 'paragraph', text: 'body only' }] }]);
    return blocksToMarkdown(blocksFromHtml(html)) === '> [!WARNING]\n> body only';
  })(),
  'the label leaked into the document'
);

check(
  'a table the browser rewrote without a thead',
  (() => {
    const parsed = blocksFromHtml('<table><tbody><tr><td>Head</td></tr><tr><td>Body</td></tr></tbody></table>')[0];
    return [parsed.type, parsed.head, parsed.rows];
  })(),
  ['table', ['Head'], [['Body']]]
);

check('a code block survives browser divs', (() => {
  const parsed = blocksFromHtml('<pre data-block="code" data-language="js"><div>line one</div><div>line two</div></pre>')[0];
  return [parsed.type, parsed.value];
})(), ['code', 'line one\nline two']);

check('empty wrappers around real content are ignored', blocksFromHtml('<div><div></div><p>real</p></div>').length, 1);

console.log('\n--- nothing an author types can be lost or executed ---');
const literalCases = [
  '<script>alert(1)</script>',
  'A < B and C > D',
  '5 & 6',
  'a "quoted" word',
  "it's fine",
  'R&D — done',
];
literalCases.forEach((value) => {
  const markdown = blocksToMarkdown(editorBlocksFromMarkdown(value));
  check(`"${value}" survives the page round trip`, blocksToMarkdown(blocksFromHtml(htmlFromBlocks(editorBlocksFromMarkdown(value)))), markdown);
});
checkIs(
  'a script tag is escaped in the editable HTML',
  !htmlFromBlocks(editorBlocksFromMarkdown('<script>alert(1)</script>')).includes('<script'),
  'a script tag reached the surface'
);
check(
  'and reads as text, not code',
  blocksToMarkdown(editorBlocksFromMarkdown('<script>alert(1)</script>')),
  '<script>alert(1)</script>'
);
checkIs(
  'an unknown tag keeps its text',
  blocksToMarkdown(blocksFromHtml('<p><marquee>still here</marquee></p>')) === 'still here',
  'text inside an unknown tag was dropped'
);

console.log('\n--- the toolbar acts on the block the caret is in ---');
const paragraph = () => [{ type: 'paragraph', text: 'Words' }];
const one = (result) => result.blocks[0];

check('bold leaves the block alone', one(applyBlockCommand(paragraph(), 0, { id: 'bold' })), {
  type: 'paragraph',
  text: 'Words',
});
check('a heading is a heading', one(applyBlockCommand(paragraph(), 0, { id: 'heading', level: 2 })), {
  type: 'heading',
  level: 2,
  text: 'Words',
});
check(
  'asking for the same heading again takes it off',
  one(applyBlockCommand([{ type: 'heading', level: 2, text: 'Words' }], 0, { id: 'heading', level: 2 })),
  { type: 'paragraph', text: 'Words' }
);
check(
  'a different level just changes the level',
  one(applyBlockCommand([{ type: 'heading', level: 2, text: 'Words' }], 0, { id: 'heading', level: 1 })),
  { type: 'heading', level: 1, text: 'Words' }
);
check('a bullet list takes the words with it', one(applyBlockCommand(paragraph(), 0, { id: 'bullet', ordered: false })), {
  type: 'list',
  ordered: false,
  items: ['Words'],
});
check(
  'and asking again makes it a paragraph',
  one(applyBlockCommand([{ type: 'list', ordered: false, items: ['Words'] }], 0, { id: 'bullet', ordered: false })),
  { type: 'paragraph', text: 'Words' }
);
check(
  'switching to numbers keeps the items',
  one(applyBlockCommand([{ type: 'list', ordered: false, items: ['a', 'b'] }], 0, { id: 'numbered', ordered: true })),
  { type: 'list', ordered: true, items: ['a', 'b'] }
);
check('a quote keeps the words', one(applyBlockCommand(paragraph(), 0, { id: 'quote' })), {
  type: 'quote',
  text: 'Words',
});
check('a callout wraps them', one(applyBlockCommand(paragraph(), 0, { id: 'callout', callout: 'tip' })), {
  type: 'callout',
  kind: 'tip',
  blocks: [{ type: 'paragraph', text: 'Words' }],
});
check(
  'and the same kind again takes the box off',
  one(applyBlockCommand([{ type: 'callout', kind: 'tip', blocks: [{ type: 'paragraph', text: 'W' }] }], 0, { id: 'callout', callout: 'tip' })),
  { type: 'paragraph', text: 'W' }
);
check(
  'a different kind just recolors it',
  one(applyBlockCommand([{ type: 'callout', kind: 'tip', blocks: [{ type: 'paragraph', text: 'W' }] }], 0, { id: 'callout', callout: 'caution' })),
  { type: 'callout', kind: 'caution', blocks: [{ type: 'paragraph', text: 'W' }] }
);
check(
  'a code block keeps the line',
  one(applyBlockCommand(paragraph(), 0, { id: 'codeBlock' })),
  { type: 'code', language: '', value: 'Words' }
);
check(
  'and switches back',
  one(applyBlockCommand([{ type: 'code', language: '', value: 'Words' }], 0, { id: 'codeBlock' })),
  { type: 'paragraph', text: 'Words' }
);
check(
  'an unknown kind of callout falls back to Note',
  one(applyBlockCommand(paragraph(), 0, { id: 'callout', callout: 'danger' })).kind,
  'note'
);

const tableInsert = applyBlockCommand(paragraph(), 0, { id: 'table' });
check('a table is inserted after the block', types(tableInsert.blocks), ['paragraph', 'table']);
check('the caret lands in the table', tableInsert.index, 1);
check('with empty cells waiting for the author', tableInsert.blocks[1].head, ['', '', '']);
check(
  'and a divider row the parser will keep',
  blocksToMarkdown([{ type: 'paragraph', text: '' }, newTableBlock()]).split('\n')[1],
  '| --- | --- | --- |'
);
check('a divider is inserted after the block', types(applyBlockCommand(paragraph(), 0, { id: 'rule' }).blocks), [
  'paragraph',
  'rule',
]);
check('applying to a block that is not there changes nothing', applyBlockCommand(paragraph(), 5, { id: 'bullet' }).blocks, paragraph());

console.log('\n--- every toolbar button does something ---');
// The dispatcher must handle every id the toolbar can send, or a button would be decorative. There is no
// introspection to lean on, so this is behavioural: every BLOCK or INSERT action except "Normal text" must change
// the block. The inline ones are not its job - they wrap a selection, which is the surface's half of the toolbar -
// so they are asserted separately, as the text equivalent below and as the surface's own handlers after that.
const blockIds = EDITOR_ACTIONS.filter((entry) => entry.mode !== 'inline' && entry.id !== 'paragraph');
blockIds.forEach((action) => {
  check(
    `${action.id} changes the block`,
    blocksToMarkdown(applyBlockCommand(paragraph(), 0, action).blocks) !== blocksToMarkdown(paragraph()),
    true
  );
});
check(
  'and every inline action has a text equivalent',
  // A link is the exception on purpose: it needs a URL, so it reports that instead of guessing one.
  INLINE_ACTIONS.filter((action) => action.id !== 'link').every(
    (action) => applyTextCommand('words', action, 0, 5).text !== 'words'
  ),
  true
);
check(
  'paragraph on a paragraph is a no-op',
  blocksToMarkdown(applyBlockCommand(paragraph(), 0, { id: 'paragraph' }).blocks),
  'Words'
);
check(
  'and an id nobody wrote leaves the document alone',
  blocksToMarkdown(applyBlockCommand(paragraph(), 0, { id: 'nonsense' }).blocks),
  'Words'
);

console.log('\n--- the toolbar acts on markdown text (Markdown mode) ---');
check('bold wraps the selection', toggleInlineText('words', '**', 0, 5), {
  text: '**words**',
  selectionStart: 2,
  selectionEnd: 7,
});
check('and pressing it again takes it off', toggleInlineText('**words**', '**', 2, 7), {
  text: 'words',
  selectionStart: 0,
  selectionEnd: 5,
});
check(
  'a caret inside a bold run takes the whole run off, leaving the words selected',
  toggleInlineText('**words**', '**', 4, 4),
  { text: 'words', selectionStart: 0, selectionEnd: 5 }
);
check('a selection that is part of a run takes the whole run off', toggleInlineText('a **word** here', '**', 5, 7), {
  text: 'a word here',
  selectionStart: 2,
  selectionEnd: 6,
});
check('with nothing selected the delimiters are placed and the caret goes between', toggleInlineText('', '`', 0, 0), {
  text: '``',
  selectionStart: 1,
  selectionEnd: 1,
});
check('a mark range is found around the caret', findMarkRange('a *b* c', '*', 3, 3), {
  start: 2,
  end: 5,
  innerStart: 3,
  innerEnd: 4,
});
check('and is null outside any mark', findMarkRange('a b c', '*', 2, 2), null);

check('a heading prefixes every selected line', toggleLinePrefix('one\ntwo', '# ', 0, 7).text, '# one\n# two');
check('and takes the prefix off again', toggleLinePrefix('# one\n# two', '# ', 0, 11).text, 'one\ntwo');
check('a quote marker', toggleLinePrefix('one', '> ', 0, 3).text, '> one');
check('a callout marker carries its kind', toggleLinePrefix('one', '> [!CAUTION] ', 0, 3).text, '> [!CAUTION] one');
check('and the selection covers what it changed', toggleLinePrefix('one', '- ', 0, 3), {
  text: '- one',
  selectionStart: 0,
  selectionEnd: 5,
});
check('a line range is the whole line the caret is on', selectedLineRange('a\nbb\nc', 3, 3), { lineStart: 2, lineEnd: 4 });
check('a divider goes on its own lines', insertTextBlock('words', '---', 5, 5).text, 'words\n\n---');
check(
  'a table insert is a real table',
  insertTextBlock('', blocksToMarkdown([newTableBlock()]), 0, 0).text.split('\n')[0],
  '|  |  |  |'
);
check('a link wraps the label', wrapLinkText('see here', 'https://x.test', 4, 8), {
  text: 'see [here](https://x.test)',
  selectionStart: 26,
  selectionEnd: 26,
});
check('the link button asks for a URL first', applyTextCommand('x', { id: 'link' }, 0, 1).needsUrl, true);
check('and the text is untouched until it arrives', applyTextCommand('x', { id: 'link' }, 0, 1).text, 'x');
check('an unhandled text action leaves the text alone', applyTextCommand('x', { id: 'nonsense' }, 0, 1).text, 'x');
check('removing a block style takes its marker off', applyTextCommand('## Title', { id: 'paragraph' }, 3, 3).text, 'Title');

console.log('\n--- the HTML the author edits, and the surface that hosts it ---');
checkIs('a heading carries its level', /data-block="heading"[^>]*data-level="1"/.test(html), 'no level');
checkIs('and is styled like the reader styles it', html.includes(HEADING_CLASSES[1]), 'heading classes differ');
checkIs('a callout says which kind it is', /data-block="callout"[^>]*data-kind="warning"/.test(html), 'no kind on the callout');
checkIs(
  'and its label is drawn, not editable',
  /data-callout-head="1" contenteditable="false"[^>]*>Warning</.test(html),
  'the label could be edited into the document text'
);
checkIs('a bullet list is a real list', /<ul data-block="list"[\s\S]{0,200}<li>/.test(html), 'no ul/li');
checkIs('a numbered list is an ordered list', /<ol data-block="list"/.test(html), 'no ol');
checkIs('a quote is a blockquote', /<blockquote data-block="quote"/.test(html), 'no blockquote');
checkIs('a code block is a pre', /<pre data-block="code"[^>]*data-language="js"/.test(html), 'no pre');
checkIs('a table is a real table', /<table[\s\S]{0,400}<th/.test(html), 'no table');
checkIs('a divider is an hr', /<hr data-block="rule"/.test(html), 'no hr');
checkIs('inline bold is a strong tag', html.includes('<strong>bold</strong>'), 'bold was not rendered');
checkIs(
  'highlight is a mark tag',
  html.includes(`<mark class="${INLINE_CLASSES.highlight}">highlighted</mark>`),
  'no mark'
);
checkIs('a link is an anchor with its href', html.includes('href="https://example.com"'), 'no link');
checkIs('and links keep the reader\'s styling', html.includes(INLINE_CLASSES.link), 'link classes differ');
checkIs('every block is indexed for the caret', /data-index="0"/.test(html) && /data-index="9"/.test(html), 'no indices');

console.log('\n--- the component that hosts the surface ---');
const editorSource = readFileSync(path.resolve(process.cwd(), 'src/components/MarkdownEditor.jsx'), 'utf8');
const readerSource = readFileSync(path.resolve(process.cwd(), 'src/components/Markdown.jsx'), 'utf8');

// The icon names live in the engine (which stays free of React) and the components here, so this is the join
// between them: a name with no mapping would be a toolbar button that renders nothing. The five callouts are a MENU
// rather than five buttons, which is why they are not in this list - the menu's own trigger has its icon inline.
const iconMap = /const ICONS = \{([\s\S]*?)\};/.exec(editorSource)?.[1] || '';
const buttonActions = [...INLINE_ACTIONS, ...BLOCK_ACTIONS, ...INSERT_ACTIONS];
const unmapped = buttonActions
  .map((action) => action.icon)
  .filter((name) => !new RegExp(`(^|[\\s{])${name}[,:]`).test(iconMap));
check('every toolbar icon has a component', unmapped, []);
check('and every button says what it does', buttonActions.filter((action) => !action.label).length, 0);

checkIs('the surface is contenteditable', /contentEditable/.test(editorSource), 'no editable surface');
checkIs(
  'and its HTML comes from the engine, never from stored text',
  // The ATTRIBUTE form, not the words: the file says in its own comments why it does not use the other one.
  /innerHTML = htmlFromBlocks\(/.test(editorSource) && !/dangerouslySetInnerHTML=/.test(editorSource),
  'the surface is set from something other than the generated HTML'
);
checkIs('a paste is turned into plain text', /handlePaste/.test(editorSource) && /text\/plain/.test(editorSource), 'paste keeps its markup');
checkIs('Write is the default mode', /useState\('write'\)/.test(editorSource), 'the editor does not open in Write');
checkIs(
  'and Preview is the reader\u2019s own renderer',
  /<Markdown markdown=\{draft\} \/>/.test(editorSource),
  'the preview is not the shared renderer'
);
checkIs(
  'the editor renders with the shared style tables',
  /from '\.\.\/utils\/markdownStyles'/.test(editorSource),
  'the editor has its own styling'
);
checkIs(
  'and so does the reader',
  /from '\.\.\/utils\/markdownStyles'/.test(readerSource),
  'the reader has its own styling'
);
checkIs(
  'the reader never injects HTML',
  // Again the attribute form: Markdown.jsx explains in a comment WHY it does not use it.
  !/dangerouslySetInnerHTML=/.test(readerSource),
  'the reader injects HTML'
);
checkIs(
  'an edit is committed after a pause rather than per keystroke',
  /COMMIT_DELAY_MS/.test(editorSource) && /setTimeout\(commitSurface/.test(editorSource),
  'every keystroke would convert the whole document'
);
checkIs(
  'and the surface is only rebuilt for an external change',
  /asText === renderedMarkdown\.current/.test(editorSource),
  'the caret would be reset on every pass'
);

console.log('\n--- the toolbar table, against the parser and the styles ---');
check('the callout menu offers exactly the parser\u2019s kinds', CALLOUT_ACTIONS.map((a) => a.callout), ALERT_KINDS);
check('every kind has a style', ALERT_KINDS.filter((kind) => !CALLOUT_CLASSES[kind]), []);
check(
  'and the label an author sees is the kind they typed',
  ALERT_KINDS.filter((kind) => CALLOUT_CLASSES[kind].label.toLowerCase() !== kind),
  []
);
check('the action ids are unique', ACTION_IDS.length, new Set(ACTION_IDS).size);
check(
  'and every one is reachable',
  ACTION_IDS.filter((id) => !EDITOR_ACTIONS.some((action) => action.id === id)),
  []
);
// The dispatchers are two switches, so a new action could be added to the toolbar and forgotten in one of them.
// Every id must be handled by the block dispatcher, or by the text dispatcher - which routes the inline ones through
// INLINE_ACTIONS rather than a switch case, because the syntax is a property of the action, not a branch.
const engineSource = readFileSync(path.resolve(process.cwd(), 'src/utils/richMarkdown.js'), 'utf8');
const syntaxIds = INLINE_ACTIONS.filter((action) => action.syntax).map((action) => action.id);
const handled = (fnName, id) => {
  const body = new RegExp(`export const ${fnName}[\\s\\S]*?\\n\\};`).exec(engineSource)?.[0] || '';
  return new RegExp(`case '${id}':`).test(body) || new RegExp(`id === '${id}'`).test(body);
};
check(
  'every action is handled by one of the dispatchers',
  ACTION_IDS.filter(
    (id) =>
      !syntaxIds.includes(id) &&
      !handled('applyBlockCommand', id) &&
      !handled('applyTextCommand', id) &&
      !handled('blockToHtml', id)
  ),
  []
);
check('and the inline ones carry their own syntax', syntaxIds, ['bold', 'italic', 'highlight', 'code']);
check(
  'a block knows the line of text it shows',
  ['quote', 'list', 'code', 'callout'].map((type) =>
    blockLineText(
      type === 'quote'
        ? { type, text: 'a' }
        : type === 'list'
          ? { type, items: ['b'] }
          : type === 'code'
            ? { type, value: 'c' }
            : { type, blocks: [{ type: 'paragraph', text: 'd' }] }
    )
  ),
  ['a', 'b', 'c', 'd']
);
check('an entity in the HTML decodes', decodeEntities('R&amp;D'), 'R&D');
check(
  'and a void tag is recognized as one',
  tokenizeHtml('<hr>')[0],
  { type: 'open', name: 'hr', attrs: {}, void: true }
);
check('a closing tag is a close', tokenizeHtml('</p>')[0], { type: 'close', name: 'p' });

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);



