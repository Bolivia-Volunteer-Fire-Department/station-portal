/**
 * Verifies that no record id is ever shown on screen.
 *
 * What this exists for: the app used to print ids in a lot of places - an "Edit User #9f2c1e0a-..." heading, an ID
 * column in two tables, a `#{assignment_id}` chip on the member calendar, `<option>` labels, the printed schedule,
 * the author line under an announcement, and every "we could not find that member" fallback in between. An id is
 * not a name: nobody can compare two by eye, they are wider than the columns they sat in, and they show whoever is
 * looking at the screen how the records are keyed - which is an implementation detail, not information.
 *
 * Every one of those now reads as a phrase ("Unnamed member") built by one helper, `utils/displayLabel`, and the
 * rules below are what keeps it that way: a new table column, a new fallback, or a new heading is exactly where an
 * id would come back.
 *
 * What this cannot check: it reads source, so it sees the shapes an id was rendered in rather than the rendered
 * page. `verify:admin-render` renders the tabs that had them, which is what proved they are gone from the markup.
 *
 * Run with: npm run verify:no-raw-ids
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { unnamedLabel, userLabel, recordHeading } from '../src/utils/displayLabel.js';

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

// --- the rules, as functions of one line of source --------------------------------------------
//
// Functions rather than inline tests, so the mutation section below can re-run each one against a deliberately
// broken copy: a rule written against the wrong string looks exactly like a rule that works.
//
// They are evaluated per line, not over the whole file. A pattern like "a `>` then an `{…id}`" matching across a
// whole file will happily span from one element's tag to an expression three lines later, which is how a rule ends
// up flagging half the codebase - as this one did before it was written this way.
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

// A JSX gap between a tag and the expression under it is one expression to a reader, so it is collapsed onto one
// line first - otherwise `<td>` on one line and `{row.id}` on the next would be missed, which is the shape most of
// these took.
const sourceLines = (source) =>
  source
    .split('\n')
    .filter((line) => !isCommentLine(line))
    .join('\n')
    .replace(/>[ \t]*\n[ \t]*/g, '>')
    .split('\n');

// The old habit, in every form it took: `#${form.id}`, `#${slotOffer?.user_id}`.
const hasIdHash = (line) => /#\$\{[^}]*\b(id|_id)\b[^}]*\}/.test(line);
// An `ID` column, which is what two of the admin tables had.
const hasIdColumn = (line) => /<th[^>]*>\s*[Ii][Dd]\s*<\/th>/.test(line);
// An id as the text of an element: `<td>{assignment.id}</td>`.
const rendersIdText = (line) => />\s*\{[^}]*\.(id|user_id|[a-z]+_id)\s*\}/.test(line);
// A name falling back to an id, which is how it came back everywhere else - a table cell, a filter option, a
// printed sheet. Each one looked like a local decision.
const idFallback = (line) => /\{[^}]*(name|title|description|user_name)[^}]*\|\|[^}]*\.(id|user_id|[a-z]+_id)\b/.test(line);
// A tooltip whose value is an id - the shape a hover hint takes when it is fed the raw record instead of a label.
// Deliberately narrowed to that: `title={[assignmentLabel(x.assignment_id), …]}` also mentions an id, but passes it
// to a helper that returns a description, and a rule that flagged that would be flagging the fix.
const idTooltip = (line) => /title=\{[^}]*\.(id|user_id|record_id|[a-z]+_id)\s*\}/.test(line);

const RULES = [
  ['no "#${id}" in a label', hasIdHash],
  ['no ID table column', hasIdColumn],
  ["no id rendered as an element's text", rendersIdText],
  ['no name falling back to an id', idFallback],
  ['no id in a tooltip', idTooltip],
];

const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk('src');
// A walk that found nothing would make every check below pass while testing the strings in this file.
checkIs('the scan covered the source tree', sourceFiles.length > 100, `only ${sourceFiles.length} files`);

