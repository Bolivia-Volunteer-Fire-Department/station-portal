// Parses every harness, so a file that cannot even LOAD fails the suite instead of reporting nothing.
//
// WHY THIS EXISTS, and it is written from the incident: a duplicate top-level `const` in one verifier (the same fixture declared
// twice, forty lines apart) is a SyntaxError that takes the WHOLE FILE down. Every check in it stops running, and a file that
// does not parse prints no failures at all - not one red line, nothing. That file was marked green by hand twice while it was
// broken, and it took a person noticing the suite was red to find it.
//
// The hole was that NOTHING IN THE SUITE EVER TRIED TO LOAD A HARNESS. `npm run lint` is oxlint, whose scope is the app's own
// source; the checks each import what they need and fail loudly IF THEY RUN, and a file that cannot be parsed never runs. This
// closes that: one `node --check` per file in scripts/, in about a second, before anything else in verify:all.
//
// It is deliberately the FIRST step of the suite, because every other step assumes the harness it calls can start.
//
// Run with: npm run check:scripts
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync('scripts')
  .filter((name) => name.endsWith('.mjs'))
  .sort();

let broken = 0;
for (const name of files) {
  try {
    execFileSync(process.execPath, ['--check', `scripts/${name}`], { stdio: 'pipe' });
  } catch (error) {
    broken++;
    // The parser's own words, indented: its first lines name the file, the line and the reason, which is everything needed to
    // fix it and nothing else worth printing.
    const output = String((error && error.stderr) || (error && error.message) || '').trim().split('\n').slice(0, 4);
    console.log(`FAIL scripts/${name} does not parse:`);
    output.forEach((line) => console.log(`       ${line}`));
  }
}

if (broken) {
  console.log(`\n${broken} of ${files.length} harness${broken === 1 ? '' : 'es'} cannot be loaded at all.\n`);
  process.exit(1);
}
console.log(`all ${files.length} harnesses parse\n`);