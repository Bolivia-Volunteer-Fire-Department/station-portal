/**
 * Verifies the app's motion: what is animated, how fast, and what happens when it must not be.
 *
 * The complaint this exists for: the app was snappy to the point of feeling abrupt. A menu click replaced the
 * whole screen between two frames and a modal appeared with no beat at all, so nothing told the eye that
 * anything had HAPPENED. The fix is a small vocabulary of very short entry animations - and the risk of that
 * fix is that it turns into a hundred hard-coded durations, each a little longer than the last, until the app
 * feels slow instead of alive. So the numbers are checked, not the animations.
 *
 * Three things are asserted:
 *
 *   1. Swiftness. The vocabulary lives in three custom properties and everything uses them, so "how fast is
 *      this app" has one answer, and it can be measured. Nothing loops: an entrance animation that never
 *      finishes is a spinner, not a transition.
 *   2. Coverage. Every dialog panel carries the dialog animation, every modal backdrop fades, and every
 *      popover grows from the control it hangs off. These are the pieces that were instant, and a new modal
 *      copy-pasted from an old one is exactly how one would go back to being instant.
 *   3. The preference. `prefers-reduced-motion` is not opt-out-able here: EVERY animation class defined in
 *      index.css has to appear in the reduced-motion block, and the press scale has to be dropped with them.
 *      That is asserted by collecting the class names rather than by listing them, so a new animation cannot
 *      be added without deciding what it does for a member who has asked for less movement.
 *
 * What this cannot check: that an animation looks right, or that it is the right animation. It is a code
 * reading, in the same spirit as verify:confirmations - the browser is the only thing that can judge the feel.
 *
 * Run with: npm run verify:motion
 */
import { readFileSync, readdirSync } from 'node:fs';

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

const css = readFileSync('src/index.css', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const panel = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
const motion = readFileSync('src/utils/motion.js', 'utf8');

// Every component file, so the coverage checks below cannot miss one that is added later.
const componentFiles = (function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path);
    return /\.jsx$/.test(entry.name) ? [path] : [];
  });
})('src/components');

const sourceOf = (file) => readFileSync(file, 'utf8');

// --- the rules, as functions of source text --------------------------------------------------
// Every rule below is a predicate rather than an inline test, so the mutation section at the end can re-run it
// against a deliberately broken copy. A check that passes because it is looking at the wrong thing looks
// exactly like a check that passes because the code is right.

