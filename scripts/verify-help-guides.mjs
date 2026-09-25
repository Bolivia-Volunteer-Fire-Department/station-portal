/**
 * Verifies the help guides: the markdown parser, and the guides loaded from disk.
 *
 * Two things are worth locking down:
 *
 *   1. The parser is a hand-written subset, so its edges are exactly where a guide would render
 *      wrong - emphasis that should stay literal (snake_case, "2 * 3 * 4"), an unterminated code
 *      fence, tables, and the fact that HTML in a guide must stay TEXT (nothing is ever injected
 *      as markup).
 *   2. The guides are loaded by a glob, and a glob that matches nothing fails silently: the tab
 *      would render an empty list with no error anywhere. So this asserts both folders load, that
 *      they are separate sets, and that every guide has a parseable body.
 *
 * Run with: npm run verify:help
 */
import { ALERT_KINDS, markdownTitle, parseInline, parseMarkdown } from '../src/utils/markdown.js';
import { HELP_SCOPES, hasGuideContent, helpFolderFor, helpGuides } from '../src/utils/helpGuides.js';
import { ADMIN_PERMISSIONS, ADMIN_PERMISSIONLESS_TABS } from '../src/utils/permissions.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

// Flattens inline tokens to the text they would render, for readable assertions.
const plain = (tokens) =>
  (tokens || [])
    .map((token) => {
      if (token.type === 'code') return token.value;
      if (token.type === 'text') return token.value;
      return plain(token.children);
    })
    .join('');

const types = (tokens) => (tokens || []).map((token) => token.type);

console.log('--- blocks ---');
check('headings carry their level', parseMarkdown('# One\n\n### Three')[0].level, 1);
check('and their text', plain(parseMarkdown('## Two words')[0].children), 'Two words');
check(
  'blank lines separate blocks',
  parseMarkdown('first\n\nsecond').map((b) => b.type),
  ['paragraph', 'paragraph']
);
check(
  'wrapped lines join into one paragraph',
  plain(parseMarkdown('one\ntwo\nthree')[0].children),
  'one two three'
);
check('a rule', parseMarkdown('---').map((b) => b.type), ['rule']);
check('crlf is normalised', parseMarkdown('# A\r\n\r\nB').length, 2);
check('empty input is no blocks', parseMarkdown(''), []);
check('whitespace-only input is no blocks', parseMarkdown('   \n\n  \n'), []);

console.log('\n--- lists ---');
const bullets = parseMarkdown('- one\n- two')[0];
check('unordered lists', [bullets.type, bullets.ordered, bullets.items.length], ['list', false, 2]);
check('and their items', bullets.items.map(plain), ['one', 'two']);
const numbered = parseMarkdown('1. first\n2. second')[0];
check('ordered lists', [numbered.type, numbered.ordered], ['list', true]);
check('a different marker ends the list', parseMarkdown('- one\n1. two').map((b) => b.type), ['list', 'list']);

console.log('\n--- code ---');
const fenced = parseMarkdown('```js\nconst a = 1;\n```')[0];
check('fenced code keeps its language', fenced.language, 'js');
check('and its body verbatim', fenced.value, 'const a = 1;');
check('and is not parsed', fenced.value.includes('**'), false);
check('markers inside code are untouched', parseMarkdown('```\n**not bold**\n```')[0].value, '**not bold**');
const unclosed = parseMarkdown('```\nstill code\nmore code')[0];
check('an unterminated fence runs to the end', [unclosed.type, unclosed.value], ['code', 'still code\nmore code']);
check('inline code is a token', types(parseInline('use `npm run` here')), ['text', 'code', 'text']);

console.log('\n--- quotes and tables ---');
check('consecutive quote lines become one block', plain(parseMarkdown('> one\n> two')[0].children), 'one two');
const table = parseMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')[0];
check('a table', table.type, 'table');
check('with a header row', table.head.map(plain), ['a', 'b']);
check('and body rows', table.rows.map((row) => row.map(plain)), [['1', '2']]);
check('a pipe in a paragraph stays a paragraph', parseMarkdown('a | b')[0].type, 'paragraph');

console.log('\n--- inline ---');
check('bold', types(parseInline('**bold**')), ['bold']);
check('italic with asterisks', types(parseInline('*it*')), ['italic']);
check('italic with underscores', types(parseInline('_it_')), ['italic']);
check('bold body is recursive', plain(parseInline('**a b**')[0].children), 'a b');
check('links keep their target', parseInline('[docs](https://x.test/a)')[0].href, 'https://x.test/a');
check('and their text', plain(parseInline('[docs](https://x.test)')[0].children), 'docs');
check('several runs in one line', types(parseInline('**b** and `c`')), ['bold', 'text', 'code']);
check('unmatched bold stays text', types(parseInline('**nope')), ['text']);

