/**
 * Regenerates the iOS launch images (public/splash/*.png) that index.html ships as
 * `apple-touch-startup-image`.
 *
 * Why this exists: iOS paints a launch image the instant an installed app opens - before the web
 * runtime can paint anything - so the image has to be the app's own first frame or the launch
 * reads as a color jump. The splash (SplashScreen.jsx + index.css) is that first frame: the
 * department patch at min(60vh, 86vw), centered on the dark canvas.
 *
 * Fidelity, borrowed rather than re-implemented: each image is a headless-Chrome screenshot of a
 * template that reproduces the splash's settled frame - the same oklch canvas (read from the
 * installed Tailwind theme, so the two cannot drift) and the same logo size formula as
 * .splash-logo. Chrome is the same engine the app runs in, so the canvas color and the SVG
 * rasterize exactly as they will on the device.
 *
 * The sizes are parsed FROM index.html rather than listed here, so a device added to the launch
 * image block there is generated on the next run. The shimmer is deliberately absent: at rest the
 * glare sits off-canvas, so the launch image is the splash before its entrance begins, and the
 * entrance animation carries it from there.
 *
 * Run with: npm run make:splash   (needs Google Chrome, Chromium, Edge or Brave installed)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- the sizes, from the only place that knows them -----------------------------------------
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sizes = [
  ...new Map(
    [...html.matchAll(/\/splash\/splash-(\d+)x(\d+)\.png/g)].map((m) => {
      const size = { w: Number(m[1]), h: Number(m[2]) };
      return [`${size.w}x${size.h}`, size];
    })
  ).values(),
];
if (sizes.length === 0) {
  console.error('No apple-touch-startup-image sizes found in index.html - nothing to generate.');
  process.exit(1);
}

// --- the canvas, from the only place that defines it -----------------------------------------
const theme = readFileSync(join(root, 'node_modules', 'tailwindcss', 'theme.css'), 'utf8');
const canvas = /--color-slate-900:\s*([^;]+);/.exec(theme)?.[1].trim();
if (!canvas) {
  console.error('Could not read --color-slate-900 from node_modules/tailwindcss/theme.css.');
  process.exit(1);
}

// --- the patch, percent-encoded like the app's own helper does it -----------------------------
const logoPath = join(root, 'public', 'Bolivia Fire Department Logo trans.svg');
const logoUrl = 'file://' + logoPath.split('/').map(encodeURIComponent).join('/');

// The settled splash frame. html.dark mirrors index.html, which ships the dark class so the first
// paint is dark; the body carries the canvas color the splash itself resolves to in that theme.
const template = (w, h) => `<!doctype html>
<html lang="en" class="dark">
<head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body {
    width: ${w}px;
    height: ${h}px;
    display: grid;
    place-items: center;
    background: ${canvas};
    overflow: hidden;
  }
  img { height: min(60vh, 86vw); width: auto; display: block; }
</style></head>
<body><img src="${logoUrl}" alt=""></body>
</html>
`;

const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((path) => existsSync(path));
if (!chrome) {
  console.error('No Chromium-based browser found to render with (looked in /Applications).');
  process.exit(1);
}

const tmp = join(root, 'tmp-splash');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(tmp, 'profiles'), { recursive: true });

// Renders one image and RESOLVES AS SOON AS THE PNG IS ON DISK, then kills the whole Chrome process
// tree. The roundabout exit is deliberate: Chrome reliably renders the screenshot and then hangs
// instead of quitting (helpers outliving the browser, whatever else) - waiting for the process to
// exit cost a minute per image. The PNG on disk is the deliverable, so the loop polls for it and
// only that: present, and unchanged across three consecutive 250ms reads, is "written and flushed".
// `detached: true` makes the child a process-group leader, so the negative-pid kill takes the
// helpers down with it instead of leaving them holding the profile's SingletonLock.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const renderOne = async (chrome, args, out) => {
  const child = spawn(chrome, args, { stdio: 'ignore', detached: true });
  const killTree = () => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  };
  child.on('error', killTree);
  try {
    const started = Date.now();
    let lastSize = -1;
    let stableReads = 0;
    while (Date.now() - started < 60000) {
      await sleep(250);
      let size = -1;
      try { size = statSync(out).size; } catch { /* not written yet */ }
      stableReads = size > 44 && size === lastSize ? stableReads + 1 : 0;
      if (stableReads >= 3) return;
      lastSize = size;
    }
    throw new Error('no stable screenshot within 60s');
  } finally {
    killTree();
  }
};

let failures = 0;
for (const { w, h } of sizes) {
  const page = join(tmp, `splash-${w}x${h}.html`);
  writeFileSync(page, template(w, h));
  const out = join(root, 'public', 'splash', `splash-${w}x${h}.png`);
  // One profile PER IMAGE: a launch that was killed (timeout, Ctrl-C) leaves a SingletonLock behind,
  // and the next Chrome sharing that profile stalls on it instead of rendering. A throwaway profile
  // per launch makes every image independent of every other one.
  const profile = join(tmp, `profile-${w}x${h}`);
  try {
    await renderOne(chrome, [
      '--headless',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ], out);
    console.log(`ok  splash-${w}x${h}.png`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL splash-${w}x${h}.png -> ${error.message}`);
  }
}

rmSync(tmp, { recursive: true, force: true });

if (failures > 0) {
  console.error(`${failures} of ${sizes.length} launch image(s) failed.`);
  process.exit(1);
}
console.log(`${sizes.length} launch image(s) regenerated on ${canvas}.`);
