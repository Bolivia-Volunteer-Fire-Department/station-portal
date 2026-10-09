// The profile-picture limits live in TWO places that cannot import each other: the client's copy (src/utils/avatars.js)
// and the rules that actually enforce them (storage.rules, firestore.rules). Rules cannot import JavaScript, so this
// script is what keeps them honest - it reads the rules as TEXT, compares them against the constants the client exports,
// and asserts the behaviour of the two validators on the cases a station will actually hit.
//
// WHY THAT IS WORTH A HARNESS. The failure it prevents is silent and one-sided. Somebody raises the cap in the rule
// because a member's photo would not upload, and the client keeps refusing at the old number while quoting it on screen.
// Or the client is loosened and every oversized upload dies at the bucket as `permission-denied`, which reads as a broken
// app rather than as a limit. Neither shows up in a build, a lint or a type check.
//
// It runs with no browser and no emulator on purpose: it is a check of agreement. The cases that need a real bucket are
// in scripts/verify-storage-rules.mjs, which does need the emulator.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  AVATAR_URL_MAX,
  avatarUploadProblem,
  avatarUrlProblem,
} from '../src/utils/avatars.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const storageRules = read('storage.rules');
const firestoreRules = read('firestore.rules');
const storageService = read('src/services/avatarStorage.js');

