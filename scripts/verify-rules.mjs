/**
 * Verifies firestore.rules against the emulator, by signing in as the demo station's members and running the
 * queries and writes the app will run - then asserting what each of them may NOT do.
 *
 *   npm run verify:rules
 *
 * The reason this exists in this shape: a rules test that only calls `getDoc` proves the rule fires, but not that
 * the client's query is one the rule will accept. The classic Firestore failure is a correct rule paired with a
 * query the rule refuses (or the reverse), so the checks below sign in for real, run the real queries, and treat
 * "the query was rejected" as a failure of the pair rather than of the data.
 *
 * It seeds through scripts/seed-emulator.mjs, so the fixture the tests use and the fixture a developer sees in the
 * emulator UI cannot drift apart.
 */
import { initializeApp } from 'firebase/app';
import { readFileSync } from 'node:fs';
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  setDoc,
  setLogLevel,
  where,
} from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, PROJECT, seed } from './seed-emulator.mjs';

// The SDK logs every refused write to the console, which would bury the checks below in noise. The refusals are
// the point of this file, and each one is reported by name instead.
setLogLevel('silent');

let failures = 0;
let cases = 0;

const checkIs = (label, condition, detail) => {
  cases++;
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// One read, expected to be allowed or refused. Refused means the error code Firestore uses for a rule denial; any
// other error is reported as itself, because "it threw" is not the same as "the rules said no".
const read = (label, allowed, ...args) => {
  const target = args[0];
  return getDoc(target).then(
    () => checkIs(label, allowed, allowed ? '' : 'the read was allowed'),
    (error) => checkIs(label, !allowed && error.code === 'permission-denied', `threw ${error.code}`)
  );
};

const write = (label, allowed, ...args) => {
  const [target, data] = args;
  return setDoc(target, data).then(
    () => checkIs(label, allowed, allowed ? '' : 'the write was allowed'),
    (error) => checkIs(label, !allowed && error.code === 'permission-denied', `threw ${error.code}`)
  );
};

// An `owner` app is not needed anywhere below: the seed does the privileged writes over REST, so every check here
// goes through the same door the browser uses.
const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-api-key', appId: 'demo-app-id' });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const signInAs = async (uid) => {
  const account = DEMO_ACCOUNTS.find((entry) => entry.uid === uid);
  await signInWithEmailAndPassword(auth, account.email, DEMO_PASSWORD);
};

