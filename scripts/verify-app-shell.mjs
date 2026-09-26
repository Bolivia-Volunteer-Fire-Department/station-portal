/**
 * Verifies the app shell's canvas and scrolling behaviour.
 *
 * The bug this exists for: scrolling to the very bottom of the page and then a little further (a trackpad flick, a
 * touch drag) lifted the whole app up and revealed a bright white band under it. Nothing was wrong with the layout
 * - the app paints its own background on a shell <div> as tall as the document, and everything below that was the
 * browser's default canvas, which is white. Overscroll is the only way to see it, which is why it looked
 * intermittent and device-specific.
 *
 * So there are two halves, and they fail in different ways: the canvas has to be PAINTED in the shell's own colors
 * (or the reveal is a color flash), and the overscroll has to be stopped (or the reveal happens at all). The
 * colors are checked against the shell's own classes, because a shell repaint that leaves the canvas behind would
 * only show up on the devices that overscroll.
 *
 * Run with: npm run verify:app-shell
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
const appCss = readFileSync('src/App.css', 'utf8');
const printCss = readFileSync('src/print.css', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const html = readFileSync('index.html', 'utf8');

// A rule's declarations as an object, so the checks below read like sentences. Comments are stripped first: one
// sitting between two declarations would otherwise glue itself onto the second one's name.
const ruleFor = (source, selector) => {
  const pattern = new RegExp(`(?:^|\\n)\\s*${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`);
  const match = pattern.exec(source);
  if (!match) return null;
  return Object.fromEntries(
    match[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((line) => line.trim())
      .filter((line) => line && line.includes(':'))
      .map((line) => {
        const at = line.indexOf(':');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      })
  );
};

// ---------------------------------------------------------------------------
// 1. The canvas is painted
// ---------------------------------------------------------------------------
console.log('\n--- the canvas behind the app ---');
const lightRule = ruleFor(css, 'html');
const darkRule = ruleFor(css, 'html.dark');
checkIs(
  'index.css styles the html element at all',
  !!lightRule,
  'nothing sets a canvas color, so it is the user agent default - white'
);
checkIs('and the dark theme styles it too', !!darkRule);
checkIs('the light canvas is painted', /^var\(--color-slate-\d+\)$/.test(lightRule?.['background-color'] || ''), lightRule?.['background-color']);
checkIs('the dark canvas is painted', /^var\(--color-slate-\d+\)$/.test(darkRule?.['background-color'] || ''), darkRule?.['background-color']);


// ---------------------------------------------------------------------------
// 2. ...in the shell's own colors, which is the part that can drift
// ---------------------------------------------------------------------------
// Every full-screen branch of App.jsx has to agree, because one canvas color cannot match two different shells -
// and the branch a member is looking at is the one that matters when they overscroll.
console.log('\n--- and in the same colors as the shell ---');
const shellBranches = [...app.matchAll(/className="min-h-screen ([^"]*)"/g)].map((match) => match[1]);
checkIs('the full-screen branches were found', shellBranches.length >= 2, `${shellBranches.length} found`);
const shellColors = shellBranches.map((classes) => ({
  light: /(?:\s|^)bg-slate-(\d+)/.exec(classes)?.[1] || null,
  dark: /dark:bg-slate-(\d+)/.exec(classes)?.[1] || null,
}));
check(
  'every full-screen branch paints the same two colors',
  [...new Set(shellColors.map((pair) => `${pair.light}/${pair.dark}`))].length,
  1
);
checkIs('and each of them names both', shellColors.every((pair) => pair.light && pair.dark), JSON.stringify(shellColors));
check('the canvas uses the light color the shell uses', lightRule?.['background-color'], `var(--color-slate-${shellColors[0]?.light})`);
check('the canvas uses the dark color the shell uses', darkRule?.['background-color'], `var(--color-slate-${shellColors[0]?.dark})`);
// The theme class lives on <html>, which is what `html.dark` keys off. If that moved, the dark canvas would never
// apply and the reveal would be a light band in a dark app.
checkIs('the dark class is toggled on the html element', /document\.documentElement\.classList\.toggle\('dark'/.test(app));
checkIs('and index.html ships it, so the first paint is dark too', /<html[^>]*class="dark"/.test(html));

// The head's install tags. They are a PAIR on purpose, and each half fails differently: drop the standard one and
// Chrome prints a deprecation warning and stops treating the app as standalone; drop the apple one and iOS stops
// opening it without Safari's chrome, which is the whole point of installing it there. Neither failure is visible
// in a browser on the other platform, which is exactly why it is checked rather than remembered.
console.log('\n--- the install tags in the head ---');
const headMeta = (name) =>
  new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`).exec(html)?.[1] ?? null;
check('the standard app-capable meta is declared', headMeta('mobile-web-app-capable'), 'yes');
check('and the apple-prefixed one is kept for iOS Safari', headMeta('apple-mobile-web-app-capable'), 'yes');
check('the ios title is still declared', headMeta('apple-mobile-web-app-title'), 'BFD Station Portal');
// The modern declaration, for browsers that read neither meta - and what installs the app on Android.
let manifest = '';
try {
  manifest = readFileSync('public/manifest.webmanifest', 'utf8');
} catch {
  manifest = '';
}
checkIs('and the manifest declares a standalone display', /"display":\s*"standalone"/.test(manifest), 'no display mode in the manifest');
// One place to change the navy, so the browser chrome cannot drift from the launch screen.
check(
  'the theme color matches the manifest',
  headMeta('theme-color'),
  (/"theme_color":\s*"([^"]*)"/.exec(manifest)?.[1] ?? null)
);

// ---------------------------------------------------------------------------
// 3. `color-scheme`, so the browser's own surfaces match
// ---------------------------------------------------------------------------
console.log('\n--- and the browser\'s own surfaces with it ---');
check('the light theme declares its scheme', lightRule?.['color-scheme'], 'light');
check('and the dark theme declares its own', darkRule?.['color-scheme'], 'dark');

// ---------------------------------------------------------------------------
// 4. Overscroll cannot reveal it in the first place
// ---------------------------------------------------------------------------
console.log('\n--- and overscroll cannot lift the app ---');
check('the page does not rubber-band past its end', lightRule?.['overscroll-behavior-y'], 'none');
// The desktop layout does not scroll the page at all - it scrolls a column inside it - so that column has to contain
// its own overscroll, or reaching the bottom of a long tab still lifts the document.
const scroller = /md:overflow-y-auto\s+([^`$]*)/.exec(app)?.[1] || '';
checkIs('the desktop layout has an inner scrolling column', !!scroller, scroller);
checkIs('and that column contains its overscroll', /overscroll-y-contain/.test(scroller), scroller.trim());
// The horizontal axis is deliberately left alone: the swipe-back gesture at the edge of the screen is navigation,
// not overscroll, and killing it would break going back on iOS.
checkIs('the horizontal axis is left to the browser', !/overscroll-behavior-x/.test(css) && !/overscroll-none/.test(app));


// ---------------------------------------------------------------------------
// 5b. The Help screen scrolls the guide, not the page
// ---------------------------------------------------------------------------
// Same family of question as the desktop scroll model above - which element scrolls - and the same kind of failure:
// if one link of the height chain is missing the pane simply grows instead of scrolling (or the card clips it), and
// nothing about that is visible in a diff. What has to hold: the card is bounded, the columns take the height left
// over it, and only then does the guide's `overflow-y-auto` mean anything - with the bookmarks OUTSIDE the element
// that scrolls, which is the whole point of the change.
console.log('\n--- the Help screen scrolls the guide, not the page ---');
const help = readFileSync('src/components/HelpGuides.jsx', 'utf8');
const helpCard = /<div className="bg-white[^"]*"/.exec(help)?.[0] || '';
const helpGrid = /<div className="grid gap-0[^"]*"/.exec(help)?.[0] || '';
const helpPane = /<article[\s\S]*?className="([^"]*)"/.exec(help)?.[1] || '';
const helpNav = /<nav[\s\S]*?className="([^"]*)"/.exec(help)?.[1] || '';

checkIs('the guide card is bounded on desktop', /\bmd:h-full\b/.test(helpCard) && /\bmd:flex\b/.test(helpCard), helpCard);
// The root has to end up with the height it was given, not its content's. It carries h-full (for <main>, a block
// with a definite height) and flex-1 (for the Administration panel's column, which wins the height there) because
// it has two different parents; without either, the chain breaks silently and the page scrolls again.
const helpRoot = /<div className="space-y-4[^"]*"/.exec(help)?.[0] || '';
checkIs('and the root takes the height it is given', /\bmd:h-full\b/.test(helpRoot) && /\bmd:flex-1\b/.test(helpRoot) && /\bmd:min-h-0\b/.test(helpRoot), helpRoot);
// Each caller has to give it one. The member module renders it straight into <main> (asserted above: md:h-screen),
// and the Administration panel's own wrapper is auto-height unless it cooperates - which is the trap this catches.
const panel = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
// A wrapper between the two would undo the whole chain, so both call sites are pinned as a bare render with no
// element around it. Not a style preference: `<div className="..."><HelpGuides/></div>` would make the parent
// auto-height again, `h-full` would resolve to auto, the card would grow and the bookmarks would scroll away -
// with nothing in the diff to say so.
checkIs(
  'and the member module renders it bare, with no wrapper to break the chain',
  /\{activeTab === 'help' && <HelpGuides scope="member" \/>\}/.test(app),
  'wrapping it in an element makes the parent auto-height, and the pane stops being able to scroll'
);
checkIs(
  'and so does the Administration panel',
  /\{activeSubTab === 'help' && <HelpGuides scope="admin" \/>\}/.test(panel),
  'wrapping it in an element makes the parent auto-height, and the pane stops being able to scroll'
);
checkIs('so the columns can take the height left after the header', /\bmd:flex-1\b/.test(helpGrid) && /\bmd:min-h-0\b/.test(helpGrid), helpGrid);
// grid-rows-1 is `repeat(1, minmax(0, 1fr))`: without a definite row the row would size to its content and there
// would be no overflow for the pane to scroll - the card would just grow taller than the screen again.
checkIs('and the row is exactly that height, not its content', /\bmd:grid-rows-1\b/.test(helpGrid), helpGrid);
checkIs('the guide pane is the scroller', /\bmd:overflow-y-auto\b/.test(helpPane), helpPane);
checkIs('and may shrink below its content, or it has nothing to scroll', /\bmd:min-h-0\b/.test(helpPane), helpPane);
checkIs('its overscroll is contained, so a flick past the end stays put', /\boverscroll-y-contain\b/.test(helpPane), helpPane);
checkIs('the guide list scrolls on its own rather than growing', /\bmd:overflow-y-auto\b/.test(helpNav) && /\bmd:min-h-0\b/.test(helpNav), helpNav);
// Desktop only: on a phone the page is still the scroller, and a nested one there would be a trap (two scroll
// areas on a 6-inch screen, the inner one only a few lines tall).
checkIs('all of it is desktop-only', !/(?:^|\s)overflow-y-auto(?:\s|$)/.test(helpPane) && !/(?:^|\s)overflow-y-auto(?:\s|$)/.test(helpNav), `${helpPane} | ${helpNav}`);
// The point of the change: the bookmarks are not inside the scrolling box.
checkIs('the guide list is not inside the pane that scrolls', help.indexOf('</nav>') < help.indexOf('<article'));
// A scrollable box the keyboard cannot reach is one a keyboard user cannot read past, and it should say what it is.
checkIs('the pane is a labelled region with a tab stop', /role="region"/.test(help) && /tabIndex=\{0\}/.test(help) && /aria-label=\{active \?/.test(help));

// The heading above the card is the trap: it is a SIBLING of the Help card inside <main>, so a card asking for the
// full height of main's content box is ~90px too tall (an h2, a paragraph and mb-8), and that overflow is exactly
// the bit of the guide that used to hide behind the page scroll. The fix is for <main> to become a flex column on
// this screen, so the heading is a row of the layout and the card takes what is left.
console.log('\n--- and the page heading is part of the layout ---');
checkIs(
  'the help screen makes main a flex column, and only that screen',
  /boundedHelpScreen \? 'md:flex md:flex-col' : ''/.test(app),
  'without it the card is 100% of main PLUS the heading'
);
checkIs(
  'which covers both audiences',
  /const boundedHelpScreen = activeTab === 'help' \|\| \(activeTab === 'admin' && adminSubTab === 'help'\);/.test(app)
);
// The base classes must NOT be a flex column, or every other tab's page scroll would be governed by flex rules.
checkIs('and no other screen is affected', !/md:h-screen md:overflow-y-auto[^`]*md:flex md:flex-col(?!')/.test(app), 'the flex classes leaked into the base classes');
// The heading keeps its height when the window is short, so the guide shrinks instead of the title being squashed.
checkIs('the heading cannot be squashed by a short window', /className="mb-8 md:shrink-0"/.test(app), 'no md:shrink-0 on the heading');
// The panel's own column must take the height LEFT OVER, not 100% of main - which is the same bug one level down.
checkIs(
  'the Administration panel takes the leftover height too',
  /activeSubTab === 'help' \? 'md:h-full md:min-h-0 md:flex-1 md:flex md:flex-col' : ''/.test(panel),
  'md:h-full alone asks for the heading\'s height as well'
);

// A derived value in the component body may only read state that is declared ABOVE it. Getting that wrong is not a
// broken screen, it is no app at all: `boundedHelpScreen` was first written up beside the other derived values and
// threw "Cannot access 'adminSubTab' before initialization" the moment an administrator opened that tab - which is
// the only path that reads the second half of its `||`, so nothing else noticed.
//
// Checked as source order, because nothing else can: the expression short-circuits on the initial render, so even
// rendering App whole (verify-admin-render does) never reaches it.
console.log('\n--- and it is computed after the state it reads ---');
// Every piece of component state the memo mentions, wherever it is mentioned in the expression - so a third state
// read added carelessly is caught too, not just the two it happens to use today.
const memoExpression = (/const boundedHelpScreen = ([^\n]*)/.exec(app)?.[1] || '').replace(/'[^']*'/g, '');
const memoReads = [...new Set([...memoExpression.matchAll(/([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]))].filter(
  (name) => app.includes(`const [${name},`)
);
checkIs('the memo reads some state through names', memoReads.length >= 1, memoReads.join(', '));
memoReads.forEach((name) => {
  checkIs(
    `${name} is declared before the value that reads it`,
    app.indexOf(`const [${name},`) < app.indexOf('const boundedHelpScreen ='),
    `declared at ${app.indexOf(`const [${name},`)}, read at ${app.indexOf('const boundedHelpScreen =')}`
  );
});
checkIs(
  'and it reads exactly the two the layout depends on',
  memoReads.sort().join(','),
  'activeTab,adminSubTab'
);

// Opening a guide starts at the top of it, or a long guide scrolled to its end leaves the next one open half way
// down - and now that the pane scrolls itself, nothing else moves it.
console.log('\n--- and opening a guide starts at the top of it ---');
checkIs('there is a reset when the guide changes', /useEffect\(\(\) => \{[\s\S]{0,400}?pane\.scrollTo\(\{ top: 0 \}\)/.test(help));
checkIs('keyed on the open guide', /\}, \[activeSlug\]\);/.test(help));
checkIs('using the page as the scroller below md, where the pane is not one', /pane\.scrollIntoView\(\{ block: 'start' \}\)/.test(help));
// Skipped on the first render: arriving on the screen is not a change of guide, and a scroll then would fight the
// browser restoring where the member was.
checkIs('and skipped when nothing actually changed', /const previous = shownSlug\.current;/.test(help) && /if \(previous === activeSlug\) return;/.test(help));

// ---------------------------------------------------------------------------
// 5. Nothing paints the canvas white outside printing
// ---------------------------------------------------------------------------
// The symptom was a WHITE band, so any white background that could reach the canvas is a regression - except in the
// print stylesheet, where the sheet is a white page on purpose.
console.log('\n--- nothing paints it white on screen ---');
const withoutPrintBlocks = (source) => source.replace(/@media print\s*\{[\s\S]*\n\}/g, '');
[['src/index.css', css], ['src/App.css', appCss], ['src/print.css', printCss]].forEach(([name, source]) => {
  const onScreen = withoutPrintBlocks(source);
  checkIs(
    `${name} has no white background outside @media print`,
    !/background(-color)?:\s*(#fff\b|#ffffff\b|white\b|rgb\(255, 255, 255\))/i.test(onScreen)
  );
});
checkIs('while the print sheet does paint itself white, on purpose', /background:\s*#fff/i.test(printCss));

// ---------------------------------------------------------------------------
// 6. Teeth
// ---------------------------------------------------------------------------
// These are string matches on CSS and JSX, so take each thing out and confirm its check would notice.
console.log('\n--- and the checks would notice ---');
const withoutOverscroll = css.replace('overscroll-behavior-y: none;', '');
checkIs('the mutation changed the stylesheet', withoutOverscroll !== css);
checkIs('so the overscroll check fails without it', ruleFor(withoutOverscroll, 'html')?.['overscroll-behavior-y'] !== 'none');
const withoutCanvas = css.replace(/html\s*\{[^}]*\}/, 'html {\n}');
checkIs('and the canvas check fails with the color taken out', !ruleFor(withoutCanvas, 'html')?.['background-color']);
const repaintedShell = app.replace('bg-slate-100', 'bg-white');
checkIs('the mutation repainted the shell', repaintedShell !== app);
const repaintedLight = /className="min-h-screen ([^"]*)"/.exec(repaintedShell)?.[1] || '';
const shellLight = /\sbg-slate-(\d+)/.exec(' ' + repaintedLight)?.[1] || null;
checkIs(
  'and the drift check between shell and canvas would fail',
  shellLight !== shellColors[0]?.light,
  `shell would be ${shellLight}, canvas still ${shellColors[0]?.light}`
);
// The link whose absence is invisible: without min-h-0 on the pane the column refuses to shrink, so there is no
// overflow and nothing scrolls - the card simply grows and the bookmarks scroll away again, exactly as before.
const withoutShrink = help.replace('md:min-h-0 md:overflow-y-auto', 'md:overflow-y-auto');
const withoutHeadingRow = app.replace("boundedHelpScreen ? 'md:flex md:flex-col' : ''", "''");
checkIs('the mutation took the heading out of the layout', withoutHeadingRow !== app);
checkIs(
  'so the page is a flex column again and the card overflows by the heading',
  !/boundedHelpScreen \? 'md:flex md:flex-col' : ''/.test(withoutHeadingRow)
);
checkIs('the mutation changed the Help component', withoutShrink !== help);
const mutatedPane = /<article[\s\S]*?className="([^"]*)"/.exec(withoutShrink)?.[1] || '';
checkIs('and the pane is stripped of its ability to shrink', !/\bmd:min-h-0\b/.test(mutatedPane), mutatedPane);
// The other half of the same failure: the panel stops handing down a height, so the member module keeps working
// and the Administration one quietly goes back to scrolling the whole page.
const withoutPanelHeight = panel.replace("activeSubTab === 'help' ? 'md:h-full md:min-h-0 md:flex-1 md:flex md:flex-col' : ''", "''");
checkIs('the mutation removed the panel\'s height', withoutPanelHeight !== panel);
checkIs(
  'and the panel-cooperation check fails without it',
  !/activeSubTab === 'help' \? 'md:h-full md:min-h-0 md:flex-1 md:flex md:flex-col' : ''/.test(withoutPanelHeight)
);

// A class name is not a class: Tailwind emits only the utilities it recognises, so a typo (or a name that is not a
// utility at all) produces a class attribute the browser ignores and a layout that silently does not work - while
// every source check above passes. These three are the load-bearing ones for the pane.
//
// Conditional on a build being present, because this verifier deliberately does not need one: run it after
// `npm run build` (as CI does) and it will check the generated stylesheet too.
const builtCss = (() => {
  try {
    const dir = 'dist/assets';
    const file = readdirSync(dir).find((name) => name.endsWith('.css'));
    return file ? readFileSync(`${dir}/${file}`, 'utf8') : '';
  } catch {
    return '';
  }
})();
if (!builtCss) {
  console.log('\n--- (no build in dist/, so the generated utilities were not checked) ---');
} else {
  console.log('\n--- and the classes the layout relies on are real utilities ---');
  // Selectors, not declarations: several of these declarations exist for other variants too, so only the escaped
  // class selector proves the utility was GENERATED. Tailwind emits nothing for a class name it does not know,
  // which is how a typo becomes a layout that silently does not work.
  [
    'md:h-full',
    'md:flex-1',
    'md:min-h-0',
    'md:flex-col',
    'md:shrink-0',
    'md:grid-rows-1',
    'md:overflow-y-auto',
    'overscroll-y-contain',
  ].forEach((className) => {
    checkIs(`Tailwind emits ${className}`, builtCss.includes(`.${className.replace(':', '\\:')}`), `no .${className} selector`);
  });
}

// Teeth: the same failure mode as the layout links - a quietly removed tag, on a platform the developer is
// probably not looking at.
const withoutStandard = html.replace('<meta name="mobile-web-app-capable" content="yes" />', '');
checkIs('the mutation removed the standard meta', withoutStandard !== html);
checkIs(
  'and the deprecation check fails without it',
  new RegExp('<meta\\s+name="mobile-web-app-capable"\\s+content="([^"]*)"').exec(withoutStandard)?.[1] !== 'yes'
);
const withoutApple = html.replace('<meta name="apple-mobile-web-app-capable" content="yes" />', '');
checkIs('the mutation removed the apple meta', withoutApple !== html);
checkIs(
  'and iOS standalone would be lost with it',
  new RegExp('<meta\\s+name="apple-mobile-web-app-capable"\\s+content="([^"]*)"').exec(withoutApple)?.[1] !== 'yes'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