// The literal-preservation cases: these are what a help guide author hits by accident.
check('snake_case is not italic', types(parseInline('schedule_template_id')), ['text']);
check('spaced asterisks are not italic', types(parseInline('2 * 3 * 4')), ['text']);
check('unhugged delimiters stay literal', plain(parseInline('* not italic *')), '* not italic *');
check('a bare asterisk survives', types(parseInline('a * b')), ['text']);
check('html is text, never markup', types(parseInline('<script>alert(1)</script>')), ['text']);
check('and keeps its characters', plain(parseInline('<b>hi</b>')), '<b>hi</b>');
check('an empty-ish line does not throw', types(parseInline('**')), ['text']);

console.log('\n--- titles ---');
check('the first heading is the title', markdownTitle('# My Guide\n\ntext'), 'My Guide');
check('a later heading is ignored', markdownTitle('intro\n\n## Later'), '');
check('no heading means no title', markdownTitle('just text'), '');

console.log('\n--- guides on disk ---');
const emptyGuides = [];
for (const scope of HELP_SCOPES) {
  const guides = helpGuides(scope);
  check(`${scope}: at least one guide loads`, guides.length > 0, true);
  check(
    `${scope}: every guide has a title and a path`,
    guides.every((g) => g.title.length > 0 && g.path.endsWith('.md') && g.slug.length > 0),
    true
  );
  check(
    `${scope}: slugs are unique`,
    new Set(guides.map((g) => g.slug)).size === guides.length,
    true
  );
  // An empty guide is reported rather than failed on: a placeholder you have only just created is
// legitimate, and the Help screen renders an explanation for it instead of a blank pane. It is
// still surfaced here so a leftover file does not go unnoticed.
  guides.forEach((g) => {
    if (!hasGuideContent(g)) emptyGuides.push(g.path);
  });
  // A title is required, but not necessarily an H1 in the file.
  //
  // helpGuides derives one from the filename when a guide has no heading (01-getting-started.md ->
  // "Getting started"), and that is a deliberate authoring choice: HelpGuides already renders the
  // title as a heading above the body, so a guide that ALSO starts with `# Title` shows it twice.
  // Asserting "has an H1" would be stricter than the product and would fail a guide that reads
  // correctly, so this checks what a reader actually gets: a non-empty resolved title.
  check(
    `${scope}: every non-empty guide resolves to a title`,
    guides.filter((g) => hasGuideContent(g)).every((g) => g.title.trim().length > 0),
    true
  );
  check(`${scope}: sorted by filename`, [...guides].map((g) => g.path), guides.map((g) => g.path).sort());

  // Numbering: 01..N, no gaps and no duplicates.
  //
  // The prefix IS the display order in the Help list, so this is the invariant a hand-renumbering
  // breaks. Inserting a guide between 12 and 13 by calling it "14" leaves the list out of order, and
  // a copy-paste that forgets to renumber leaves two of the same. Both are silent otherwise.
  const numbers = guides.map((g) => g.slug.split('-')[0]);
  check(
    `${scope}: every guide is numbered`,
    numbers.every((n) => /^\d{2}$/.test(n)),
    true
  );
  check(
    `${scope}: numbering is 01..${String(guides.length).padStart(2, '0')} with no gaps`,
    numbers,
    Array.from({ length: guides.length }, (_, i) => String(i + 1).padStart(2, '0'))
  );
}

const memberPaths = helpGuides('member').map((g) => g.path);
const adminPaths = helpGuides('admin').map((g) => g.path);
check('the two folders are different sets', memberPaths.some((p) => adminPaths.includes(p)), false);
check('an unknown scope falls back to member', helpGuides('nope').length, memberPaths.length);

// --- no hard wrapping ---------------------------------------------------------------------------
//
// ONE LINE PER PARAGRAPH, and one line per list item. This is not a style preference:
//
//   * a wrapped list item ends its list at the break, so the continuation renders as a stray
//     paragraph outside the list;
//   * a wrapped emphasis span leaves an unpaired `*` on each line, and both render as LITERAL
//     asterisks rather than italics.
//
// Both were present in the shipped guides. The rule is exactly what the parser does: two consecutive
// lines that are both plain text means someone hard-wrapped something.
console.log('\n--- markdown alerts ---');
const alertBlocks = (source) => parseMarkdown(source);