const offendersOf = (rule) =>
  sourceFiles.flatMap((file) =>
    sourceLines(readFileSync(file, 'utf8'))
      .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
      .filter(({ text }) => rule(text))
      .map(({ file: f, line, text }) => `${f}:${line} ${text.slice(0, 100)}`)
  );

for (const [label, rule] of RULES) {
  check(label, offendersOf(rule), []);
}

// --- the helper, and what it produces ---------------------------------------------------------

console.log('\n--- the wording ---');
check('an unnamed member', unnamedLabel('member'), 'Unnamed member');
check('an unnamed role', unnamedLabel('role'), 'Unnamed role');
checkIs('never with the old "#" prefix', !/^#/.test(unnamedLabel('member')));

// The order matters: a member's own name beats their sign-in name, and a blank one is not a name.
check("a member's own name", userLabel({ name: 'Jane Smith', user_name: 'jsmith' }), 'Jane Smith');
check('falling back to their sign-in name', userLabel({ user_name: 'jsmith' }), 'jsmith');
check('whitespace is not a name', userLabel({ name: '   ', user_name: 'jsmith' }), 'jsmith');
check('and neither is nothing at all', userLabel({}), 'Unnamed member');
check('a missing row is safe', userLabel(undefined), 'Unnamed member');

check("a heading names the record when it can", recordHeading('User', 'Jane Smith'), 'Edit Jane Smith');
check('and the noun when it cannot', recordHeading('User', ''), 'Edit User');
check('whitespace counts as cannot', recordHeading('User', '  '), 'Edit User');
check('and a missing label is safe', recordHeading('Timeclock Entry'), 'Edit Timeclock Entry');
checkIs('with no uuid anywhere in it', !/[0-9a-f]{8}-[0-9a-f]{4}/.test(recordHeading('User', 'Jane Smith')));

// --- 3. the checks themselves -----------------------------------------------------------------
//
// Each rule re-run against a copy broken in the way it is meant to catch. `passes` is the condition the check
// above requires: true for the real source, and false for the mutation. The rules are line predicates, so they are
// lifted to whole sources here - a source fails if any of its lines does.
console.log('\n--- the checks themselves ---');

const noneOf = (rule) => (source) => !sourceLines(source).some((line) => rule(line));

const usersTab = readFileSync('src/components/admin/AdminUsersTab.jsx', 'utf8');
const logTab = readFileSync('src/components/admin/AdminSystemLogTab.jsx', 'utf8');
const calendar = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
const clockRow = readFileSync('src/components/clock/ClockTableRow.jsx', 'utf8');

const MUTATIONS = [
  {
    label: 'a "#${id}" heading',
    source: usersTab,
    passes: noneOf(hasIdHash),
    breakIt: (s) => s.replace("recordHeading('User'", "`#${formData.id}` || recordHeading('User'"),
  },
  {
    label: 'an ID column',
    source: logTab,
    passes: noneOf(hasIdColumn),
    breakIt: (s) =>
      s.replace(
        '<th className="px-4 py-3 whitespace-nowrap">Timestamp</th>',
        '<th className="px-4 py-3 w-16">ID</th>\n                <th className="px-4 py-3 whitespace-nowrap">Timestamp</th>'
      ),
  },
  {
    label: 'an id rendered as text',
    source: calendar,
    passes: noneOf(rendersIdText),
    breakIt: (s) => s.replace('{a.timeRange}\n', '{a.timeRange}\n                      <span>{a.row.assignment_id}</span>\n'),
  },
  {
    label: 'a name falling back to an id',
    source: clockRow,
    passes: noneOf(idFallback),
    breakIt: (s) => s.replace("log.user_name || unnamedLabel('member')", 'log.user_name || log.user_id'),
  },
  {
    label: 'an id in a tooltip',
    source: logTab,
    passes: noneOf(idTooltip),
    breakIt: (s) => s.replace('title={name || undefined}', 'title={row.user_id}'),
  },
];

for (const { label, source, passes, breakIt } of MUTATIONS) {
  const broken = breakIt(source);
  checkIs(`${label}: the real source passes`, passes(source));
  checkIs(`${label}: the mutation is caught`, broken !== source && !passes(broken));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

