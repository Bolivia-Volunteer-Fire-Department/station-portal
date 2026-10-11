/**
 * Regenerates the iOS launch images (public/splash/*.png) that index.html ships as
 * `apple-touch-startup-image`.
 *
 * Why this exists: iOS paints a launch image the instant an installed app opens - before the web
 * runtime can paint anything - so the image has to be the app's own first frame or the launch
 * reads as a color jump. The splash (SplashScreen.jsx + index.css) is that first frame: the
 * StationSync loops emblem, centered on the dark canvas, at the size `.splash-logo` gives it.
 *
 * Fidelity, borrowed rather than re-implemented: the canvas colour is read from the installed
 * Tailwind theme and the emblem's height from `.splash-logo` in src/index.css, so neither can drift
 * from the running app. Each image is a headless-Chrome screenshot rendered at the device's CSS size
 * with `--force-device-scale-factor` set to its DPR, which is what makes `.splash-logo`'s
 * `clamp(52px, 11vw, 84px)` resolve exactly as it does on the device - so the emblem is the same
 * physical size as the animated intro's. Chrome is the engine the app runs in, so the canvas and the
 * SVG rasterize exactly as they will on the device.
 *
 * The sizes - and each device's CSS width/height and DPR - are parsed FROM index.html, so a device
 * added to the launch image block there is generated on the next run. The shimmer and the wordmark
 * are deliberately absent: at rest the glare sits off-canvas and the wordmark's width is 0, so the
 * launch image is the splash before its entrance begins, and the entrance animation carries it on.
 *
 * Run with: npm run make:splash   (needs Google Chrome, Chromium, Edge or Brave installed)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- the sizes, from the only place that knows them -----------------------------------------
// Each launch-image line carries the device's CSS size and DPR alongside the file's pixel size. The
// CSS size is what the browser's vw/vh resolve against, so it is what the logo formula has to be
// measured in; the DPR turns that into the file's pixels (430x932 at 3x is the 1290x2796 file).
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sizes = [
  ...new Map(
    [...html.matchAll(/apple-touch-startup-image"[^>]*media="([^"]+)"[^>]*href="\/splash\/splash-(\d+)x(\d+)\.png"/g)].map((m) => {
      const media = m[1];
      const deviceW = Number(/device-width:\s*(\d+)px/.exec(media)?.[1]);
      const deviceH = Number(/device-height:\s*(\d+)px/.exec(media)?.[1]);
      const dpr = Number(/-webkit-device-pixel-ratio:\s*([\d.]+)/.exec(media)?.[1]);
      // device-width/height describe the DEVICE in portrait; when the launch is landscape the VIEWPORT
      // is those swapped, and it is the viewport (and the file) that is landscape. So render the swap.
      const landscape = /orientation:\s*landscape/.test(media);
      const size = {
        w: Number(m[2]),
        h: Number(m[3]),
        vw: landscape ? deviceH : deviceW,
        vh: landscape ? deviceW : deviceH,
        dpr,
      };
      return [`${size.w}x${size.h}`, size];
    })
  ).values(),
].filter((size) => size.vw && size.vh && size.dpr);
if (sizes.length === 0) {
  console.error('No apple-touch-startup-image sizes with a device-width, device-height and DPR were found in index.html.');
  process.exit(1);
}
for (const size of sizes) {
  if (Math.round(size.vw * size.dpr) !== size.w || Math.round(size.vh * size.dpr) !== size.h) {
    console.warn(`warn splash-${size.w}x${size.h}.png: viewport ${size.vw}x${size.vh} at ${size.dpr}x is not ${size.w}x${size.h}`);
  }
}

// --- the canvas, from the only place that defines it -----------------------------------------
const theme = readFileSync(join(root, 'node_modules', 'tailwindcss', 'theme.css'), 'utf8');
const canvas = /--color-slate-900:\s*([^;]+);/.exec(theme)?.[1].trim();
if (!canvas) {
  console.error('Could not read --color-slate-900 from node_modules/tailwindcss/theme.css.');
  process.exit(1);
}

// --- the emblem's height, from the rule that actually draws it --------------------------------
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
const logoHeight = /\.splash-logo\s*\{[^}]*?\bheight:\s*([^;]+);/.exec(css)?.[1].trim();
if (!logoHeight) {
  console.error('Could not read the height of .splash-logo from src/index.css.');
  process.exit(1);
}

// --- the loops emblem, percent-encoded like the app's own helper does it ----------------------
const logoPath = join(root, 'public', 'StationSync_loops.svg');
const logoUrl = 'file://' + logoPath.split('/').map(encodeURIComponent).join('/');

// The splash before its entrance begins. html.dark mirrors index.html, which ships the dark class so
// the first paint is dark; the body carries the canvas color the splash resolves to in that theme,
// and is the device's CSS size so the emblem's height - read from .splash-logo - resolves exactly as
// it does on the device.
const template = ({ vw, vh }) => `<!doctype html>
<html lang="en" class="dark">
<head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body {
    width: ${vw}px;
    height: ${vh}px;
    display: grid;
    place-items: center;
    background: ${canvas};
    overflow: hidden;
  }
  img { height: ${logoHeight}; width: auto; display: block; }
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
for (const size of sizes) {
  const { w, h, vw, vh, dpr } = size;
  const page = join(tmp, `splash-${w}x${h}.html`);
  writeFileSync(page, template(size));
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
      // The CSS size is the window and the DPR is what turns the screenshot into the file's pixels,
      // so the emblem lands at the same physical size the app draws it.
      `--force-device-scale-factor=${dpr}`,
      `--window-size=${vw},${vh}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ], out);
    console.log(`ok  splash-${w}x${h}.png (${vw}x${vh} at ${dpr}x)`);
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
