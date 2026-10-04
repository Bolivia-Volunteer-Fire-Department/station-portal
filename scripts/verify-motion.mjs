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

// Every rule in index.css that sets an animation which actually RUNS, as { selector, declarations }.
//
// Collected by shape rather than by class name, because the page transition is a DESCENDANT rule
// (`.page-enter > *`) and would be invisible to a scan for `.animate-*` classes. Anything that animates has
// to face the reduced-motion question below, whatever its selector looks like.
//
// `animation: none` rules are the reduced-motion overrides themselves, so they are excluded: they are the
// answer, not the question.
const animationRules = (source) => {
  const rules = [];
  const pattern = /(?:^|\n)([^\n{}]+?)\s*\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const declarations = match[2];
    if (!/animation:/.test(declarations)) continue;
    if (/animation:\s*none/.test(declarations)) continue;
    rules.push({ selector: match[1].trim(), declarations });
  }
  return rules;
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

// Animating rules the reduced-motion block does NOT silence.
const unpreferredAnimations = (source) => {
  const block = reducedMotionBlock(source);
  return animationRules(source)
    .map((rule) => rule.selector)
    .filter((selector) => !block.includes(selector));
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

console.log('\n--- the vocabularies, and how fast they are ---');
const quick = motionValueMs(css, 'motion-quick');
const base = motionValueMs(css, 'motion-base');
checkIs('the fast speed is defined', typeof quick === 'number', 'no --motion-quick');
checkIs('and is swift', quick !== null && quick <= 150, `${quick}ms`);
checkIs('the base speed is defined', typeof base === 'number', 'no --motion-base');
// 200ms is the ceiling for anything that decorates a STATE CHANGE. The whole point of this work was to stay
// feeling instant, and this is the number that decides it: a transition that needs longer is in the way.
checkIs('and still reads as instant', base !== null && base <= 200, `${base}ms`);
checkIs('the settle curve is defined', /--motion-settle:\s*cubic-bezier\(/.test(css));
// One longer value, for the one thing that is navigation rather than a state change: the calendars' month
// slide, which has to read as travel. It is spent twice (out, then in), so the ceiling here is what a member
// waits for a month change: 400ms is the point at which it would be faster to press the arrow again.
const slide = motionValueMs(css, 'motion-slide');
checkIs('the month slide is defined', typeof slide === 'number', 'no --motion-slide');
checkIs('and a month change stays under a third of a second', slide !== null && slide * 2 <= 350, `${slide * 2}ms for both phases`);
checkIs('the page rule is a descendant rule, so new children animate by themselves', /(?:^|\n)\.page-enter > \* \{/.test(css));
// Nothing loops. An entrance animation that never ends is a spinner.
check(
  'the only looping animation is the swap dwell',
  animationRules(css).filter(({ declarations }) => /infinite/.test(declarations)).map(({ selector }) => selector),
  ['.animate-swapDwell']
);
// Every animation takes its duration from the vocabulary rather than naming its own, so "how fast is this
// app" has one answer - except the swap animations, which predate it and are about a gesture in progress,
// and the splash, whose whole point is to outlast the interaction vocabulary: it is a brand moment played
// once per page load, not a response to a press. It is still one-shot and reduced-motion-aware (both held
// by the checks above and below), so the exception is about DURATION, not about the other two rules.
check(
  'the durations all come from the vocabulary',
  animationRules(css)
    .filter(({ declarations }) => !/var\(--motion-/.test(declarations))
    .map(({ selector }) => selector),
  ['.animate-swapDwell', '.animate-swapPop', '.splash-logo-wrap', '.splash-shimmer::before']
);

console.log('\n--- every animation honors prefers-reduced-motion ---');
// Collected, not listed: a new animation in index.css fails this until it is added to the block, whatever
// shape its selector takes.
checkIs('the animating rules were found', animationRules(css).length >= 6, JSON.stringify(animationRules(css).map((r) => r.selector)));
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

console.log('\n--- the page transition, on elements that are new by construction ---');
// The first attempt animated the CONTAINER and restarted it from JavaScript on every tab change, and it
// reported nothing on the real thing - a replay that fails is invisible, and there is no DOM harness here to
// catch it. So the mechanism changed rather than the numbers: the animation now lives on the CHILDREN of the
// container, which a tab switch replaces, so the browser starts it by itself and cannot fail to.
checkIs('the module area is marked as a page', /overscroll-y-contain p-4 sm:p-6 lg:p-8 page-enter/.test(app));
checkIs('the admin sub-tabs are too', /space-y-6 page-enter/.test(panel));
checkIs('and nothing replays it by hand any more', !/useReplayAnimation/.test(app) && !/useReplayAnimation/.test(panel));

console.log('\n--- a dialog can be dismissed through its exit ---');
// The entry was animated and the exit was one frame, so every dismissal snapped. CSS cannot do this one alone:
// the parent unmounts the dialog the moment its state changes, so the class has to go on and the callback has
// to wait for it - see useDismissAnimation.
checkIs('the exit targets the panel the entry class is on', /\.animate-overlayOut \.animate-modalIn \{/.test(css));
checkIs('and takes no clicks while it leaves', /\.animate-overlayOut \{[\s\S]{0,200}pointer-events: none/.test(css));
checkIs('the hook exists', /export function useDismissAnimation/.test(motion));
// Every dialog a member can dismiss uses it; Confirm is the one that deliberately does not (a dialog that
// lingers before acting reads as hesitation).
['ConfirmModal', 'ShiftOfferModal', 'ScheduleItemModal'].forEach((name) => {
  const source = readFileSync(`src/components/${name}.jsx`, 'utf8');
  checkIs(`${name} dismisses through the animation`, /useDismissAnimation\(/.test(source));
  checkIs(`and routes its own close controls through it`, /onClick=\{dismiss\}/.test(source));
});
checkIs('the event is the clock, not a guessed duration', /addEventListener\('animationend', finish\)/.test(motion));
// A dialog that never closes is worse than one that closes abruptly, so the animation is not the last word.
checkIs('with a fallback if the event never arrives', /setTimeout\(finish, \d+\)/.test(motion));
checkIs('and no wait at all when motion is not wanted', /if \(!node \|\| prefersReducedMotion\(\)\)/.test(motion));

console.log('\n--- the calendars travel ---');
// Two phases, because only one month is ever rendered: the old one leaves, the swap happens off the edge, and
// the new one arrives on its own animation. Direction is what makes it read as movement rather than a redraw.
['Left', 'Right'].forEach((side) => {
  checkIs(`the month can leave to the ${side.toLowerCase()}`, new RegExp(`\\.animate-monthOut${side} \\{`).test(css));
  checkIs(`and arrive from the ${side.toLowerCase()}`, new RegExp(`\\.animate-monthIn${side} \\{`).test(css));
});
checkIs('the hook exists', /export function useMonthSlide/.test(motion));
checkIs('the phases advance on the animation, not a timer', /onAnimationEnd/.test(motion));
// Every screen with month arrows slides, so a change of view is not a different experience per screen.
['ScheduleCalendar', 'AvailabilityCalendar'].forEach((name) => {
  const source = readFileSync(`src/components/${name}.jsx`, 'utf8');
  checkIs(`${name} slides its days`, /useMonthSlide\(viewDate, setViewDate/.test(source) && /onAnimationEnd=\{onAnimationEnd\}/.test(source));
});
// ...AND THE UNIT IT WALKS IS THE VIEW'S. A narrow window shows one day (utils/viewport), so its arrows step a day; the
// calendar steps a month. Both are the same hook and the same slide - see its `unit` option - and the administrator
// roster takes the default, which is months.
checkIs(
  'the member calendar steps whatever unit is on screen',
  /useMonthSlide\(viewDate, setViewDate, dayView \? 'day' : 'month'\)/.test(
    readFileSync('src/components/ScheduleCalendar.jsx', 'utf8')
  )
);
checkIs(
  'and the administrator roster still steps months, by taking the default',
  /useMonthSlide\(viewDate, setViewDate\)/.test(readFileSync('src/components/AvailabilityCalendar.jsx', 'utf8'))
);
checkIs('an unknown unit is still months', /export function useMonthSlide\(viewDate, setViewDate, unit = 'month'\)/.test(motion));
// Reduced motion gets the month, not the wait: the phases are skipped rather than run invisibly.
checkIs('a member who asked for less movement skips to the month', /if \(reduced\.current\) \{[\s\S]{0,80}setViewDate\(next\)/.test(motion));

console.log('\n--- a dialog belongs to the window, not to the card it came from ---');
// The bug this exists for: the calendar item popup came up in the MIDDLE OF THE CALENDAR CARD, with its
// shade confined to that card. A `position: fixed` overlay is positioned against its nearest transformed
// ancestor and clipped by any `overflow: hidden` one - and the page transition had put a transform on the
// module's container while every card is a rounded panel with overflow hidden. So the two things asserted
// here are the two halves of the fix, and both are the kind a later tidy-up would undo.
const declarationsFor = (source, selector) =>
  (animationRules(source).find((rule) => rule.selector === selector) || {}).declarations || '';
['.page-enter > *', '.animate-modalIn'].forEach((selector) => {
  const declarations = declarationsFor(css, selector);
  checkIs(`${selector} lets its transform go when it ends`, /backwards/.test(declarations) && !/\bboth\b/.test(declarations), declarations.trim());
});
// And the guarantee, for the 160ms the capture is still real and for any future transform: every dialog is
// rendered into document.body, where nothing between it and the viewport can reach it.
const viewportLayer = readFileSync('src/utils/viewportLayer.js', 'utf8');
checkIs('the viewport layer exists', /export function renderInViewport\(node\)/.test(viewportLayer));
checkIs('and keeps the markup visible without a DOM', /typeof document === 'undefined' \|\| !document\.body\) return node/.test(viewportLayer), 'portals emit nothing in a DOM-less render, so every markup assertion would pass vacuously');
const dialogs = componentFiles.filter((file) => /bg-slate-950\/\d+[^>]*backdrop-blur/.test(sourceOf(file)));
checkIs('the dialogs were found', dialogs.length >= 6, `${dialogs.length} found`);
check(
  'every one of them is handed to the window',
  dialogs.filter((file) => !/renderInViewport\(/.test(sourceOf(file))).map((file) => file),
  []
);
const schedule = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
checkIs('and so are the viewport-positioned popovers', /renderInViewport\(/.test(schedule) && !/createPortal/.test(schedule));

console.log('\n--- the help guides ---');
// Switching guides swapped the pane's contents between two frames, which read as abrupt for the same reason
// everything else did. Keyed on the guide, so the new one animates in and the pane (and its scroll) stay put.
const help = readFileSync('src/components/HelpGuides.jsx', 'utf8');
checkIs('the guide content is keyed on the guide', /<div key=\{activeSlug\} className="page-enter">/.test(help));
checkIs('and the pane itself is not remounted', /<article[\s\S]{0,200}?ref=\{paneRef\}/.test(help));

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
  ['.animate-newThing']
);
// 3. The press scale left on for a member who asked for less movement.
const withoutPressOff = css.replace(/\n  button:not\(:disabled\):active,\n  \[role='button'\]:not\(\[aria-disabled='true'\]\):active \{\n    transform: none;\n  \}/, '');
checkIs('the mutation really removed the override', withoutPressOff !== css);
check('and the press check fails without it', /transform:\s*none/.test(reducedMotionBlock(withoutPressOff)), false);

const SUMMARY = `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`;
console.log(SUMMARY);
process.exit(failures === 0 ? 0 : 1);