const main = async () => {
  console.log('--- the demo station ---');
  await seed();
  checkIs('it seeded', true);

  // --- the login screen: the public settings, with no session at all ---
  console.log('\n--- before signing in ---');
  await read('the login screen reads the public settings', true, doc(db, 'settings', 'public'));
  await read('and cannot read the private ones', false, doc(db, 'settings', 'private'));
  await read('nor the roster', false, doc(db, 'users', 'u1'));

  // --- a plain member: bo, the firefighter ---
  console.log('\n--- a member ---');
  await signInAs('u2');
  await read('reads the roster', true, doc(db, 'users', 'u1'));
  await read('and the permission table, to shape its own navigation', true, doc(db, 'roles', 'r2'));
  await read('reads its own settings', true, doc(db, 'user_settings', 'u2'));
  await read('but not another member settings', false, doc(db, 'user_settings', 'u1'));
  await read('reads its own account record', true, doc(db, 'users_private', 'u2'));
  await read('but not another member account record', false, doc(db, 'users_private', 'u1'));
  // Nobody writes this collection from a client, not even their own row: creating an account and changing a
  // username or a status goes through a callable function, so a browser cannot un-suspend itself.
  //
  // THE VALUES HERE ARE DELIBERATELY NOT THE STORED ONES. This used to write back exactly what the seed holds, which was
  // a no-op - and a no-op passes an `affectedKeys().hasOnly(...)` rule vacuously, so it stopped proving anything the
  // moment the FEMA student id became the one key a member MAY write. A changed status is the fact that actually has to
  // be refused, so that is what it tries.
  await write('writes its own account record', false, doc(db, 'users_private', 'u2'), {
    username: 'bo',
    status: 'suspended',
    created_at: '2026-01-01 08:00:00',
  });
  await read('reads the private half of an assignment', false, doc(db, 'assignment_private', 'a1'));
  await write('edits the roster', false, doc(db, 'users', 'u2'), { name: 'Bo Jones', rank_id: 'k2', role_id: 'r2' });
  await write('edits its own role', false, doc(db, 'roles', 'r2'), { description: 'Firefighter', is_admin: true });
  await read('reads a collection whose rules are not written yet', false, doc(db, 'certifications', 'x1'));

  // The calendar asks two questions rather than one clever one, and both have to be accepted as written - which is
  // the whole reason for that decision.
  const mine = await getDocs(query(collection(db, 'schedule'), where('user_id', '==', 'u2')));
  checkIs('the calendar asks for its own shifts, and the query is accepted', true, `got ${mine.size} rows`);
  const open = await getDocs(query(collection(db, 'schedule'), where('is_open', '==', true)));
  checkIs('and asks for the open ones as a separate question', open.size === 1, `got ${open.size}`);

  await read('reads its own availability month', true, doc(db, 'availability_months', 'u2_2026-09'));
  await read('but not another member availability month', false, doc(db, 'availability_months', 'u1_2026-09'));
  await write('cannot overwrite another member month by changing user_id', false, doc(db, 'availability_months', 'u1_2026-09'), {
    user_id: 'u2',
    month: '2026-09',
    claims: { aw1: ['2026-09-03'] },
  });
  await write('cannot move a month document by changing its month field', false, doc(db, 'availability_months', 'u2_2026-09'), {
    user_id: 'u2',
    month: '2026-10',
    claims: { aw1: ['2026-10-03'] },
  });
  await read('reads its own clock entry', true, doc(db, 'timeclock', 'c2'));
  await read('but not another member clock entry', false, doc(db, 'timeclock', 'c1'));

  // A MEMBER CANNOT ASK FOR THE WHOLE COLLECTION, and this is the half of the Clock Management change that must not go
  // wrong. Firestore refuses such a query OUTRIGHT rather than filtering it down, so a client that dropped the
  // `user_id` filter by mistake gets nothing at all - a loud failure, not a silent leak. (The officer half is asserted in
  // the officer section below, where it can actually pass.) A rejection THROWS rather than returning an empty snapshot,
  // so it is caught - otherwise the expected refusal would be reported as a crash.
  const memberWholeClock = await (async () => {
    try {
      return { ok: true, size: (await getDocs(query(collection(db, 'timeclock')))).size };
    } catch (error) {
      return { ok: false, code: error && error.code };
    }
  })();
  checkIs(
    'a member asking for the whole clock collection is REFUSED, not quietly filtered',
    memberWholeClock.ok === false && memberWholeClock.code === 'permission-denied',
    `got ${memberWholeClock.size} rows instead of a refusal`
  );
  const memberOwnClock = await getDocs(query(collection(db, 'timeclock'), where('user_id', '==', 'u2')));
  checkIs(
    'while the member\'s own scoped query is still accepted',
    memberOwnClock.size === 1,
    `got ${memberOwnClock.size} rows`
  );
  await write('cannot open a clock entry directly from the client', false, doc(db, 'timeclock', 'c3'), {
    user_id: 'u2',
    time_in: '2026-03-03 08:00',
    time_out: '',
    is_manual: false,
  });
  await write('and cannot open one against another member', false, doc(db, 'timeclock', 'c4'), {
    user_id: 'u1',
    time_in: '2026-03-03 08:00',
    time_out: '',
    is_manual: false,
  });
  await write('cannot rewrite its own historical clock entry', false, doc(db, 'timeclock', 'c2'), {
    user_id: 'u2',
    time_in: '1999-01-01 00:00',
    time_out: '1999-01-01 01:00',
    is_manual: false,
    gps_lat: '0',
    gps_lon: '0',
  });
  await read('reads who is on duty', true, doc(db, 'on_duty', 'u1'));
  await write('cannot forge its own on-duty row directly', false, doc(db, 'on_duty', 'u2'), { user_id: 'u2', time_in: '2026-03-03 08:00' });
  await write('and cannot mark somebody else on duty', false, doc(db, 'on_duty', 'u1'), {
    user_id: 'u1',
    time_in: '2026-03-03 08:00',
  });

  // --- an officer: jane, whose role is the administrator (is_admin implies every permission) ---
  await signOut(auth);
  console.log('\n--- an officer ---');
  await signInAs('u1');
  await read('reads another member account record', true, doc(db, 'users_private', 'u2'));
  await read('and the private settings', true, doc(db, 'settings', 'private'));

  // CLOCK MANAGEMENT, AS THE RULES SEE IT - the officer half of the pair asserted for a member above. Clock Management has
  // always listed every member and an officer has always been able to add an entry for somebody who forgot to clock in, so
  // the RULES have always permitted reading anybody's entry. What the client lacked was the query that ASKS for it: the
  // reader scoped every read to the caller, so an officer picked a member from the dropdown and the rows did not change.
  //
  // This asserts the widened read is PERMITTED rather than refused, which is what makes the client's fix possible - and
  // paired with the member case above it is the whole security story of that fix, one half in each direction.
  const officerClock = await getDocs(query(collection(db, 'timeclock')));
  checkIs(
    'an officer reads the WHOLE clock collection, so Clock Management is permitted',
    officerClock.size >= 2,
    `got ${officerClock.size} rows`
  );
  checkIs(
    'including another member\'s entry, which the tab exists to show and correct',
    officerClock.docs.some((entry) => entry.data().user_id === 'u2'),
    JSON.stringify(officerClock.docs.map((entry) => entry.data().user_id))
  );
  await read('and another member clock entry directly', true, doc(db, 'timeclock', 'c2'));
  await write('edits a member name, rank and role', true, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k1',
    role_id: 'r2',
  });
  // The document shape IS the projection here: a field an officer may not set does not exist, so smuggling one in
  // has to fail rather than be ignored.
  await write('but cannot smuggle a password field in with them', false, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k1',
    role_id: 'r2',
    password: 'HASHED-FORGERY',
  });
  // AND THE SAME IS TRUE OF A FIELD THE APP ITSELF LEFT BEHIND. `hasOnly` is checked against the document AFTER the
  // write, so a stored column the rule does not name refuses EVERY save of that member - which is what
  // "missing or insufficient access" was on a real station: the migration copied the spreadsheet's `id` into the
  // document body, and the editor's save merged over it. The rule is right and stays as it is; the app now REPLACES
  // the document with exactly the five declared fields (see adminSaveUser in services/api.js, pinned by
  // verify:user-row). The two cases below are the pair that documents it.
  await write('refuses a write that carries a field the rules do not name', false, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k1',
    role_id: 'r2',
    exclude_from_scheduling: false,
    runner_sound_profile: '',
    id: 'u2',
  });
  await write('and accepts the declared shape, which is what the editor now sends', true, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k1',
    role_id: 'r2',
    exclude_from_scheduling: false,
    runner_sound_profile: '',
  });
  // WRITE-DENIED to clients now, and this assertion flipped to say so: saveScheduleBoard in functions/index.js is
  // the only writer of a schedule row, because a board save needs an audit row and a conflict check that a browser
  // cannot do. An officer used to be able to write here directly; that was the second writer.
  await write('writes the schedule', false, doc(db, 'schedule', 's2'), {
    schedule_template_id: 't1',
    assignment_id: 'a1',
    user_id: 'u2',
    date_from: '2026-03-09',
    date_to: '2026-03-09',
    start_time: '08:00',
    end_time: '18:00',
    is_open: false,
  });
  // The harness's own guard: a section that stopped running would otherwise look like a pass.
  console.log('\n--- the harness itself ---');
  // --- the rules the officer tabs needed, and the ones they must not open ------------------------------------------
  console.log('\n--- documents, and the officer branches ---');

  // The same sign-in the sections above use, declared here because theirs is scoped to their own block.
  const asUser = (uid) =>
    signInWithEmailAndPassword(auth, DEMO_ACCOUNTS.find((entry) => entry.uid === uid).email, DEMO_PASSWORD);

  await asUser('u1');
  // The Documents tab reads the WHOLE collection, which the audience rule alone could not prove - this is the first
  // half of the check.
  await setDoc(doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k2',
    role_id: 'r2',
    exclude_from_scheduling: false,
    runner_sound_profile: '',
  });
  await setDoc(doc(db, 'documents', 'doc-r2'), { id: 'doc-r2', title: 'Guide for firefighters', audience_keys: ['role:r2'] });
  await setDoc(doc(db, 'documents', 'doc-r1'), { id: 'doc-r1', title: 'Guide for officers', audience_keys: ['role:r1'] });
  const allDocuments = await getDocs(collection(db, 'documents'));
  checkIs('an officer reads the whole documents collection', allDocuments.size >= 2, `${allDocuments.size} document(s)`);
  const allAnnouncements = await getDocs(collection(db, 'announcements'));
  checkIs('and the whole announcements collection', allAnnouncements.size >= 1, `${allAnnouncements.size} announcement(s)`);
  const hiddenChecklistFixture = await getDoc(doc(db, 'document_checklist_items', 'it5'));
  checkIs('the rank-hidden checklist fixture exists', hiddenChecklistFixture.exists());
  const validChecklistItem = await setDoc(doc(db, 'document_checklist_items', 'it-valid-audience'), {
    document_id: 'doc1',
    audience_keys: ['*'],
    label: 'A valid item',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('a manager can save an item with its parent audience', validChecklistItem, 'written');
  const forgedChecklistAudience = await setDoc(
    doc(db, 'document_checklist_items', 'it-forged-audience'),
    { document_id: 'doc1', audience_keys: ['rank:k1'], label: 'A forged item' }
  ).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('a manager cannot give an item an audience wider or different than its parent', forgedChecklistAudience.includes('permission-denied'), forgedChecklistAudience);

  // The second half: a member still sees only what their keys match. `bo` is the firefighter (role r2).
  await asUser('u2');
  const myDocument = await getDoc(doc(db, 'documents', 'doc-r2')).then(
    (snapshot) => (snapshot.exists() ? 'read' : 'missing'),
    (error) => String(error.code || '')
  );
  checkIs('a member reads the document aimed at their role', myDocument, 'read');
  const theirs = await getDoc(doc(db, 'documents', 'doc-r1')).then(
    () => 'read',
    (error) => String(error.code || '')
  );
  checkIs('and is refused the one aimed at another role', theirs.includes('permission-denied'), theirs);

  await read('reads checklist items for a document in their audience', true, doc(db, 'document_checklist_items', 'it1'));
    const visibleChecklistDetail = await getDocs(
      query(
        collection(db, 'document_checklist_items'),
        where('document_id', '==', 'doc1'),
        where('audience_keys', 'array-contains-any', ['*', 'user:u2', 'role:r2', 'rank:k2'])
      )
    );
    checkIs('the member detail query reads their visible checklist rows', visibleChecklistDetail.docs.some((item) => item.id === 'it1'));
  await read('cannot read checklist labels for a rank-hidden document', false, doc(db, 'document_checklist_items', 'it5'));
  const visibleChecklistItems = await getDocs(
    query(
      collection(db, 'document_checklist_items'),
      where('audience_keys', 'array-contains-any', ['*', 'user:u2', 'role:r2', 'rank:k2'])
    )
  );
  checkIs(
    'the audience-filtered checklist query includes visible items only',
    visibleChecklistItems.docs.some((item) => item.id === 'it1') && !visibleChecklistItems.docs.some((item) => item.id === 'it5'),
    JSON.stringify(visibleChecklistItems.docs.map((item) => item.id))
  );
  const unfilteredChecklistItems = await getDocs(collection(db, 'document_checklist_items')).then(
    () => 'read',
    (error) => String(error.code || '')
  );
  checkIs('a member cannot scan checklist items across document audiences', unfilteredChecklistItems.includes('permission-denied'), unfilteredChecklistItems);

  // Signatures: everyone gives their own, nobody gives somebody else's - and a row now has to say WHO GAVE IT
  // (`signed_by_user_id`) as well as who it is about, because that is the pair a verification is built out of.
  await setDoc(doc(db, 'document_signatures', 'sig-bo'), { id: 'sig-bo', user_id: 'u2', signed_by_user_id: 'u2', signature_role: 'member' });
  const ownSignature = await getDoc(doc(db, 'document_signatures', 'sig-bo')).then(
    (snapshot) => (snapshot.exists() ? 'read' : 'missing'),
    (error) => String(error.code || '')
  );
  checkIs('a member reads their own signature', ownSignature, 'read');
  await asUser('u1');
  await setDoc(doc(db, 'document_signatures', 'sig-jane'), { id: 'sig-jane', user_id: 'u1', signed_by_user_id: 'u1', signature_role: 'member' });
  await asUser('u2');
  const someoneElses = await getDoc(doc(db, 'document_signatures', 'sig-jane')).then(
    () => 'read',
    (error) => String(error.code || '')
  );
  checkIs("and is refused somebody else's", someoneElses.includes('permission-denied'), someoneElses);
  const forged = await setDoc(doc(db, 'document_signatures', 'sig-forged'), { id: 'sig-forged', user_id: 'u1' }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('and cannot sign as another member', forged.includes('permission-denied'), forged);
  const verifierSelfSignature = await setDoc(doc(db, 'document_signatures', 'sig-verifier-self'), {
    document_id: 'doc1',
    user_id: 'u2',
    signed_by_user_id: 'u2',
    signature_role: 'verifier',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('a non-admin verifier cannot verify their own work', verifierSelfSignature.includes('permission-denied'), verifierSelfSignature);
  // The SECOND identity is checked too: a member cannot attribute a signature to somebody else, which is the hole a
  // "user_id must be mine" check alone would leave open.
  const misattributed = await setDoc(doc(db, 'document_signatures', 'sig-misattributed'), {
    id: 'sig-misattributed',
    user_id: 'u2',
    signed_by_user_id: 'u1',
    signature_role: 'member',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('nor attribute their own row to somebody else', misattributed.includes('permission-denied'), misattributed);

  const adminSelfVerification = await setDoc(doc(db, 'document_signatures', 'sig-admin-self'), {
    document_id: 'doc1',
    user_id: 'u1',
    signed_by_user_id: 'u1',
    signature_role: 'verifier',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('an administrator may verify their own work by exception', adminSelfVerification, 'written');
  // A BACK-FILL, which is the one case where an OFFICER may write a 'member' row for somebody else - and only while
  // saying that is what it is. Tested from both sides, because either one alone proves nothing: a refusal could be the
  // permission, and an allowance could be the wrong branch.
  //
  // Bo (u2) is a member with no management permission, so he cannot do it however the row is shaped.
  const memberBackfill = await setDoc(doc(db, 'document_signatures', 'sig-bf-member'), {
    document_id: 'doc5',
    user_id: 'u1',
    signed_by_user_id: 'u2',
    signature_role: 'member',
    backfilled: true,
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('a member cannot back-fill for somebody else either', memberBackfill.includes('permission-denied'), memberBackfill);

  // Jane (u1) manages documents, so the next two are about the FLAG rather than about who is asking. This is the pair
  // that says the feature is safe: without the flag she cannot write an ordinary signature in Bo's name, and with it she
  // can record what the paper file says.
  //
  // SIGNED IN AS HER EXPLICITLY, because the two checks above ran as Bo and the identity is what decides these - a
  // refusal "because the flag is missing" and a refusal "because this caller may not manage documents" look identical
  // from the outside, which is the trap the assessor account exists to document.
  await asUser('u1');
  const unflagged = await setDoc(doc(db, 'document_signatures', 'sig-bf-unflagged'), {
    document_id: 'doc5',
    user_id: 'u2',
    signed_by_user_id: 'u1',
    signature_role: 'member',
    signed_at: '2024-06-15',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs(
    'and an officer cannot write a member row for somebody else without flagging it',
    unflagged.includes('permission-denied'),
    `the row was ${unflagged}`
  );

  const flaggedBackfill = await setDoc(doc(db, 'document_signatures', 'sig-bf-flagged'), {
    document_id: 'doc5',
    user_id: 'u2',
    signed_by_user_id: 'u1',
    signature_role: 'member',
    signed_at: '2024-06-15',
    backfilled: true,
    backfilled_at: '2024-06-15',
    backfill_note: '',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('while the flagged one goes through', flaggedBackfill === 'written', flaggedBackfill);
  // Back to the member the next section starts from, so this block leaves the identity as it found it.
  await asUser('u2');

  // ASSESSMENT SCORES. The whole requirement in four rules, each tested as a thing that actually happened rather than as
  // a line of rules text: a member reads their own; a member reads nobody else's; a member writes NO score at all - not
  // their own, not anybody's; and an assessor writes one for somebody else but still not for themselves.
  console.log('\n--- assessment scores ---');
  const scoreRow = (member, score = 'Pass', on = '2026-10-06') => ({
    id: `doc-a_${member}`,
    document_id: 'doc-a',
    user_id: member,
    score,
    scored_on: on,
    scored_by_user_id: 'u3',
  });

  // The assessor records a score for Bo, so there is something for the refusals below to be refused ON.
  await asUser('u3');
  const writtenByAssessor = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u2'), scoreRow('u2')).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('an assessor writes a score for another member', writtenByAssessor, 'written');

  await asUser('u2');
  const ownScore = await getDoc(doc(db, 'document_assessment_scores', 'doc-a_u2')).then(
    (snapshot) => (snapshot.exists() ? 'read' : 'missing'),
    (error) => String(error.code || '')
  );
  checkIs('a member reads their own score', ownScore, 'read');

  // THE REQUIREMENT'S HARD PART, first half: a member writing ANY score. Their own first, because that is the one the
  // requirement names - and it is also the one a "user_id must be mine" check would happily allow.
  const memberWritesOwn = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u2'), scoreRow('u2', 'Fail')).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('and is refused their OWN score', memberWritesOwn.includes('permission-denied'), memberWritesOwn);
  // ...and somebody else's, which needs no permission at all to be wrong.
  const memberWritesOther = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u3'), scoreRow('u3')).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('and somebody else\'s', memberWritesOther.includes('permission-denied'), memberWritesOther);
  // THE PROVENANCE-ONLY CASE, and the one that actually tests the PERMISSION.
  //
  // `memberWritesOther` above is refused by TWO rules at once: the missing permission, and `scored_by_user_id == uid()` -
  // the fixture's scorer is u3 while the caller is u2. Deleting the permission line from the rules leaves that test
  // passing, because the provenance check catches it anyway. It proved nothing about the permission.
  //
  // This one satisfies EVERY rule except the permission: it is about somebody else, and it is honestly attributed to the
  // caller. With `can_add_assessment_scores` required, it is refused; without it, it is written. So it is the difference
  // between "refused" and "refused for a reason that had nothing to do with permissions" - which is the whole claim.
  const memberWritesHonest = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u3'), {
    id: 'doc-a_u3',
    document_id: 'doc-a',
    user_id: 'u3',
    score: 'Pass',
    scored_on: '2026-10-06',
    scored_by_user_id: 'u2',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs(
    'and it is the PERMISSION that refuses, not the provenance check',
    memberWritesHonest.includes('permission-denied'),
    memberWritesHonest
  );
  const memberReadsOther = await getDoc(doc(db, 'document_assessment_scores', 'doc-a_u3')).then(
    () => 'read',
    (error) => String(error.code || '')
  );
  checkIs('and cannot read another member\'s score', memberReadsOther.includes('permission-denied'), memberReadsOther);

  // The second half: holding the permission is not a licence to grade yourself.
  await asUser('u3');
  const assessorWritesOwn = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u3'), scoreRow('u3')).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs(
    'and an assessor is refused their OWN score too',
    assessorWritesOwn.includes('permission-denied'),
    assessorWritesOwn
  );
  // Provenance cannot be forged: the scorer field has to be the caller.
  const misattributedScore = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u2'), {
    ...scoreRow('u2'),
    scored_by_user_id: 'u1',
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs(
    'nor may a score be filed under somebody else\'s name',
    misattributedScore.includes('permission-denied'),
    misattributedScore
  );
  // A score with no text is refused, so a blank row can never masquerade as "never scored".
  const emptyScore = await setDoc(doc(db, 'document_assessment_scores', 'doc-a_u2'), scoreRow('u2', '')).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('and an empty score is refused', emptyScore.includes('permission-denied'), emptyScore);
  // The scorer sees what is on file for a member they are scoring - which is why the read branch is not owner-only.
  const assessorReads = await getDoc(doc(db, 'document_assessment_scores', 'doc-a_u2')).then(
    (snapshot) => (snapshot.exists() ? 'read' : 'missing'),
    (error) => String(error.code || '')
  );
  checkIs('while an assessor can read a score they recorded', assessorReads, 'read');

  // The Users-tab save now writes one more field on the roster document, so the rules have to allow it - and allow
  // nothing else with it. `exclude_from_scheduling` is a scheduling preference; the status is not.
  await asUser('u1');
  const flagWrite = await setDoc(doc(db, 'users', 'u2'), { exclude_from_scheduling: true }, { merge: true }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('an officer may set the scheduling flag on the roster', flagWrite, 'written');
  const smuggled = await setDoc(doc(db, 'users', 'u2'), { status: 'suspended' }, { merge: true }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('but still not the status, which is a callable business', smuggled.includes('permission-denied'), smuggled);

  // --- a role flag the sheet spelled as text ---------------------------------------------------------------
  // THE REPORTED BUG. An officer whose role document holds `is_admin: "TRUE"` rather than a boolean was shown EVERY
  // Administration tab, panel and button - `isTruthyFlag` has always accepted the sheet's spelling - and then refused
  // every write with permission-denied, because these rules compared the flag to the boolean `true` alone. The client
  // said administrator; the server said no, and nothing on screen could explain it.
  //
  // These four cases are the regression for that, and the seed could not have caught it: `seed-emulator.mjs` writes real
  // booleans, so every check below this line was passing against a spelling that never occurs in a migrated station.
  const originalRole = (await getDoc(doc(db, 'roles', 'r1'))).data();
  const asSpelledText = Object.fromEntries(
    Object.entries(originalRole).map(([key, value]) => [key, value === true ? 'TRUE' : value === false ? 'FALSE' : value])
  );
  await asUser('u1');
  await setDoc(doc(db, 'roles', 'r1'), asSpelledText);
  const textFlagOfficer = await setDoc(doc(db, 'document_signatures', 'sig-text-flag'), {
    document_id: 'doc1',
    user_id: 'u2',
    signed_by_user_id: 'u1',
    signature_role: 'member',
    backfilled: true,
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('a role flag spelled as the sheet spells it still grants what the client says it grants', textFlagOfficer === 'written', textFlagOfficer);

  // AND IT STILL REFUSES what the client refuses. A flag spelled "FALSE" is not a weaker "TRUE", and the seed cannot
  // show that: it writes real booleans, so a `granted()` that accepted any non-empty string would have passed every
  // existing case in this file and handed the whole app to any officer with a mis-typed cell.
  await setDoc(doc(db, 'roles', 'r3'), {
    description: 'Assessor',
    is_admin: 'FALSE',
    can_view_documents: 'TRUE',
    can_manage_documents: 'FALSE',
    can_edit_roles: 'TRUE',
    can_add_assessment_scores: 'TRUE',
  });
  await asUser('u3');
  const spelledFalse = await setDoc(doc(db, 'document_signatures', 'sig-text-false'), {
    document_id: 'doc1',
    user_id: 'u2',
    signed_by_user_id: 'u3',
    signature_role: 'member',
    backfilled: true,
  }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs(
    'a flag spelled FALSE is still not granted, so the type check is doing the work',
    spelledFalse.includes('permission-denied'),
    spelledFalse
  );

  // THE ESCALATION GUARD, in the same dialect as the permission it guards. `roles` is writable by a role editor, so a
  // role editor that could write `is_admin: "TRUE"` could hand itself the whole app - which is the one thing the create
  // and update rules exist to prevent. Written as a bare `!= true` the guard read "TRUE" as "not an administrator" and
  // waved it straight through, so it has to be re-asserted against the widened spelling.
  await asUser('u1');
  await setDoc(doc(db, 'roles', 'r3'), {
    description: 'Assessor',
    is_admin: false,
    can_view_documents: true,
    can_edit_roles: true,
    can_add_assessment_scores: true,
  });
  await asUser('u3');
  const escalate = await setDoc(doc(db, 'roles', 'r3'), { description: 'x', is_admin: 'TRUE' }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('nor may a non-admin role editor promote a role with the text spelling', escalate.includes('permission-denied'), escalate);
  const escalateBoolean = await setDoc(doc(db, 'roles', 'r3'), { description: 'x', is_admin: true }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('nor with the boolean, which is the case this always covered', escalateBoolean.includes('permission-denied'), escalateBoolean);
  const demoteAdmin = await setDoc(doc(db, 'roles', 'r1'), { is_admin: false }).then(
    () => 'written',
    (error) => String(error.code || '')
  );
  checkIs('nor may a role editor demote an existing administrator role', demoteAdmin.includes('permission-denied'), demoteAdmin);
  const escalateDelete = await deleteDoc(doc(db, 'roles', 'r1')).then(
    () => 'deleted',
    (error) => String(error.code || '')
  );
  checkIs('nor delete an administrator role', escalateDelete.includes('permission-denied'), escalateDelete);

  // A user manager may assign ordinary roles, but an admin role remains admin-only at the data boundary.
  await asUser('u1');
  await setDoc(doc(db, 'roles', 'r2'), { can_edit_users: true }, { merge: true });
  await asUser('u2');
  await write('a user manager cannot assign the administrator role to their own account', false, doc(db, 'users', 'u2'), {
    name: 'Bo Jones',
    rank_id: 'k2',
    role_id: 'r1',
    exclude_from_scheduling: false,
    runner_sound_profile: '',
  });

  // Put the table back as it was found, so nothing below this line is reading a role it did not expect.
  await asUser('u1');
  await setDoc(doc(db, 'roles', 'r1'), originalRole);
  await setDoc(doc(db, 'roles', 'r2'), { can_edit_users: false }, { merge: true });

  // --- form definitions: written by the permission, READ BY THE AUDIENCE -------------------------
  //
  // A definition carries its audience as the materialized `audience_keys`, exactly as an announcement does, so a member's
  // query (array-contains-any over their own keys) is the SAME question the rule answers with hasAny - which is the only
  // reason Firestore can prove it. Asserted as a PAIR for that reason: a correct rule beside a query it cannot prove
  // reads as a refusal, and that is the failure this file exists for.
  console.log('\n--- form definitions ---');
  await asUser('u1'); // the administrator: `is_admin` implies every permission
  await setDoc(doc(db, 'form_templates', 'form-open'), {
    name: 'State training record',
    source: 'training_summary',
    fields: { 'Member Name': { from: 'member.name', as: 'text' } },
    audience_keys: ['role:r2'],
    enabled: true,
  });
  await setDoc(doc(db, 'form_templates', 'form-closed'), {
    name: 'Officers only',
    source: 'training_summary',
    fields: { 'Member Name': { from: 'member.name', as: 'text' } },
    audience_keys: ['role:r1'],
    enabled: true,
  });
  await read('an officer reads a form definition', true, doc(db, 'form_templates', 'form-closed'));
  const allForms = await getDocs(collection(db, 'form_templates'));
  checkIs('and reads every one of them, which is what the config tab does', allForms.size >= 2, `${allForms.size} form(s)`);

  await asUser('u2'); // the firefighter, whose role is form-open's audience
  await read('a member reads a form aimed at their role', true, doc(db, 'form_templates', 'form-open'));
  await read('but not one aimed at another role', false, doc(db, 'form_templates', 'form-closed'));
  await write('and does not write one', false, doc(db, 'form_templates', 'form-sneaky'), {
    name: 'Sneaky',
    source: 'training_summary',
    fields: { 'Member Name': { from: 'member.name' } },
    audience_keys: ['role:r2'],
    enabled: true,
  });
  const myForms = await getDocs(
    query(
      collection(db, 'form_templates'),
      where('audience_keys', 'array-contains-any', ['*', 'user:u2', 'role:r2', 'rank:k2'])
    )
  );
  checkIs('and asks for its own forms as ONE provable query', myForms.size === 1, `${myForms.size} form(s)`);

  // --- the FEMA student id: the ONE key a browser may write on the private half -----------------
  //
  // The private half is otherwise written by nobody, so this branch has to be proved narrow rather than trusted: the
  // member's own id, an officer's correction of anybody's, and NOTHING ELSE on that document. The status is the one that
  // matters - a write that carried a status alongside the id would be a browser unsuspending itself.
  console.log('\n--- a member’s own details ---');
  const writeMerged = async (label, allowed, path, data) => {
    try {
      await setDoc(doc(db, path), data, { merge: true });
      checkIs(label, allowed, allowed ? '' : 'the write was allowed');
    } catch (error) {
      checkIs(label, !allowed && error.code === 'permission-denied', `threw ${error.code}`);
    }
  };
  await asUser('u2'); // the firefighter, editing their own record
  await writeMerged('a member sets their OWN FEMA student id', true, 'users_private/u2', { fema_student_id: '1234567' });
  await writeMerged('and their own email', true, 'users_private/u2', { email: 'jane@example.com' });
  await writeMerged('and their own phone', true, 'users_private/u2', { phone: '555-0100' });
  await writeMerged('but not another member’s', false, 'users_private/u1', { fema_student_id: '7654321' });
  await writeMerged('and cannot smuggle a status change beside them', false, 'users_private/u2', {
    fema_student_id: '1234567',
    status: 'suspended',
  });
  // MEMBER ID IS THE ONE OF THE FOUR A MEMBER MAY NOT WRITE, which is what keeps an issued identifier out of their hands -
  // and it is the branch that would be a hole if the two clauses were written as one list.
  await writeMerged('nor set their own member id', false, 'users_private/u2', { member_id: '706' });
  // A value longer than the field is refused too, so nothing unbounded lands in the column.
  await writeMerged('nor an email longer than the field allows', false, 'users_private/u2', {
    email: `${'x'.repeat(120)}@example.com`,
  });
  await asUser('u1'); // the administrator, correcting somebody else's
  await writeMerged('an officer corrects a member’s FEMA student id', true, 'users_private/u2', { fema_student_id: '2222222' });
  await writeMerged('and sets their member id', true, 'users_private/u2', { member_id: '706' });
  await asUser('u2');
  checkIs(
    'and the correction is what is on file',
    (await getDoc(doc(db, 'users_private', 'u2'))).data().fema_student_id,
    '2222222'
  );

  // THE RULES NAME THE SAME FIELDS THE APP DOES. utils/memberFields is the one list the writer and both screens use, and the
  // rules have to spell the names out themselves - so this compares the two spellings rather than trusting them to match.
  const memberFields = await import('../src/utils/memberFields.js');
  const rulesSource = readFileSync('firestore.rules', 'utf8');
  const listIn = (fields) => `['${fields.join("', '")}']`;
  checkIs(
    'the rules name exactly the fields a member may write',
    rulesSource.includes(listIn(memberFields.MEMBER_PRIVATE_FIELDS)),
    listIn(memberFields.MEMBER_PRIVATE_FIELDS)
  );
  checkIs(
    'and exactly the fields an officer may',
    rulesSource.includes(listIn(memberFields.MEMBER_PRIVATE_ADMIN_FIELDS)),
    listIn(memberFields.MEMBER_PRIVATE_ADMIN_FIELDS)
  );
  checkIs(
    'with the member id outside the member’s list, not merely unchecked',
    !memberFields.MEMBER_PRIVATE_FIELDS.includes('member_id')
  );

  checkIs('every case ran', cases >= 27, `only ${cases} cases: a section has stopped running`);
};

main()
  .then(async () => {
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    // The one failure worth spelling out: the emulator is not running, which is a setup problem rather than a
    // rules problem, and saying so is more useful than a stack trace.
    if (String(error.code || '').includes('unavailable') || /ECONNREFUSED/.test(String(error.message))) {
      console.error('\nThe Firestore emulator is not reachable. Start it with `npm run verify:rules`, which wraps\n' +
        'this script in `firebase emulators:exec` and tears it down afterwards.');
    } else {
      console.error(error);
    }
    process.exit(1);
  });
