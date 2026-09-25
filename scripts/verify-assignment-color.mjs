// Verifies the assignment colour rules (utils/assignmentColor).
//
// Two things matter here and neither is obvious from reading the code:
//
//   1. An assignment with NO colour configured must keep exactly the colour it
//      has always had. The automatic colour used to be emitted as `hsl(...)` and
//      is now a hex string, so this checks the hue is unchanged - otherwise every
//      uncoloured assignment would silently change colour the moment this shipped.
//   2. Every colour returned must be a valid hex, because the admin picker is an
//      <input type="color"> and silently rejects anything else (falling back to
//      black), and because the stored value and the swatch must be comparable.
//
// Run with: npm run verify:assignment-color
import { assignmentColor, configuredAssignmentColor, parseHexColor } from '../src/utils/assignmentColor.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};
const assert = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(
    `${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`
  );
};

// The hue function exactly as it shipped before the `color` column existed. Used
// only as an oracle: the derived colour must still resolve to this hue.
const legacyHue = (id) => {
  const str = String(id ?? '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.codePointAt(i);
    hash = (hash * 16777619) & 0x7fffffff;
  }
  return Math.round((hash * 137.50776) % 360);
};

const hexToHsl = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
};

const HEX6 = /^#[0-9a-f]{6}$/;

console.log('--- a configured colour is used as-is ---');
const configured = [{ id: '3', color: '#ef4444' }];
check('stored hex wins', assignmentColor('3', configured), '#ef4444');
check('id types are compared as strings', assignmentColor(3, configured), '#ef4444');
check('longer ids too', assignmentColor('a-12', [{ id: 'a-12', color: '#0a2a5b' }]), '#0a2a5b');

console.log('\n--- colours are normalized on the way in ---');
check('uppercase becomes lowercase', assignmentColor('1', [{ id: '1', color: '#ABCDEF' }]), '#abcdef');
check('a missing # is added', assignmentColor('1', [{ id: '1', color: 'abc123' }]), '#abc123');
check('3-digit shorthand expands', assignmentColor('1', [{ id: '1', color: '#f00' }]), '#ff0000');
check('surrounding whitespace is ignored', assignmentColor('1', [{ id: '1', color: '  #abcdef  ' }]), '#abcdef');

console.log('\n--- anything unusable falls back to the automatic colour ---');
const automatic = assignmentColor('3');
[
  ['empty', ''],
  ['whitespace', '   '],
  ['null', null],
  ['undefined', undefined],
  ['a css colour name', 'red'],
  ['a bad hex', '#12345'],
  ['a too-long hex', '#1234567']
].forEach(([label, color]) => {
  check(`${label} falls back`, assignmentColor('3', [{ id: '3', color }]), automatic);
});
check('an assignment with no row at all falls back', assignmentColor('99', configured), assignmentColor('99'));
check('a missing assignments array is safe', assignmentColor('3', undefined), automatic);
check('configuredAssignmentColor reports nothing to use', configuredAssignmentColor('3', [{ id: '3', color: '' }]), null);

console.log('\n--- the automatic colour is the same colour as before ---');
['1', '2', '3', '7', 'am-7', 'assignment-42', 'x'].forEach((id) => {
  const derived = assignmentColor(id);
  const hsl = hexToHsl(derived);
  const expectedHue = legacyHue(id);
  const delta = Math.min(Math.abs(hsl.h - expectedHue), 360 - Math.abs(hsl.h - expectedHue));
  assert(`hue preserved for id ${id} (${derived})`, delta <= 1.5, { got: hsl.h, expected: expectedHue });
});

console.log('\n--- every returned colour is a valid hex (the picker requires this) ---');
const inputs = [
  ['1', []],
  ['2', [{ id: '2', color: '#123456' }]],
  ['3', [{ id: '3', color: 'nonsense' }]],
  ['', []],
  [null, []],
  [undefined, configured],
  ['4', [{ id: '4', color: '#abc' }]]
];
assert(
  'every input produces a 6-digit hex',
  inputs.every(([id, list]) => HEX6.test(assignmentColor(id, list))),
  inputs.map(([id, list]) => assignmentColor(id, list))
);
assert(
  'parseHexColor accepts every rendered colour',
  inputs.every(([id, list]) => parseHexColor(assignmentColor(id, list)) !== null)
);

console.log('\n--- determinism and spread ---');
check('repeated calls agree', assignmentColor('5'), assignmentColor('5'));
const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
assert('consecutive ids get spread-out colours', new Set(ids.map((id) => assignmentColor(id))).size > 5);
assert('ids differing only in case are different assignments', assignmentColor('ab') !== assignmentColor('AB'));

console.log('\n--- parseHexColor boundaries ---');
[
  ['#abcdef', '#abcdef'],
  ['ABCDEF', '#abcdef'],
  ['#abc', '#aabbcc'],
  ['#abcd', null],
  ['abcdef0', null],
  ['', null],
  [null, null],
  ['hsl(200, 70%, 45%)', null]
].forEach(([input, expected]) => check(`parseHexColor(${JSON.stringify(input)})`, parseHexColor(input), expected));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

