/**
 * Verifies the app shell's canvas and scrolling behavior.
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
const sidebar = readFileSync('src/components/Sidebar.jsx', 'utf8');
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
const shellBranches = [...app.matchAll(/className="min-h-dvh ([^"]*)"/g)].map((match) => match[1]);
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
// The fuller window is asked for through `display_override`, never by changing `display`: iOS requires
// `display: standalone` before it will deliver push notifications to an installed app, and it ignores
// `display_override` outright. So the two lines do different jobs and both have to stay.
checkIs(
  'and asks for a full-screen window alongside it',
  /"display_override":\s*\[\s*"fullscreen"/.test(manifest),
  'Android would keep its status bar'
);
checkIs(
  'without touching the display mode iOS reads',
  /"display":\s*"standalone"/.test(manifest) && !/"display":\s*"fullscreen"/.test(manifest),
  'iOS push needs display: standalone'
);
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
// Each caller has to give it one. The member module renders it straight into <main> (asserted above: md:h-dvh),
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
checkIs('the pane is a labeled region with a tab stop', /role="region"/.test(help) && /tabIndex=\{0\}/.test(help) && /aria-label=\{active \?/.test(help));

// The heading above the card is the trap: it is a SIBLING of the Help card inside <main>, so a card asking for the
// full height of main's content box is ~90px too tall (an h2, a paragraph and mb-8), and that overflow is exactly
// the bit of the guide that used to hide behind the page scroll. The fix is for <main> to become a flex column on
// this screen, so the heading is a row of the layout and the card takes what is left.
console.log('\n--- and the page heading is part of the layout ---');
checkIs(
  'the help screen makes main a flex column, and only that screen',
  /boundedScreen \? 'md:flex md:flex-col' : ''/.test(app),
  'without it the card is 100% of main PLUS the heading'
);
checkIs(
  'which covers both audiences',
  /const boundedScreen = activeTab === 'help' \|\| activeTab === 'documents' \|\| \(activeTab === 'admin' && adminSubTab === 'help'\);/.test(app)
);
// The base classes must NOT be a flex column, or every other tab's page scroll would be governed by flex rules.
checkIs('and no other screen is affected', !/md:h-dvh md:overflow-y-auto[^`]*md:flex md:flex-col(?!')/.test(app), 'the flex classes leaked into the base classes');
// The heading keeps its height when the window is short, so the guide shrinks instead of the title being squashed.
checkIs('the heading cannot be squashed by a short window', /className="mb-8 md:shrink-0"/.test(app), 'no md:shrink-0 on the heading');
// The panel's own column must take the height LEFT OVER, not 100% of main - which is the same bug one level down.
checkIs(
  'the Administration panel takes the leftover height too',
  /activeSubTab === 'help' \? 'md:h-full md:min-h-0 md:flex-1 md:flex md:flex-col' : ''/.test(panel),
  'md:h-full alone asks for the heading\'s height as well'
);

// A derived value in the component body may only read state that is declared ABOVE it. Getting that wrong is not a
// broken screen, it is no app at all: `boundedScreen` was first written up beside the other derived values and
// threw "Cannot access 'adminSubTab' before initialization" the moment an administrator opened that tab - which is
// the only path that reads the second half of its `||`, so nothing else noticed.
//
// Checked as source order, because nothing else can: the expression short-circuits on the initial render, so even
// rendering App whole (verify-admin-render does) never reaches it.
console.log('\n--- and it is computed after the state it reads ---');
// Every piece of component state the memo mentions, wherever it is mentioned in the expression - so a third state
// read added carelessly is caught too, not just the two it happens to use today.
const memoExpression = (/const boundedScreen = ([^\n]*)/.exec(app)?.[1] || '').replace(/'[^']*'/g, '');
const memoReads = [...new Set([...memoExpression.matchAll(/([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]))].filter(
  (name) => app.includes(`const [${name},`)
);
checkIs('the memo reads some state through names', memoReads.length >= 1, memoReads.join(', '));
memoReads.forEach((name) => {
  checkIs(
    `${name} is declared before the value that reads it`,
    app.indexOf(`const [${name},`) < app.indexOf('const boundedScreen ='),
    `declared at ${app.indexOf(`const [${name},`)}, read at ${app.indexOf('const boundedScreen =')}`
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
const repaintedLight = /className="min-h-dvh ([^"]*)"/.exec(repaintedShell)?.[1] || '';
const shellLight = /\sbg-slate-(\d+)/.exec(' ' + repaintedLight)?.[1] || null;
checkIs(
  'and the drift check between shell and canvas would fail',
  shellLight !== shellColors[0]?.light,
  `shell would be ${shellLight}, canvas still ${shellColors[0]?.light}`
);
// The link whose absence is invisible: without min-h-0 on the pane the column refuses to shrink, so there is no
// overflow and nothing scrolls - the card simply grows and the bookmarks scroll away again, exactly as before.
const withoutShrink = help.replace('md:min-h-0 md:overflow-y-auto', 'md:overflow-y-auto');
const withoutHeadingRow = app.replace("boundedScreen ? 'md:flex md:flex-col' : ''", "''");
checkIs('the mutation took the heading out of the layout', withoutHeadingRow !== app);
checkIs(
  'so the page is a flex column again and the card overflows by the heading',
  !/boundedScreen \? 'md:flex md:flex-col' : ''/.test(withoutHeadingRow)
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

// A class name is not a class: Tailwind emits only the utilities it recognizes, so a typo (or a name that is not a
// utility at all) produces a class attribute the browser ignores and a layout that silently does not work - while
// every source check above passes. These three are the load-bearing ones for the pane.
//
// Conditional on a build being present, because this verifier deliberately does not need one: run it after
// `npm run build` (as CI does) and it will check the generated stylesheet too.
const builtCss = (() => {
  try {
    const dir = 'dist/assets';
    // EVERY stylesheet, not the first one found. The app's heavy screens are deferred into their own chunks now
    // (see utils/deferredModules.js) and Tailwind emits a stylesheet per chunk along with them, so reading one
    // file would check the utilities of one screen and report every other screen's as typos.
    const files = readdirSync(dir).filter((name) => name.endsWith('.css'));
    return files.map((name) => readFileSync(`${dir}/${name}`, 'utf8')).join('\n');
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

console.log('\n--- an arbitrary value is space-separated, never comma ---');
// The failure this catches is SILENT, which is why it needs a check at all. A comma inside a Tailwind arbitrary
// value is still GENERATED - as a `grid-template-columns` declaration with the comma left in it - and a comma is not
// valid there, so the browser drops the declaration and the layout quietly collapses to a single column. It cost a
// real bug: the Documents module's list and reader stacked on top of each other instead of sitting side by side, and
// nothing anywhere said why.
//
// The scan is over sources, so it runs without a build, and it looks for the SHAPE of the mistake - a utility, an
// arbitrary value, and a comma inside it - rather than for any one class. That is also why the broken value is not
// written out here: Tailwind reads every file that is not ignored, comments included, so naming a class in prose
// generates it in the next build.
const sourceFiles = (function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path);
    return /\.(jsx|js)$/.test(entry.name) ? [path] : [];
  });
})('src');

const commaValues = [];
sourceFiles.forEach((file) => {
  const pattern = /[a-z][a-z0-9-]*-\[[^\]\s'"]*,[^\]\s'"]*\]/g;
  (readFileSync(file, 'utf8').match(pattern) || []).forEach((value) => commaValues.push(`${file}: ${value}`));
});
check('no utility carries a comma in its arbitrary value', commaValues, []);
checkIs('and the scan looked at the sources', sourceFiles.length > 20, `only ${sourceFiles.length} files`);

// ---------------------------------------------------------------------------
// 7. Installed, the window is the app's - and the gestures are not the page's
// ---------------------------------------------------------------------------
// The family of complaints this covers: pinch-zoom and double-tap zoom reshaping the layout, text being
// selectable where it is a control and not text, and the app not filling the screen it was installed on.
// Every one of them is invisible in a desktop browser, which is exactly why they are asserted here rather
// than remembered - and every one of them is a decision that a later tidy-up could silently undo.
console.log('\n--- installed, the window belongs to the app ---');
const viewportMeta = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
// The rule about zoom in a TAB, as a named predicate so the mutation below can be shown to fail it.
const viewportKeepsPinchZoom = (content) => !/user-scalable=no/.test(content);
// Without viewport-fit=cover the layout cannot reach the notch or the home-indicator area at all, so the
// safe-area insets below resolve to zero and the app stays letterboxed however it is styled.
checkIs('the viewport claims the full screen', /viewport-fit=cover/.test(viewportMeta), viewportMeta);
// ...and it deliberately does NOT take zoom away here: a tab is where pinch-zoom has to keep working.
checkIs('briefly, without taking pinch-zoom out of a browser tab', viewportKeepsPinchZoom(viewportMeta), viewportMeta);
// The CLASS usage, not the words: the shell's own comment names the class it replaced, so a plain
// substring search for `min-h-screen` would be answered by the note explaining why it is gone.
checkIs('the height is the VISIBLE viewport, not the URL-bar-less one', /className="min-h-dvh/.test(app) && !/className="min-h-screen/.test(app), 'a 100vh shell overshoots a phone tab');
checkIs('and the mobile bar paints under the status bar', /pt-\[calc\(1rem_\+_env\(safe-area-inset-top\)\)\]/.test(app), 'the bar would sit below the notch instead of behind it');
checkIs('while the last row clears the home indicator', /pb-\[env\(safe-area-inset-bottom\)\]/.test(app));
checkIs('the drawer clears both as well', /pt-\[env\(safe-area-inset-top\)\]/.test(sidebar) && /pb-\[env\(safe-area-inset-bottom\)\]/.test(sidebar));
checkIs('and the idle banner sits above the indicator', /pb-\[calc\(0\.75rem_\+_env\(safe-area-inset-bottom\)\)\]/.test(app));
// The window's own height, in the column that a desktop layout pins: `h-screen` there would leave the
// sidebar 80-100px short on a phone-shaped window whose bars have moved.
checkIs('the pinned desktop column uses the same unit', /md:h-dvh/.test(app) && /md:h-dvh/.test(sidebar));

console.log('\n--- and the gestures are the app\'s, not the page\'s ---');
// `manipulation` is the pair of decisions at once: no double-tap zoom, no 300ms wait for a second tap -
// and pinch-zoom still allowed, which is why it is used rather than a viewport that forbids zoom.
check('taps do not wait out a double-tap zoom', ruleFor(css, 'html')?.['touch-action'], 'manipulation');
checkIs('iOS cannot inflate the type on rotation', /-webkit-text-size-adjust:\s*100%/.test(css));
// A control is not text. The selectors matter: CONTENT has to stay selectable or the fix is worse than the
// bug, so the rule is checked as written rather than as "something somewhere sets user-select".
const controlRule = /(?:^|\n)\s*button,\s*\n\s*a,\s*\n\s*label,\s*\n\s*summary,\s*\n\s*th,\s*\n\s*\[role='button'\],\s*\n\s*\.no-select\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
checkIs('the chrome does not select like text', /user-select:\s*none/.test(controlRule), controlRule.trim());
checkIs('no long-press menu on a control', /-webkit-touch-callout:\s*none/.test(controlRule));
checkIs('and no grey flash on the way in', /-webkit-tap-highlight-color:\s*transparent/.test(controlRule));
checkIs('a typed value stays selectable', /(?:^|\n)\s*input,[\s\S]{0,120}user-select:\s*text/.test(css), 'Safari carries user-select: none into a field from its label');
// The zoom members actually hit. 16px is the threshold iOS uses, and these rules are unlayered on purpose
// so they beat the utility classes that ask for 12-14px.
checkIs('a field cannot zoom the page on a phone', /@media \(max-width: 767px\)[\s\S]{0,120}font-size:\s*16px/.test(css));
// The lock itself: applied only to an installed window, which is the only place the browser honors it.
const native = readFileSync('src/utils/nativeShell.js', 'utf8');
checkIs('zoom is locked in an installed window', /user-scalable=no/.test(native));
checkIs('and only there, by asking the display mode', /\(display-mode: \$\{mode\}\)/.test(native));
checkIs('with the installed modes enumerated once', /INSTALLED_WINDOWS\s*=\s*\[[^\]]*'standalone'/.test(native));
checkIs("iOS's older spelling is honored too", /navigator\?\.standalone === true/.test(native));
checkIs('the cover fit survives the lock', /viewport-fit=cover/.test(native));
checkIs('and it runs before the first paint', /lockGesturesWhenInstalled\(\)/.test(readFileSync('src/main.jsx', 'utf8')));
// The status bar, which has one trap: iOS caches `apple-mobile-web-app-status-bar-style` when the app is
// added to the Home Screen and ignores every later change, so a scripted or theme-aware value is a
// placebo. It has to be static in the head, and the white clock it forces has to be legible in both
// themes - which is the strip's job, not the meta's.
check('the translucent status bar is asked for', headMeta('apple-mobile-web-app-status-bar-style'), 'black-translucent');
// The check is over CODE lines: this file explains the finding in prose, and prose is not a value being set.
const statusBarCode = native
  .split('\n')
  .filter((line) => /status-bar-style/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
check('and nothing tries to change it at runtime', statusBarCode, []);
const statusStrip = /className="md:hidden fixed inset-x-0 top-0 z-\d+ h-\[env\(safe-area-inset-top\)\] bg-\[(#[0-9A-Fa-f]{6})\]"/.exec(app);
checkIs('the app paints under the clock', !!statusStrip, 'no strip behind the status bar');
// It must be the SAME navy as the manifest's theme_color: a white clock on this strip is only legible
// because the strip is dark, and one place to change the navy is the point of tying them together.
check('and that strip is the manifest theme color', statusStrip?.[1]?.toUpperCase(), (/"theme_color":\s*"([^"]*)"/.exec(manifest)?.[1] ?? '').toUpperCase());
checkIs('the strip is fixed, so a scrolled app bar cannot slide white under the clock', /fixed inset-x-0 top-0/.test(statusStrip?.[0] || ''));
// Teeth: as a static `default` the app would simply lose the full-bleed look on iOS, which is what this
// change was for - and in the light theme a translucent bar without a dark strip would be unreadable.
checkIs('the static value is the translucent one', !/apple-mobile-web-app-status-bar-style"\s+content="default"/.test(html));
// Teeth: the same failure mode as the metas above - a line quietly removed, or moved somewhere it would
// apply to a tab as well. This is the mutation that would do it, and it has to fail the tab check.
const lockedEverywhere = viewportMeta.replace('initial-scale=1.0', 'maximum-scale=1, user-scalable=no');
checkIs('the mutation changed the viewport', lockedEverywhere !== viewportMeta);
checkIs('and the mutation fails the tab rule', !viewportKeepsPinchZoom(lockedEverywhere));

// ---------------------------------------------------------------------------
// 8. The heavy screens arrive with their tab, not with the app
// ---------------------------------------------------------------------------
//
// The bundle used to be one 1.08 MB file (293 kB gzipped). Deferring the screens behind a tab cut what a member
// downloads before the clock appears to 110 kB gzipped - and this is the kind of change one ordinary-looking
// commit can undo: restoring `import AdminPanel from './components/admin/AdminPanel'` would look perfectly
// reasonable, and would quietly put 80 kB of gzipped Administration back into everybody's first load.
console.log('\n--- the heavy screens arrive with their tab ---');
const deferred = readFileSync('src/utils/deferredModules.js', 'utf8');
const deferredNames = [...deferred.matchAll(/^\s{2}([A-Za-z]+): \(\) => import\(/gm)].map((m) => m[1]);
checkIs('the loader list is read', deferredNames.length >= 10, `found ${deferredNames.length}`);
// Each name has a lazy() built from the same loader object the prefetch walks, so a screen cannot be deferred in
// one place and eager in the other, and cannot be warmed under a name that does not exist.
const withoutLazy = deferredNames.filter(
  (name) => !new RegExp(`export const ${name} = lazy\\(loaders\\.${name}\\);`).test(deferred)
);
check('every loader has its lazy export', withoutLazy, []);
const stillEager = deferredNames.filter((name) => new RegExp(`^import ${name} from '\\./components/`, 'm').test(app));
check('and App imports none of them eagerly', stillEager, []);

// The boundary, and a fallback that says something is happening. A blank frame is the failure mode being avoided.
checkIs('App wraps the tab content in a Suspense boundary', /<Suspense fallback=\{<DeferredScreenFallback \/>\}>/.test(app));
checkIs(
  'with the app\'s own spinner as the fallback, not an empty box',
  /function DeferredScreenFallback\(\)[\s\S]{0,400}Loader2 className="[^"]*animate-spin"/.test(app)
);

// The prefetch, and both halves of the promise made about it. Idle time, because warming during the first render
// would compete with the screen the member is waiting for; assets only, because anything reaching the API would
// add an Apps Script round trip per member to save them a chunk fetch.
checkIs('the prefetch is idle-time work', /window\.requestIdleCallback\(callback\)/.test(app));
checkIs('and it warms the deferred chunks', /prefetchDeferredModules\(prefetchKeys\.split\(','\)\)/.test(app));
check('it makes no API call', /apiFetch|apiPost|api\(|fetch\(/.test(deferred), false);
// Administration is the big one, and it is warmed only for a member who can open it: everybody else would be
// downloading gzipped tabs they cannot see. The ungated screens stay in the base list.
checkIs('Administration is warmed only for an administrator', /if \(canAdminister\) keys\.push\('AdminPanel'\);/.test(deferred));
const baseKeys = /const keys = \[([^\]]*)\]/.exec(deferred)?.[1] || '';
checkIs('and never as a default', !/AdminPanel/.test(baseKeys), baseKeys);
checkIs('the hidden Runner is never warmed at all', !/keys\.push\('FirefighterRunner'\)/.test(deferred));

// ---------------------------------------------------------------------------
// 9. The React Compiler is on, and it is actually running
// ---------------------------------------------------------------------------
//
// One line of config enables it; whether it DID anything is invisible. It fails soft by design - a component it
// cannot prove safe is left exactly as it was - so a version bump, or a plugin that stopped applying, would look
// like nothing at all. Two halves, then: the config, and evidence from a build that the compiler ran.
console.log('\n--- the React Compiler ---');
const viteConfig = readFileSync('vite.config.js', 'utf8');
checkIs('the build enables the React Compiler', /react\(\{ compiler: true \}\)/.test(viteConfig));
// The package that provides it, which no file here imports - so it looks like a dependency nobody needs until the
// build stops with "React Compiler requires the optional `oxc-transform-react` package".
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
checkIs(
  'and the compiler package is a devDependency',
  !!packageJson.devDependencies?.['oxc-transform-react'],
  'oxc-transform-react would have to be reinstalled'
);
if (!builtCss) {
  console.log('(no build in dist/, so the compiled output was not checked)');
} else {
  // Every component the compiler compiles carries a memo cache, and `memo_cache_sentinel` is the runtime marker
  // for one. A build with none of them compiled nothing at all.
  const builtScripts = readdirSync('dist/assets').filter((name) => name.endsWith('.js'));
  const compiledChunks = builtScripts.filter((name) =>
    readFileSync(`dist/assets/${name}`, 'utf8').includes('memo_cache_sentinel')
  );
  checkIs(
    `${compiledChunks.length} built chunks carry the compiler's output`,
    compiledChunks.length > 0,
    'the compiler produced nothing'
  );
  // The load-bearing one: App and the shell live in the first-load chunk, so that is where a config that quietly
  // stopped applying would show up first.
  const entryChunk = builtScripts.find((name) => name.startsWith('index-') && !name.startsWith('index.esm'));
  checkIs(
    'including the first-load chunk App itself is in',
    !!entryChunk && compiledChunks.includes(entryChunk),
    entryChunk
  );
}

// ---------------------------------------------------------------------------
// 10. Every harness actually runs
// ---------------------------------------------------------------------------
//
// A harness that exists but is missing from verify:all passes forever without ever being run - which is indistinguishable
// from a harness that runs and passes. Writing a test and forgetting to wire it in is easy to do and impossible to notice,
// so the wiring is checked here rather than left to whoever adds the next one.
console.log('\n--- every harness runs ---');
// The migration harnesses belong to a one-time migration and are run by hand, so they are outside verify:all ON PURPOSE.
// Named here rather than discovered, so leaving the list behind is itself a failure.
const NOT_IN_VERIFY_ALL = ['verify:migration-recon', 'verify:migration-write'];
const harnessNames = Object.keys(packageJson.scripts).filter(
  (name) => name.startsWith('verify:') && name !== 'verify:all'
);
const verifyAll = packageJson.scripts['verify:all'];
const neverRun = harnessNames.filter(
  (name) => !verifyAll.includes(`npm run ${name}`) && !NOT_IN_VERIFY_ALL.includes(name)
);
checkIs(
  `${harnessNames.length - NOT_IN_VERIFY_ALL.length} harnesses are each run by verify:all`,
  neverRun.length === 0,
  `never run: ${neverRun.join(', ')}`
);
checkIs(
  'and every harness exempted from it still exists',
  NOT_IN_VERIFY_ALL.every((name) => harnessNames.includes(name)),
  'an exemption is left behind for a harness that is gone'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