// THE AVATAR BLOCK ALONE. `storage.rules` also holds the certification-scan rule, which lists two of the same picture
// types - so reading types from the whole file would let a type the AVATAR rule alone refuses slip through the comparison
// below. Slicing from the match to the end of the file is enough because the avatar block is the last one before the
// catch-all.
const avatarBlock = storageRules.slice(storageRules.indexOf('match /avatars/'));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`);
};
const checkIs = (name, value) => check(name, Boolean(value), true);

console.log('\n--- the picture the app will accept, and the picture the bucket will ---');

// THE SIZE. Read out of the rule and evaluated, rather than searched for as a literal, so that a cap written another way -
// `524288`, or `0.5 * 1024 * 1024` - fails loudly here instead of passing a string match and disagreeing at runtime.
const ruleSize = avatarBlock.match(/request\.resource\.size\s*<=\s*([0-9_*\s]+)/);
checkIs('the storage rule states a size cap at all', ruleSize);
const ruleBytes = ruleSize
  ? Number(
      ruleSize[1]
        .replace(/[_\s]/g, '')
        .split('*')
        .reduce((product, part) => Number(product) * Number(part), 1)
    )
  : -1;
check('and it is the same number the client refuses at', ruleBytes, AVATAR_MAX_BYTES);

// THE TYPES, AS SETS IN BOTH DIRECTIONS. A type the client offers and the rule refuses is an upload that dies after the
// wait; a type the rule allows and the client never sends is dead weight somebody has to wonder about later.
const ruleTypes = [...new Set((avatarBlock.match(/contentType\.matches\('([^']+)'\)/g) || [])
  .map((line) => line.match(/'([^']+)'/)[1])
  .flatMap((pattern) => pattern.split('|')))];
check('every type the client offers is one the rule allows', AVATAR_TYPES.filter((type) => !ruleTypes.includes(type)), []);
check('and the rule allows no type the client never offers', ruleTypes.filter((type) => !AVATAR_TYPES.includes(type)), []);
// An SVG is a picture that can carry script, and these files are served from a domain the app trusts. It is absent from
// both lists, and this is the check that says so rather than leaving it to whoever edits the list next.
checkIs('svg is in neither list', !ruleTypes.includes('image/svg+xml') && !AVATAR_TYPES.includes('image/svg+xml'));

// THE PATH. The uid is in it, which is the whole reason the rule's permission check is a string comparison rather than
// another document read - so the path the client builds and the path the rule matches have to be the same shape.
// Plain string comparisons rather than a regex, deliberately: this is a literal shape, and a literal is what the source
// has. A regex here would be a second thing to get right - and the first version of this line was written with doubled
// backslashes, which matched nothing and would have passed as "false" forever.
checkIs(
  'the bucket path is one object per member, named by their uid',
  storageService.includes('avatars/${') && storageService.includes('avatarStoragePath = (userId)') && storageService.includes('String(userId')
);
checkIs('and the rule matches exactly that path', /match \/avatars\/\{memberUid\}/.test(storageRules));
checkIs('and only the member may write it, with no officer branch', /allow create, update: if signedIn\(\) && uid\(\) == memberUid/.test(avatarBlock));
checkIs('and a delete is allowed without the size checks, which cannot run on one', /allow delete: if signedIn\(\) && uid\(\) == memberUid;/.test(avatarBlock));

// THE LINK ON THE ROW: the member writes this one field on their own row and nothing else, so both halves of that
// sentence are asserted - the field is named with the same bound the client uses, and the test is a `hasOnly`.
const urlRule = firestoreRules.match(/privateText\('avatar_url',\s*(\d+)\)/);
check('the stored link is bounded by the same number the client checks', urlRule ? Number(urlRule[1]) : -1, AVATAR_URL_MAX);
checkIs('and a member may change that field and no other', /affectedKeys\(\)\.hasOnly\(\['avatar_url'\]\)/.test(firestoreRules));
checkIs('and only on their own row', /uid\(\) == userId[\s\S]{0,300}hasOnly\(\['avatar_url'\]\)/.test(firestoreRules));

console.log('\n--- what a member is told, and what is quietly allowed ---');

// A SENTENCE, NOT A BOOLEAN, on both refusals - because the caller's job is to put these on screen. The cases below are
// the ones a station will actually hit: a photo straight off a phone, a screenshot far too big, and an iPhone HEIC.
checkIs('a phone photo over the cap is refused with the cap in the message', /512 KB/.test(avatarUploadProblem({ size: 4_200_000, type: 'image/jpeg' })));
checkIs('a small JPEG is accepted', avatarUploadProblem({ size: 40_000, type: 'image/jpeg' }) === '');
checkIs('a PNG is accepted', avatarUploadProblem({ size: 40_000, type: 'image/png' }) === '');
checkIs('a WebP is accepted', avatarUploadProblem({ size: 40_000, type: 'image/webp' }) === '');
// HEIC IS REFUSED BY THE CLIENT RATHER THAN BY THE BUCKET, and that difference is a message instead of a wait. A browser
// cannot draw one, so services/avatarStorage.js could not downscale it either: it can never become a profile picture.
checkIs('a HEIC is refused rather than uploaded and discovered later', avatarUploadProblem({ size: 40_000, type: 'image/heic' }) !== '');
checkIs('and so is an SVG', avatarUploadProblem({ size: 400, type: 'image/svg+xml' }) !== '');
checkIs('a file the browser would not name is refused rather than guessed at', avatarUploadProblem({ size: 400 }) !== '');
// THE BOUNDARY IS THE BOUNDARY, and off-by-one here is the difference between a rule and a near-miss.
checkIs('exactly the cap is allowed', avatarUploadProblem({ size: AVATAR_MAX_BYTES, type: 'image/jpeg' }) === '');
checkIs('and one byte more is not', avatarUploadProblem({ size: AVATAR_MAX_BYTES + 1, type: 'image/jpeg' }) !== '');

console.log('\n--- the link that gets stored ---');
checkIs('an https link is accepted', avatarUrlProblem('https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=z') === '');
// THE EMULATOR AND THE DEV BUCKET SERVE PLAIN HTTP ON LOOPBACK, so refusing them would make this feature impossible to
// try before it ships. This case is what stops somebody "tidying up" the localhost clause out of the rule.
checkIs("the emulator's own link is accepted", avatarUrlProblem('http://127.0.0.1:9199/v0/b/demo/o/avatars%2Fu?alt=media') === '');
checkIs('a bare http link to a real host is not', avatarUrlProblem('http://example.test/a.png') !== '');
// A DATA URL WOULD PUT THE BYTES OF A PHOTO IN THE DOCUMENT where a link belongs, which is how a free feature becomes a
// bill - and a six-figure document somebody has to page through a console to find.
checkIs('a data url is not a link', avatarUrlProblem('data:image/png;base64,AAAA') !== '');
checkIs('nor is a file:// path', avatarUrlProblem('file:///Users/somebody/photo.png') !== '');
checkIs('and an empty link is refused, which is what a mistaken "remove" would send', avatarUrlProblem('') !== '');
checkIs('an over-long link is refused', avatarUrlProblem(`https://example.test/${'a'.repeat(AVATAR_URL_MAX)}`) !== '');

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}\n`);
process.exit(failures ? 1 : 0);