// All five GitHub kinds are recognised, whatever the case.
for (const kind of ALERT_KINDS) {
  const parsed = alertBlocks('> [!' + kind.toUpperCase() + ']\n> Body text.');
  check(`${kind}: parsed as an alert`, [parsed[0].type, parsed[0].kind], ['alert', kind]);
  check(`${kind}: with its body`, plain(parsed[0].blocks[0].children), 'Body text.');
}
check('a lowercase marker works', alertBlocks('> [!caution]\n> x')[0].kind, 'caution');
check('a mixed-case marker works', alertBlocks('> [!Caution]\n> x')[0].kind, 'caution');

// The marker may share its line with the body - what a reflowed one-liner looks like.
const oneLine = alertBlocks('> [!NOTE] Everything on one line.');
check('a one-line alert parses', [oneLine[0].type, oneLine[0].kind], ['alert', 'note']);
check('with the body taken from the marker line', plain(oneLine[0].blocks[0].children), 'Everything on one line.');

// A body is parsed as markdown in its own right.
const rich = alertBlocks('> [!WARNING]\n> First para.\n>\n> Second para.\n>\n> - one\n> - two');
check('a multi-paragraph alert keeps its paragraphs', rich[0].blocks.map((b) => b.type), ['paragraph', 'paragraph', 'list']);
check('and its list items', rich[0].blocks[2].items.map(plain), ['one', 'two']);
const withCode = alertBlocks('> [!TIP]\n> ```\n> keep  me\n> ```');
check('code inside an alert is kept verbatim', withCode[0].blocks[0].value, 'keep  me');
const withInline = alertBlocks('> [!IMPORTANT]\n> Use **bold** and `code`.');
check('inline emphasis inside an alert is parsed', types(withInline[0].blocks[0].children), ['text', 'bold', 'text', 'code', 'text']);

// Refusals: an unrecognised kind is a QUOTE, not an alert with a wrong label - the marker text stays
// visible so a typo is seen rather than silently styled.
const unknown = alertBlocks('> [!DANGER]\n> Nope.');
check('an unsupported kind stays a quote', unknown[0].type, 'quote');
check('and shows its marker as text', plain(unknown[0].children).includes('[!DANGER]'), true);
check('a bare marker with no body is still an alert', alertBlocks('> [!NOTE]')[0].type, 'alert');
check('with no blocks', alertBlocks('> [!NOTE]')[0].blocks, []);
check('an ordinary quote is untouched', alertBlocks('> Just a quote.')[0].type, 'quote');
check('and still joins its lines', plain(alertBlocks('> one\n> two')[0].children), 'one two');
// `[!NOTE]` only counts at the START of the first line, so a quote that merely mentions it is a quote.
check('a mid-quote marker is not an alert', alertBlocks('> Text [!NOTE] more')[0].type, 'quote');

// Every marker in the SHIPPED guides must be a supported kind: an unsupported one renders as a quote
// with a literal `[!TYPO]` in the text, which is exactly the defect this feature fixes.
const unsupportedMarkers = [];
for (const scope of HELP_SCOPES) {
  for (const guide of helpGuides(scope)) {
    const lines = guide.markdown.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^>\s*\[!([A-Za-z]+)\]/.exec(lines[i]);
      if (!match) continue;
      if (ALERT_KINDS.indexOf(match[1].toLowerCase()) === -1) {
        unsupportedMarkers.push(`${guide.path}:${i + 1} [!${match[1]}]`);
      }
      // A marker with no `>` line under it renders an alert box with nothing in it.
      if (!/^>/.test(lines[i + 1] || '')) {
        unsupportedMarkers.push(`${guide.path}:${i + 1} has no body line`);
      }
    }
  }
}
check('every alert marker in the guides is supported and has a body', unsupportedMarkers, []);

// Whitespace that markdown treats as identical: a run of blank lines, or a file that does not end in
// exactly one newline. `npm run fix:guides` fixes all of it.
//
// Reported as a NOTE rather than a failure. These change nothing about how a guide renders, and the
// guides are hand-edited by a person whose editor has its own habits - a stray blank line should not
// stop the suite that verifies the app's code. The checks that DO fail are the ones with a visible
// consequence: a hard wrap (which breaks a list item into a stray paragraph), an unsupported alert
// marker (which renders literally), and missing coverage.
const formatting = [];
for (const scope of HELP_SCOPES) {
  for (const guide of helpGuides(scope)) {
    const markdown = guide.markdown;
    if (markdown.endsWith('\n\n')) formatting.push(`${guide.path}: extra blank line at the end`);
    if (!markdown.endsWith('\n')) formatting.push(`${guide.path}: no newline at the end`);
    // A run of blank lines outside a fence. Three newlines is two blank lines.
    const sections = markdown.split('```');
    sections.forEach((section, index) => {
      if (index % 2 === 1) return; // inside a fence
      if (/\n\s*\n\s*\n/.test(section)) formatting.push(`${guide.path}: consecutive blank lines`);
    });
  }
}

