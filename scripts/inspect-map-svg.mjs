/**
 * What is actually inside a district-map SVG, and how to make it smaller.
 *
 * WHY THIS EXISTS. A 10 MB drawing cannot be stored: the app caps a map at 900 KB, because Firestore refuses a document
 * over 1 MB. The trap is that the obvious fix does nothing - RESIZING THE CANVAS. An SVG is not pixels: shrinking a
 * 5000px drawing to 500px changes one number in the file and leaves every point exactly where it was, so the file barely
 * moves. (The station's own map went 10 MB -> 7 MB that way.) What makes an SVG big is the OPPOSITE of resolution: how
 * many points are in it, and how many decimal places each one is written to.
 *
 * So this reports where the bytes are, in plain words, and can write a smaller copy:
 *
 *   npm run map:inspect -- ~/Downloads/district.svg              what is in it, and what to do
 *   npm run map:slim -- ~/Downloads/district.svg /tmp/slim.svg 1 write a copy rounded to 1 decimal place
 *
 * WHAT IT WILL AND WILL NOT DO. It rounds coordinates and drops editor junk (comments, Inkscape/Sodipodi metadata). It
 * will NOT remove points, simplify shapes, or touch an embedded image - those change the drawing rather than its spelling,
 * so they belong in the editor the map was drawn in, and the report says so when they are what is needed.
 *
 * THE VERDICT IS THE APP'S OWN. Both functions below come from src/utils/mapLayer.js - the same validator an officer's
 * upload goes through - so a copy this tool calls acceptable is one the app will accept, not one that merely looks smaller.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { mapSvgBytes, mapSvgProblem, mapSvgSize, mapSvgViewBox } from '../src/utils/mapLayer.js';

// The attributes that HOLD GEOMETRY. Only these are rounded: a number in a color, an id or a font name is not a
// coordinate, and rewriting one would alter the drawing rather than its spelling.
export const GEOMETRY_ATTRIBUTES = [
  'd',
  'points',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'transform',
  'dx',
  'dy',
  'stroke-width',
  'stroke-dasharray',
  'font-size',
  'viewBox',
];

// One number rounded, and written the shortest way that means it - `12.0` comes back as `12` rather than `12.0`, which is
// where a large part of the saving on a traced drawing comes from.
export const roundNumber = (token, precision) => {
  const number = Number(token);
  if (!Number.isFinite(number)) return token;
  const rounded = Number(number.toFixed(precision));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

export const roundNumbers = (value, precision) =>
  String(value).replace(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g, (token) => roundNumber(token, precision));

// Every number in the file's geometry, and how many decimal places it is written to. The decimal census is the interesting
// half: a drawing whose coordinates are written as 1823.42468261719 is carrying ten digits of precision that no screen can
// show and no boundary needs.
const geometryNumbers = (svg) => {
  const pattern = new RegExp(`\\b(${GEOMETRY_ATTRIBUTES.join('|')})\\s*=\\s*"([^"]*)"`, 'gi');
  const numbers = [];
  for (const match of svg.matchAll(pattern)) {
    for (const token of match[2].match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || []) {
      numbers.push(token);
    }
  }
  return numbers;
};

const decimalsOf = (token) => {
  const dot = token.indexOf('.');
  if (dot === -1) return 0;
  return token.length - dot - 1;
};

// The census of elements by name, biggest name first - which is what tells a traced drawing (thousands of paths) from a
// hand-drawn one (a few dozen).
const tagCensus = (svg) => {
  const counts = new Map();
  for (const match of svg.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)) {
    const name = match[1];
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const bytesIn = (svg, pattern) => {
  let total = 0;
  for (const match of svg.matchAll(pattern)) total += match[0].length;
  return total;
};

const dataUriBytes = (svg) => {
  let total = 0;
  for (const match of svg.matchAll(/data:[^"'\s)]+/g)) total += match[0].length;
  return total;
};

// The whole file with editor junk gone and coordinates rounded. Comments and metadata are bytes that describe the file
// rather than the drawing, so removing them is lossless in every sense that matters; rounding is the lossy half, which is
// why its precision is the caller's choice.
export const slimMapSvg = (svg, precision) => {
  const attributePattern = new RegExp(`(\\b(?:${GEOMETRY_ATTRIBUTES.join('|')})\\s*=\\s*")([^"]*)(")`, 'gi');
  return String(svg)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '')
    .replace(/<sodipodi:namedview\b[\s\S]*?\/?>/gi, '')
    .replace(/\s(?:sodipodi|inkscape):[\w-]+\s*=\s*"[^"]*"/gi, '')
    .replace(attributePattern, (whole, before, value, after) => `${before}${roundNumbers(value, precision)}${after}`)
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

// How big something is, in the units the app's own messages use.
const readable = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`);

const USAGE = [
  'What is inside a district-map SVG, and how to make it smaller.',
  '',
  '  npm run map:inspect -- <file.svg>                     report only',
  '  npm run map:slim -- <file.svg> <out.svg> [precision]  report, then write a smaller copy',
  '',
  'precision is the number of decimal places kept on coordinates (default 1, which is a tenth of a drawing unit).',
].join('\n');

const report = (svg) => {
  const numbers = geometryNumbers(svg);
  const numberChars = numbers.reduce((total, token) => total + token.length, 0);
  const embedded = dataUriBytes(svg);
  const comments = bytesIn(svg, /<!--[\s\S]*?-->/g) + bytesIn(svg, /<metadata\b[\s\S]*?<\/metadata>/gi);
  const editorJunk = bytesIn(svg, /\s(?:sodipodi|inkscape):[\w-]+\s*=\s*"[^"]*"/gi);
  const total = mapSvgBytes(svg);
  const size = mapSvgSize(svg);
  const buckets = { 'whole numbers': 0, '1 decimal': 0, '2 decimals': 0, '3-5 decimals': 0, '6+ decimals': 0 };
  numbers.forEach((token) => {
    const decimals = decimalsOf(token);
    if (decimals === 0) buckets['whole numbers'] += 1;
    else if (decimals === 1) buckets['1 decimal'] += 1;
    else if (decimals === 2) buckets['2 decimals'] += 1;
    else if (decimals <= 5) buckets['3-5 decimals'] += 1;
    else buckets['6+ decimals'] += 1;
  });

  console.log(`  drawing box       ${size ? `${Math.round(size.width)} x ${Math.round(size.height)} units` : 'NOT STATED'}`);
  console.log(`  the app says      ${mapSvgProblem(svg) || 'a drawing it will accept'}`);
  console.log(`  elements          ${tagCensus(svg).slice(0, 8).map(([name, count]) => `${name} ${count.toLocaleString()}`).join('  ')}`);
  console.log('\n  where the bytes are');
  console.log(`    coordinate numbers   ${readable(numberChars).padStart(8)}   ${numbers.length.toLocaleString()} numbers`);
  console.log(`    embedded images      ${readable(embedded).padStart(8)}   ${[...svg.matchAll(/data:/g)].length} data: reference(s)`);
  console.log(`    comments/metadata    ${readable(comments + editorJunk).padStart(8)}`);
  console.log(`    everything else      ${readable(Math.max(0, total - numberChars - embedded - comments - editorJunk)).padStart(8)}   markup, labels, styles`);
  console.log('\n  the precision those coordinates are written to');
  Object.entries(buckets).forEach(([label, count]) => {
    if (count) console.log(`    ${label.padEnd(15)} ${count.toLocaleString()}`);
  });
  return { total, numbers: numbers.length, embedded, numberChars };
};

// What to do about it, said in words rather than left as numbers to interpret. The three cases are genuinely different
// problems with genuinely different fixes, and picking the wrong one wastes an afternoon.
const advice = (svg, found) => {
  const share = Math.round((found.embedded / Math.max(1, found.total)) * 100);
  console.log('\n  what to do');
  if (found.embedded > found.total * 0.4) {
    console.log(`    MOST OF THIS FILE IS A PICTURE. ${readable(found.embedded)} of it - ${share}% - is embedded raster image data,`);
    console.log('    so rounding coordinates cannot help: the photograph IS the bytes. Either delete that layer in the editor');
    console.log('    and keep the vector, or accept that this map is a picture and store it as one (a PNG or WebP in the storage');
    console.log('    bucket rather than text in the database) - that route has no 900 KB limit.');
  } else if (found.numberChars > found.total * 0.4) {
    console.log(`    THIS IS A TRACED DRAWING: ${found.numbers.toLocaleString()} coordinates, and they are most of the file. Rounding them is`);
    console.log('    lossless in every way that matters - the tenth of a unit it discards is far smaller than a screen pixel.');
    console.log(`      npm run map:slim -- "<file>" out.svg 1`);
    console.log('    If the copy is still too big, the POINTS have to go rather than the digits: simplify the paths in the editor');
    console.log('    (Inkscape: select all, Path > Simplify; or mapshaper -simplify 20% keep-shapes), which removes nodes.');
  } else {
    console.log('    The weight is neither coordinates nor a picture, so it is markup: thousands of small elements, or text');
    console.log('    labels each carrying its own font data. Look at the element list above - if `g` or `text` dominates, the');
    console.log('    structure or the labels are the weight, and the fix is in the editor that drew it.');
  }
};

const main = () => {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const [file, outPath, precisionArg] = args;
  // Four decimal places is the ceiling: past that the shift is not in the digits any more, and a drawing rounded to nothing
  // stops being a drawing.
  const precision = Math.max(0, Math.min(4, Number.parseInt(precisionArg ?? '1', 10) || 0));

  let svg;
  let onDisk;
  try {
    svg = readFileSync(file, 'utf8');
    onDisk = readFileSync(file).length;
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${file}   ${readable(onDisk)} on disk (${onDisk.toLocaleString()} bytes)`);
  const found = report(svg);
  advice(svg, found);
  if (!outPath) return;

  const slim = slimMapSvg(svg, precision);
  writeFileSync(outPath, slim);
  const after = mapSvgBytes(slim);
  console.log(`\n  written  ${outPath}`);
  console.log(`    ${readable(found.total)} -> ${readable(after)}   ${Math.round(((found.total - after) / Math.max(1, found.total)) * 100)}% smaller`);
  console.log(`    ${found.numbers.toLocaleString()} coordinates rounded to ${precision} decimal place(s), comments and editor metadata dropped`);
  const problem = mapSvgProblem(slim);
  console.log(`    the app says      ${problem || 'a drawing it will accept'}`);
  if (problem) {
    console.log('    ...so this copy is still not storable. What is left is SHAPE rather than spelling - see "what to do" above.');
  }
};

// ONLY WHEN THIS FILE IS THE COMMAND. It is also imported by scripts/verify-district-map.mjs to test the rounding and the
// slimming, and a module that printed its usage at import time would put a page of help text in the middle of that
// harness's output.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();


