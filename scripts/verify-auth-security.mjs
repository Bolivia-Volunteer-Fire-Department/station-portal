/**
 * Verifies the password hashing and sign-in throttling in Code.gs.
 *
 * The functions under test are extracted from the real backend file and run
 * here with stubs for the Apps Script globals, so this exercises the code that
 * actually ships rather than a copy of it. Node's crypto module is used as an
 * independent oracle: PBKDF2 output is compared against crypto.pbkdf2Sync and
 * against the published PBKDF2-HMAC-SHA256 test vectors.
 *
 *   npm run verify:auth
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CODE_GS = path.resolve(process.cwd(), 'src/services/Code.gs');

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------
function extractAuthSection(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith('const PASSWORD_HASH_PREFIX'));
  const end = lines.findIndex((line) => line.startsWith('// Auth security tooling'));

  if (start === -1) throw new Error('Could not find the password hashing section in Code.gs');
  if (end === -1 || end <= start) throw new Error('Could not find the end of the auth section in Code.gs');

  const block = lines.slice(start, end).join('\n');
  for (const symbol of ['pbkdf2Sha256_', 'verifyPasswordValue', 'recordLoginFailure', 'checkLoginRateLimit']) {
    if (!block.includes(`function ${symbol}`)) throw new Error(`Extracted block is missing ${symbol}`);
  }
  return block;
}

// ---------------------------------------------------------------------------
// Apps Script stubs
// ---------------------------------------------------------------------------
// Apps Script returns SIGNED bytes (-128..127); mimic that faithfully so the
// signed/unsigned handling in Code.gs is actually exercised.
const toSigned = (buffer) => Array.from(buffer).map((b) => (b > 127 ? b - 256 : b));
const toBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Array.isArray(value)) return Buffer.from(value.map((b) => b & 0xff));
  throw new Error(`Cannot convert ${typeof value} to bytes`);
};

function makeUtilities() {
  return {
    newBlob: (text) => ({ getBytes: () => toSigned(Buffer.from(String(text), 'utf8')) }),
    computeHmacSha256Signature: (value, key) =>
      toSigned(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest()),
    base64Encode: (bytes) => toBuffer(bytes).toString('base64'),
    base64Decode: (text) => toSigned(Buffer.from(String(text), 'base64')),
    getUuid: () => crypto.randomUUID()
  };
}

// Cache with real TTL semantics against the injected clock, so lock expiry and
// window expiry can be tested without waiting.
function makeCacheService(clock) {
  const store = new Map();
  return {
    getScriptCache: () => ({
      get: (key) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt !== null && entry.expiresAt <= clock.now) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },
      put: (key, value, seconds) => {
        store.set(key, {
          value: String(value),
          expiresAt: seconds ? clock.now + seconds * 1000 : null
        });
      },
      remove: (key) => store.delete(key)
    }),
    _store: store
  };
}

const makeLockService = () => ({
  getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {}, tryLock: () => true })
});

const makePropertiesService = (properties = {}) => ({
  getScriptProperties: () => ({
    getProperty: (key) => (key in properties ? properties[key] : null),
    setProperty: (key, value) => {
      properties[key] = value;
    }
  })
});

// ---------------------------------------------------------------------------
// Build the module under test
// ---------------------------------------------------------------------------
function loadAuth(options = {}) {
  const clock = { now: Date.UTC(2026, 0, 15, 12, 0, 0) };
  const properties = options.properties || {};
  const cacheService = options.cacheService || makeCacheService(clock);
  const lockService = options.lockService || makeLockService();
  const source = extractAuthSection(fs.readFileSync(CODE_GS, 'utf8'));

  // authNowMs_ is replaced inside the module's own scope so every internal call
  // reads the fake clock; the tunables are exposed as setters for the same
  // reason (they are `var` precisely so tests can drive them down).
  const body = `${source}
authNowMs_ = function () { return __clock.now; };
return {
  hashPasswordValue, verifyPasswordValue, parsePasswordHashValue, isHashedPasswordValue,
  pbkdf2Sha256_, pbkdf2Iterations, constantTimeEquals_, utf8Bytes_, randomSaltBytes_,
  dummyPasswordVerification_, checkLoginRateLimit, recordLoginFailure, recordLoginSuccess,
  loginRateLimitMessage,
  constants: {
    saltLength: PBKDF2_SALT_LENGTH,
    keyLength: PBKDF2_KEY_LENGTH,
    minIterations: PBKDF2_MIN_ITERATIONS,
    maxIterations: PBKDF2_MAX_ITERATIONS,
    defaultIterations: PBKDF2_DEFAULT_ITERATIONS
  },
  advanceClock: function (ms) { __clock.now += ms; },
  setTunables: function (t) {
    if (t.maxFailures !== undefined) LOGIN_MAX_FAILURES = t.maxFailures;
    if (t.lockBaseSeconds !== undefined) LOGIN_LOCK_BASE_SECONDS = t.lockBaseSeconds;
    if (t.lockMaxSeconds !== undefined) LOGIN_LOCK_MAX_SECONDS = t.lockMaxSeconds;
    if (t.failureWindowSeconds !== undefined) LOGIN_FAILURE_WINDOW_SECONDS = t.failureWindowSeconds;
    if (t.globalMaxFailures !== undefined) LOGIN_GLOBAL_MAX_FAILURES = t.globalMaxFailures;
    if (t.globalWindowSeconds !== undefined) LOGIN_GLOBAL_WINDOW_SECONDS = t.globalWindowSeconds;
    if (t.defaultIterations !== undefined) PBKDF2_DEFAULT_ITERATIONS = t.defaultIterations;
    pbkdf2IterationsMemo = null; // force the script property to be re-read
  }
};`;

  const build = new Function(
    'Utilities', 'CacheService', 'LockService', 'PropertiesService', '__clock', body
  );
  return build(makeUtilities(), cacheService, lockService, makePropertiesService(properties), clock);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let checks = 0;
let failures = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

const toHex = (bytes) => Buffer.from(bytes.map((b) => b & 0xff)).toString('hex');
const toUnsigned = (bytes) => bytes.map((b) => b & 0xff);

// ---------------------------------------------------------------------------
// PBKDF2 correctness: published vectors, with Node's crypto as the oracle
// ---------------------------------------------------------------------------
section('PBKDF2-HMAC-SHA256 matches the published test vectors');
const vectorsApi = loadAuth();

const KNOWN_VECTORS = [
  {
    password: 'password',
    salt: 'salt',
    iterations: 1,
    keyLength: 32,
    hex: '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'
  },
  {
    password: 'password',
    salt: 'salt',
    iterations: 2,
    keyLength: 32,
    hex: 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43'
  },
  {
    password: 'password',
    salt: 'salt',
    iterations: 4096,
    keyLength: 32,
    hex: 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a'
  },
  {
    // 40 bytes needs two blocks, so this also covers the block loop
    password: 'passwordPASSWORDpassword',
    salt: 'saltSALTsaltSALTsaltSALTsaltSALTsalt',
    iterations: 4096,
    keyLength: 40,
    hex: '348c89dbcbd32b2f32d814b8116e84cf2b17347ebc1800181c4e2a1fb8dd53e1c635518c7dac47e9'
  }
];

KNOWN_VECTORS.forEach((vector) => {
  const actual = toHex(
    vectorsApi.pbkdf2Sha256_(
      Array.from(Buffer.from(vector.password, 'utf8')),
      Array.from(Buffer.from(vector.salt, 'utf8')),
      vector.iterations,
      vector.keyLength
    )
  );
  check(`vector c=${vector.iterations} dkLen=${vector.keyLength}`, actual === vector.hex, actual);
});

section('PBKDF2 agrees with crypto.pbkdf2Sync for varied inputs');
const oracleCases = [
  { password: 'correct horse battery staple', salt: 'x'.repeat(16), iterations: 1 },
  { password: 'correct horse battery staple', salt: crypto.randomBytes(16).toString('base64'), iterations: 7 },
  { password: 'p\u00e3ssw\u00f6rd-\u{1f512}', salt: crypto.randomBytes(16).toString('base64'), iterations: 33 },
  { password: '', salt: crypto.randomBytes(16).toString('base64'), iterations: 12 },
  { password: 'tab\tand newline', salt: crypto.randomBytes(16).toString('base64'), iterations: 64 }
];

oracleCases.forEach((testCase, index) => {
  const actual = toHex(
    vectorsApi.pbkdf2Sha256_(
      Array.from(Buffer.from(testCase.password, 'utf8')),
      Array.from(Buffer.from(testCase.salt, 'utf8')),
      testCase.iterations,
      32
    )
  );
  const expected = crypto
    .pbkdf2Sync(
      Buffer.from(testCase.password, 'utf8'),
      Buffer.from(testCase.salt, 'utf8'),
      testCase.iterations,
      32,
      'sha256'
    )
    .toString('hex');
  check(`case ${index + 1} (${testCase.iterations} iterations)`, actual === expected, actual);
});

// The password must be the HMAC key and the salt the message. Swapping them
// would still be deterministic, so check a case where the two differ.
const swapProbe = vectorsApi.pbkdf2Sha256_(
  Array.from(Buffer.from('aaa')),
  Array.from(Buffer.from('bbbb')),
  3,
  32
);
const swapExpected = crypto.pbkdf2Sync(Buffer.from('aaa'), Buffer.from('bbbb'), 3, 32, 'sha256');
check('the password is used as the HMAC key', toHex(swapProbe) === swapExpected.toString('hex'));

// ---------------------------------------------------------------------------
// Stored format
// ---------------------------------------------------------------------------
section('Stored hash format');
const api = loadAuth();
const STORED = api.hashPasswordValue('correct horse battery staple');
const parsed = api.parsePasswordHashValue(STORED);

check(
  'format is pbkdf2-sha256$iterations$salt$digest',
  /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(STORED),
  STORED.slice(0, 48)
);
check('the iteration count is recorded', parsed && parsed.iterations === api.pbkdf2Iterations());
check(`the salt is ${api.constants.saltLength} bytes`, parsed.salt.length === api.constants.saltLength);
check(`the digest is ${api.constants.keyLength} bytes`, parsed.digest.length === api.constants.keyLength);

const oracleDigest = crypto
  .pbkdf2Sync('correct horse battery staple', Buffer.from(toUnsigned(parsed.salt)), parsed.iterations, 32, 'sha256')
  .toString('hex');
check('the digest matches crypto.pbkdf2Sync over the recorded salt', toHex(parsed.digest) === oracleDigest, toHex(parsed.digest));

check('a parsed hash is recognised as hashed', api.isHashedPasswordValue(STORED) === true);
check('plain text is not recognised as hashed', api.isHashedPasswordValue('hunter2') === false);

const secondHash = api.hashPasswordValue('correct horse battery staple');
check('identical passwords produce different hashes (unique salts)', STORED !== secondHash);
check(
  'both salted hashes verify',
  api.verifyPasswordValue(STORED, 'correct horse battery staple').ok === true &&
    api.verifyPasswordValue(secondHash, 'correct horse battery staple').ok === true
);

// ---------------------------------------------------------------------------
// Verification behaviour
// ---------------------------------------------------------------------------
section('Password verification');
const good = api.verifyPasswordValue(STORED, 'correct horse battery staple');
check('the correct password verifies', good.ok === true);
check('the reason is "hashed"', good.reason === 'hashed', good.reason);
check('a current hash needs no rehash', good.needsRehash === false);

const wrong = api.verifyPasswordValue(STORED, 'wrong password');
check('the wrong password is rejected', wrong.ok === false);
check('a rejection does not ask for a rehash', wrong.needsRehash === false);

const spaced = api.hashPasswordValue('  padded  ');
check(
  'leading and trailing spaces are significant',
  api.verifyPasswordValue(spaced, '  padded  ').ok === true && api.verifyPasswordValue(spaced, 'padded').ok === false
);

const unicode = api.hashPasswordValue('p\u00e3ssw\u00f6rd-\u{1f512}');
check(
  'unicode passwords round-trip',
  api.verifyPasswordValue(unicode, 'p\u00e3ssw\u00f6rd-\u{1f512}').ok === true &&
    api.verifyPasswordValue(unicode, 'passw\u00f6rd-\u{1f512}').ok === false
);

const weakCount = api.hashPasswordValue('made-with-100-iterations', 100);
const weakCheck = api.verifyPasswordValue(weakCount, 'made-with-100-iterations');
check('a hash made with fewer iterations still verifies', weakCheck.ok === true);
check('...and is flagged for upgrade', weakCheck.needsRehash === true);

// ---------------------------------------------------------------------------
// Legacy rows and unusable cells
// ---------------------------------------------------------------------------
section('Legacy plain-text rows upgrade without locking anyone out');
const legacy = api.verifyPasswordValue('hunter2', 'hunter2');
check('a legacy plain-text row authenticates', legacy.ok === true, legacy.reason);
check('the reason is "legacy_plaintext"', legacy.reason === 'legacy_plaintext');
check('a legacy match is flagged for hashing', legacy.needsRehash === true);
check('a legacy row rejects the wrong password', api.verifyPasswordValue('hunter2', 'hunter3').ok === false);
check('legacy comparison tolerates padding in the cell', api.verifyPasswordValue('  hunter2  ', 'hunter2').ok === true);

section('Blank and malformed cells can never authenticate');
const blankCell = api.verifyPasswordValue('', '');
check('blank stored + blank submitted is rejected', blankCell.ok === false && blankCell.reason === 'blank', blankCell.reason);
check('blank stored + any password is rejected', api.verifyPasswordValue('   ', 'anything').ok === false);

const saltB64 = Buffer.alloc(16).toString('base64');
const digestB64 = Buffer.alloc(32).toString('base64');
const malformedCells = [
  'pbkdf2-sha256$600$short$short',
  `pbkdf2-sha256$600$${saltB64}$${Buffer.alloc(16).toString('base64')}`,
  `pbkdf2-sha256$notanumber$${saltB64}$${digestB64}`,
  `pbkdf2-sha256$99999999$${saltB64}$${digestB64}`,
  'pbkdf2-sha256$600$',
  'pbkdf2-sha256$600$@@@@$@@@@',
  `pbkdf2-sha256$600$${saltB64}`
];

malformedCells.forEach((cell, index) => {
  check(`malformed cell ${index + 1} is not accepted as a hash`, api.parsePasswordHashValue(cell) === null);
  let outcome = null;
  let threw = false;
  try {
    outcome = api.verifyPasswordValue(cell, 'anything');
  } catch (err) {
    threw = true;
  }
  check(`malformed cell ${index + 1} is rejected without throwing`, threw === false && outcome !== null && outcome.ok === false);
});

// A corrupted cell must never fall back to comparing the raw text, or pasting
// the cell contents into the login box would authenticate.
check(
  'a corrupted hash cannot be replayed as the password',
  api.verifyPasswordValue('pbkdf2-sha256$600$bad$bad', 'pbkdf2-sha256$600$bad$bad').ok === false
);

section('Constant-time comparison');
check('equal values compare equal', api.constantTimeEquals_([1, 2, 3], [1, 2, 3]) === true);
check('differing values compare unequal', api.constantTimeEquals_([1, 2, 3], [1, 2, 4]) === false);
check('different lengths compare unequal', api.constantTimeEquals_([1, 2, 3], [1, 2]) === false);
check('null-safe', api.constantTimeEquals_(null, [1]) === false);
check('signed and unsigned byte views agree', api.constantTimeEquals_([-1, 2], [255, 2]) === true);

// ---------------------------------------------------------------------------
// Iteration count configuration
// ---------------------------------------------------------------------------
section('Iteration count configuration');
const minIterations = loadAuth({ properties: { PBKDF2_ITERATIONS: '5' } }).pbkdf2Iterations();
const maxIterations = loadAuth({ properties: { PBKDF2_ITERATIONS: '999999' } }).pbkdf2Iterations();
const customIterations = loadAuth({ properties: { PBKDF2_ITERATIONS: '1234' } }).pbkdf2Iterations();
const garbageIterations = loadAuth({ properties: { PBKDF2_ITERATIONS: 'abc' } }).pbkdf2Iterations();
const missingProperty = loadAuth().pbkdf2Iterations();

check('a too-low script property is clamped up to the minimum', minIterations === 100, minIterations);
check('a too-high script property is clamped down to the maximum', maxIterations === 20000, maxIterations);
check('a valid script property is used as-is', customIterations === 1234, customIterations);
check('a garbage script property falls back to the default', garbageIterations === 600, garbageIterations);
check('no script property means the default', missingProperty === 600, missingProperty);

// ---------------------------------------------------------------------------
// Sign-in throttling
// ---------------------------------------------------------------------------
section('Sign-in throttling');
const rl = loadAuth();
rl.setTunables({
  maxFailures: 3,
  lockBaseSeconds: 60,
  lockMaxSeconds: 900,
  failureWindowSeconds: 900,
  globalMaxFailures: 50,
  globalWindowSeconds: 900
});

check('a fresh username is allowed', rl.checkLoginRateLimit('member1').allowed === true);

const firstFailure = rl.recordLoginFailure('member1');
const secondFailure = rl.recordLoginFailure('member1');
check(
  'failures are counted',
  firstFailure.failures === 1 && secondFailure.failures === 2,
  [firstFailure.failures, secondFailure.failures]
);
check('still allowed below the threshold', rl.checkLoginRateLimit('member1').allowed === true);

const thirdFailure = rl.recordLoginFailure('member1');
check('crossing the threshold raises a lock', thirdFailure.locked === true);
check('the first lock lasts one base period', thirdFailure.retryAfterSeconds === 60, thirdFailure.retryAfterSeconds);

const blocked = rl.checkLoginRateLimit('member1');
check('a locked account is refused', blocked.allowed === false);
check('the refusal reports the account scope', blocked.scope === 'account', blocked.scope);
check('the refusal reports a retry delay', blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60, blocked.retryAfterSeconds);
check('username matching ignores case', rl.checkLoginRateLimit('MEMBER1').allowed === false);
check('usernames are trimmed before matching', rl.checkLoginRateLimit('  member1  ').allowed === false);

rl.advanceClock(61 * 1000);
check('the lock expires after its period', rl.checkLoginRateLimit('member1').allowed === true);

section('The lock escalates, and a success clears it');
const bob = loadAuth();
bob.setTunables({ maxFailures: 3, lockBaseSeconds: 60, lockMaxSeconds: 900 });
let escalated = null;
for (let i = 0; i < 6; i++) escalated = bob.recordLoginFailure('bob');
check('the second threshold doubles the lock', escalated.retryAfterSeconds === 120, escalated.retryAfterSeconds);

const carol = loadAuth();
carol.setTunables({ maxFailures: 3, lockBaseSeconds: 60 });
carol.recordLoginFailure('carol');
carol.recordLoginFailure('carol');
carol.recordLoginSuccess('carol');
const afterSuccess = carol.recordLoginFailure('carol');
check('a successful sign-in clears the failure count', afterSuccess.failures === 1, afterSuccess.failures);
check('a successful sign-in clears any lock', carol.checkLoginRateLimit('carol').allowed === true);

section('Throttling resists enumeration and script-wide floods');
const ghost = loadAuth();
ghost.setTunables({ maxFailures: 2, lockBaseSeconds: 60 });
ghost.recordLoginFailure('no-such-user');
const ghostLock = ghost.recordLoginFailure('no-such-user');
check('a username that does not exist is throttled the same way', ghostLock.locked === true);
check('...so a lockout cannot reveal whether an account exists', ghost.checkLoginRateLimit('no-such-user').allowed === false);

const flood = loadAuth();
flood.setTunables({ maxFailures: 100, globalMaxFailures: 4, globalWindowSeconds: 900 });
for (let i = 0; i < 4; i++) flood.recordLoginFailure('user-' + i);
const globalBlock = flood.checkLoginRateLimit('fresh-username');
check('the global cap trips after many failures across usernames', globalBlock.allowed === false);
check('the global refusal is reported with the global scope', globalBlock.scope === 'global', globalBlock.scope);
flood.advanceClock(901 * 1000);
check('the global cap clears once the window passes', flood.checkLoginRateLimit('fresh-username').allowed === true);

section('Fail-open behaviour when the cache is unavailable');
const noCache = loadAuth({
  cacheService: {
    getScriptCache: () => {
      throw new Error('CacheService unavailable');
    }
  }
});
check('throttling fails open rather than blocking everyone', noCache.checkLoginRateLimit('dave').allowed === true);
let threwWithoutCache = false;
try {
  noCache.recordLoginFailure('dave');
} catch (err) {
  threwWithoutCache = true;
}
check('recording a failure without a cache does not throw', threwWithoutCache === false);

section('Timing-equalising dummy verification');
let dummyThrew = false;
try {
  api.dummyPasswordVerification_('anything');
  api.dummyPasswordVerification_('');
} catch (err) {
  dummyThrew = true;
}
check('the dummy verification runs without throwing', dummyThrew === false);
check('a generated salt has the expected length', api.randomSaltBytes_().length === api.constants.saltLength);
check('generated salts are not repeated', toHex(api.randomSaltBytes_()) !== toHex(api.randomSaltBytes_()));

// ---------------------------------------------------------------------------
section('Summary');
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