const formattingIssues = [...new Set(formatting)];
if (formattingIssues.length) {
  console.log(`\nNOTE ${formattingIssues.length} cosmetic guide formatting item(s) - run 'npm run fix:guides':`);
  formattingIssues.slice(0, 6).forEach((item) => console.log(`     ${item}`));
  if (formattingIssues.length > 6) console.log(`     ...and ${formattingIssues.length - 6} more`);
} else {
  console.log('\nok   guide whitespace is tidy');
}

console.log('\n--- no hard wrapping ---');

const HEADING = /^#{1,6}\s/;
const FENCE = /^```/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?/;
const TABLE_ROW = /^\s*\|/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
// A line that begins something new rather than continuing the line above it.
const startsBlock = (line) => HEADING.test(line) || FENCE.test(line) || RULE.test(line) ||
  QUOTE.test(line) || TABLE_ROW.test(line) || LIST_ITEM.test(line);
// Body text: neither blank, nor the start of a block. This is what a continuation line looks like.
const isPlainProse = (line) => line.trim() !== '' && !startsBlock(line);

const wrapped = [];
for (const scope of HELP_SCOPES) {
  for (const guide of helpGuides(scope)) {
    const lines = guide.markdown.split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      if (FENCE.test(lines[i])) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const current = lines[i];
      const next = lines[i + 1];
      if (next === undefined) continue;
      if (!isPlainProse(next)) continue;

      // A continuation is only a problem after BODY TEXT or a LIST ITEM. A heading, rule or quote may
      // legitimately be followed straight by its paragraph, and a table row is its own line by
      // definition - so those are left alone. (Leaving list items out of this test is what let the
      // first version pass on a wrapped bullet, so the predecessor list is deliberately explicit.)
      if (isPlainProse(current) || LIST_ITEM.test(current)) {
        wrapped.push(`${guide.path}:${i + 2} ${next.trim().slice(0, 60)}`);
      }
    }
  }
}
check('no guide hard-wraps a paragraph or a list item', wrapped, []);
console.log('\n--- the empty-guide rule ---');
// A file that exists but has no content is still listed, and the screen explains that rather than
// showing a blank pane. Asserted here rather than through a real empty file, so the check does not
// depend on a placeholder existing in the repository.
check('a guide with content has content', hasGuideContent({ markdown: '# Title' }), true);
check('an empty guide does not', hasGuideContent({ markdown: '' }), false);
check('nor does a whitespace-only one', hasGuideContent({ markdown: '   \n\n  ' }), false);
check('a missing markdown field is empty', hasGuideContent({}), false);
check('and a missing guide is empty', hasGuideContent(undefined), false);
check('the help folder path is reported for the empty state', helpFolderFor('member'), 'src/content/help/member/');
check('and the admin one', helpFolderFor('admin'), 'src/content/help/admin/');

console.log('\n--- one guide per module and per tab ---');
// The administrator set must cover every Administration tab this app can show, so adding a tab
// without documenting it is caught here rather than noticed months later. Tab ids come from the
// permission catalogue (plus the permissionless tabs), which is plain data with no React in it.
const adminSlugs = helpGuides('admin').map((g) => g.slug).join(' ');
const requiredAdminTabs = [
  ...ADMIN_PERMISSIONS.map((permission) => permission.tab),
  ...ADMIN_PERMISSIONLESS_TABS,
];
const undocumentedTabs = requiredAdminTabs.filter((tab) => !adminSlugs.includes(tab));
check('every Administration tab has a guide', undocumentedTabs, []);
check('and the admin set leads with an overview', helpGuides('admin')[0].slug.indexOf('getting-started') !== -1, true);

// The member set: every module in the sidebar, plus the hidden game, which is documented because
// members reach it by accident.
const memberSlugs = helpGuides('member').map((g) => g.slug).join(' ');
const requiredMemberModules = [
  'getting-started',
  'training',
  'timeclock',
  'clock-history',
  'my-schedule',
  'my-availability',
  'user-settings',
  'help',
  'firefighter-runner',
];
const undocumentedModules = requiredMemberModules.filter((module) => !memberSlugs.includes(module));
check('every member module has a guide', undocumentedModules, []);
check('and the member set leads with an overview', helpGuides('member')[0].slug.indexOf('getting-started') !== -1, true);

if (emptyGuides.length > 0) {
  console.log(`\nNOTE: ${emptyGuides.length} guide file(s) have no content yet:`);
  emptyGuides.forEach((path) => console.log(`  ${path}`));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