// Animation classes DEFINED in index.css: an `@keyframes` name with a matching `.animate-*` rule.
const definedAnimations = (source) => {
  const names = [...source.matchAll(/\.(animate-[a-zA-Z]+)\s*\{/g)].map((match) => match[1]);
  return [...new Set(names)].sort();
};

// The reduced-motion block, as text. Found by brace-matching rather than by taking the tail of the file, so
// code added after it cannot be mistaken for part of it.
const reducedMotionBlock = (source) => {
  const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
  if (start === -1) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
};

// Animations the reduced-motion block does NOT silence.
const unpreferredAnimations = (source) => {
  const block = reducedMotionBlock(source);
  return definedAnimations(source).filter((name) => !block.includes(`.${name}`));
};

// The declarations of one `.animate-*` rule, so a duration can be read out of it.
const animationDeclarations = (source, name) => {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(source);
  return match ? match[1] : '';
};

// A custom property of the motion vocabulary, in milliseconds.
const motionValueMs = (source, name) => {
  const match = new RegExp(`--${name}:\\s*([0-9.]+)s`).exec(source);
  return match ? Math.round(Number(match[1]) * 1000) : null;
};

// A dialog panel, by the classes every one of them shares: the standard dialog, and the loading card, which
// is deliberately narrower.
const DIALOG_PANELS = /className="[^"]*(?:w-full max-w-\w+ mx-4 bg-white|max-w-sm w-full mx-4)[^"]*"/g;
const panelsWithoutEntrance = (source) =>
  (source.match(DIALOG_PANELS) || []).filter((line) => !line.includes('animate-modalIn'));
const modalPanels = (files) =>
  files.flatMap((file) =>
    (sourceOf(file).match(DIALOG_PANELS) || []).map((line) => ({ file, line: line.trim() }))
  );

// A popover: positioned, and growing from the edge it is anchored to.
const linesWith = (files, needle) =>
  files.flatMap((file) =>
    sourceOf(file)
      .split('\n')
      .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
      .filter(({ text }) => text.includes(needle))
  );
const offenders = (rows, predicate) =>
  rows.filter((row) => !predicate(row.text)).map(({ file, line }) => `${file}:${line}`);

console.log('\n--- the vocabulary, and how fast it is ---');
const quick = motionValueMs(css, 'motion-quick');
const base = motionValueMs(css, 'motion-base');
checkIs('the fast speed is defined', typeof quick === 'number', 'no --motion-quick');
checkIs('and is swift', quick !== null && quick <= 150, `${quick}ms`);
checkIs('the base speed is defined', typeof base === 'number', 'no --motion-base');
// 200ms is the ceiling. The whole point of this work was to stay feeling instant, and this is the number that
// decides it: a transition that needs longer than this is a transition that is in the way.
checkIs('and still reads as instant', base !== null && base <= 200, `${base}ms`);
checkIs('the settle curve is defined', /--motion-settle:\s*cubic-bezier\(/.test(css));
// Everything added for this takes its duration from the vocabulary rather than naming its own.
['animate-pageIn', 'animate-modalIn', 'animate-popoverIn'].forEach((name) => {
  checkIs(`${name} uses the vocabulary`, /var\(--motion-(?:quick|base)\)/.test(animationDeclarations(css, name)));
});
// Nothing loops. An entrance animation that never ends is a spinner.
check(
  'the only looping animation is the swap dwell',
  definedAnimations(css).filter((name) => /infinite/.test(animationDeclarations(css, name))),
  ['animate-swapDwell']
);

console.log('\n--- every animation honors prefers-reduced-motion ---');
// Collected, not listed: a new animation class in index.css fails this until it is added to the block.
checkIs('the animations were found', definedAnimations(css).length >= 5, JSON.stringify(definedAnimations(css)));
check('all of them are silenced when motion is not wanted', unpreferredAnimations(css), []);
checkIs('and the block really is a reduced-motion block', /@media \(prefers-reduced-motion: reduce\)/.test(reducedMotionBlock(css)));
// The press scale is movement too, and it is the one the block has to disable by hand - there is no animation
// to drop, so a rule that forgot it would leave the app moving for a member who asked it not to.
checkIs('the press scale is dropped with them', /transform:\s*none/.test(reducedMotionBlock(css)));

console.log('\n--- the press feedback ---');
// Buttons only: a link can wrap a whole card, and scaling a card's contents looks like the layout moved.
checkIs('press feedback is scoped to controls', /(?:^|\n)button:not\(:disabled\):active,/.test(css));
checkIs('excluding a disabled control', /\[role='button'\]:not\(\[aria-disabled='true'\]\):active/.test(css));
checkIs('and it is subtle', /scale\(0?\.9\d+\)/.test(css));
// The trap this rule deliberately avoids: declaring `transition` here would win over Tailwind's `transition`
// utility (this file is unlayered) and silently drop every hover colour transition in the app.
const pressRuleBody = /(?:^|\n)button:not\(:disabled\):active,\s*\n?[^{]*\{([^}]*)\}/.exec(css)?.[1] || '';
checkIs('it does not take the transition shorthand from its buttons', !/transition:/.test(pressRuleBody));

console.log('\n--- the dialogs catch up with their backdrops ---');
// The backdrops already faded; the panels appeared between two frames. This is that gap.
const panels = modalPanels(componentFiles);
checkIs('the dialog panels were found', panels.length >= 6, `${panels.length} found`);
check(
  'every one of them animates in',
  componentFiles.flatMap((file) => panelsWithoutEntrance(sourceOf(file)).map((line) => `${file}: ${line.slice(0, 40)}`)),
  []
);
const backdrops = componentFiles.flatMap((file) =>
  sourceOf(file)
    .split('\n')
    .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
    .filter(({ text }) => /bg-slate-950\/\d+[^>]*backdrop-blur/.test(text))
);
checkIs('the dark backdrops were found', backdrops.length >= 6, `${backdrops.length} found`);
check('every backdrop fades rather than appearing', offenders(backdrops, (text) => text.includes('animate-fadeIn')), []);

console.log('\n--- the popovers grow from what they hang off ---');
const popovers = linesWith(componentFiles, 'animate-popoverIn');
checkIs('the popovers were found', popovers.length >= 5, `${popovers.length} found`);
check('each one is positioned off its control', offenders(popovers, (text) => /\b(?:absolute|fixed)\b/.test(text)), []);
// Without an origin the scale grows from the middle, which reads as the panel inflating out of nowhere rather
// than opening downwards from the button that was pressed.
check('and each grows from the edge it is anchored to', offenders(popovers, (text) => /origin-(?:top|top-left|top-right)\b/.test(text)), []);

console.log('\n--- the page transition, replayed in place ---');
checkIs('the module area carries it', /md:overflow-y-auto overscroll-y-contain p-4 sm:p-6 lg:p-8 animate-pageIn/.test(app));
checkIs('and replays it when the module changes', /useReplayAnimation\(activeTab\)/.test(app));
// Admin sub-tabs swap inside the same container, and that state belongs to the panel rather than to App.
checkIs(
  'the admin sub-tabs replay it too',
  /useReplayAnimation\(activeSubTab\)/.test(panel) && /space-y-6 animate-pageIn/.test(panel)
);
// The two decisions in the hook that a later tidy-up would get wrong.
checkIs('the hook winds the animation back rather than re-keying the element', /getAnimations\(\)/.test(motion));
checkIs('before the browser paints, or the destination flashes first', /useLayoutEffect/.test(motion));
checkIs('and it is a no-op where the browser cannot answer', /typeof node\.getAnimations !== 'function'/.test(motion));

console.log('\n--- teeth: the failures this would actually catch ---');
// 1. A new dialog panel that forgets the animation. This is the realistic regression: the next modal is copied
//    from an existing one and one class is left behind.
const panelCopy = 'const x = <div className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 rounded-2xl p-6">';
checkIs('a panel without the entrance is detected', panelsWithoutEntrance(panelCopy).length >= 1);
check('and a panel with it is not', panelsWithoutEntrance(panelCopy.replace('p-6', 'p-6 animate-modalIn')).length, 0);
// 2. An animation added without a reduced-motion decision - collected rather than listed, so this must fail.
check(
  'an animation missing from the reduced-motion block is detected',
  unpreferredAnimations(`${css}\n.animate-newThing { animation: newThing var(--motion-base) both; }`),
  ['animate-newThing']
);
// 3. The press scale left on for a member who asked for less movement.
const withoutPressOff = css.replace(/\n  button:not\(:disabled\):active,\n  \[role='button'\]:not\(\[aria-disabled='true'\]\):active \{\n    transform: none;\n  \}/, '');
checkIs('the mutation really removed the override', withoutPressOff !== css);
check('and the press check fails without it', /transform:\s*none/.test(reducedMotionBlock(withoutPressOff)), false);

const SUMMARY = `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`;
console.log(SUMMARY);
process.exit(failures === 0 ? 0 : 1);
