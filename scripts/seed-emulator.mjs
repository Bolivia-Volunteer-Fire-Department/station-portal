/**
 * Seeds the Firestore emulator with a demo station, so the rules tests - and later the app - have something real
 * to look at: one administrator, one member, one filled shift, one OPEN shift, one member on duty.
 *
 *   npm run emulators        (in one terminal)
 *   npm run emulators:seed   (in another)
 *
 * It talks to the emulator's REST APIs with plain fetch, using the `owner` bearer token that bypasses security
 * rules - the same authority the Admin SDK has. That is deliberate: the seed writes what only a function or an
 * administrator may write, and doing it this way keeps the script dependency-free, rather than pulling the Admin
 * SDK in for a fixture.
 *
 * The fixture is the one scripts/verify-bootstrap.mjs has used all along for the sheet backend: one administrator
 * and one member, with the second member's rows present precisely so that "you may not read somebody else's row"
 * is a claim with something to fail on.
 */
export const PROJECT = process.env.GCLOUD_PROJECT || 'demo-station-portal';
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;

// The demo station's members and the accounts they sign in with. The domain is the department's synthetic one - no
// mail is ever sent to it - so the shared password below is a fixture, not a credential.
export const DEMO_PASSWORD = 'demo-passw0rd';

// Every permission flag the roles sheet has a column for. A role document carries the WHOLE set, which is not a
// convenience: reading an absent key in the security rules is an evaluation error rather than a false, and a client
// cannot tell that apart from a correct denial. The seed writes them all, and the role editor will too.
const PERMISSION_FLAGS = [
  'can_access_debug',
  'can_administer_trainings',
  'can_approve_shifts',
  'can_create_events',
  'can_edit_assignments',
  'can_edit_availability_windows',
  'can_edit_member_availability',
  'can_edit_notification_settings',
  'can_edit_own_availability',
  'can_edit_ranks',
  'can_edit_roles',
  'can_edit_schedule',
  'can_edit_schedule_template',
  'can_edit_schedule_templates',
  'can_edit_system_settings',
  'can_edit_timeclock',
  'can_edit_trainings',
  'can_edit_users',
  'can_make_announcements',
  'can_make_offers',
  'can_manage_certification_setup',
  'can_manage_certifications',
  'can_manage_documents',
  'can_sign_trainings',
  'can_use_timeclock',
  'can_verify_documents',
  'can_view_certifications',
  'can_view_documents',
  'can_view_full_schedule',
  'can_view_my_schedule',
];

// A role row: the description, the master switch, and every flag explicitly granted or not.
const roleRow = (description, isAdmin, granted = []) => ({
  description,
  is_admin: isAdmin,
  ...Object.fromEntries(PERMISSION_FLAGS.map((flag) => [flag, granted.includes(flag)])),
});
export const DEMO_ACCOUNTS = [
  {
    uid: 'u1',
    username: 'jane',
    email: 'jane@boliviavfd.invalid',
    name: 'Jane Smith',
    rank: 'k1',
    role: 'r1',
    claims: { role_id: 'r1', is_admin: true },
  },
  {
    uid: 'u2',
    username: 'bo',
    email: 'bo@boliviavfd.invalid',
    name: 'Bo Jones',
    rank: 'k2',
    role: 'r2',
    claims: { role_id: 'r2', is_admin: false },
  },
];

// Firestore's REST API wants typed values, which is verbose enough to hide a mistake inside a fixture. This maps
// the four types the seed needs and throws on anything else, rather than writing something surprising.
const docValue = (value) => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(docValue) } };
  // A nested object, which the badge index needs: member id -> the icons to draw. Recursed rather than specially
  // cased, so a shape deeper than this one still works if a fixture ever needs it.
  if (value && typeof value === 'object') {
    return {
      mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, docValue(entry)])) },
    };
  }
  throw new Error(`The seed cannot write a ${typeof value}: ${JSON.stringify(value)}`);
};

export const put = async (path, data) => {
  const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, docValue(value)]));
  const response = await fetch(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    throw new Error(`Seeding ${path} failed: ${response.status} ${await response.text()}`);
  }
};

const createAccount = async ({ uid, email, claims }) => {
  const response = await fetch(AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, email, password: DEMO_PASSWORD, emailVerified: true }),
  });
  // A 400 saying EMAIL_EXISTS is what a second run of the seed looks like, and is not a failure.
  if (!response.ok && !(await response.text()).includes('EMAIL_EXISTS')) {
    throw new Error(`Creating ${email} failed: ${response.status}`);
  }
  // The custom claims the createMember function would have set: role_id and is_admin, which the client uses for its
  // own navigation and which the rules deliberately do NOT trust. Seeding them keeps the demo station shaped like
  // production rather than like a half-migrated one.
  if (claims) {
    const claimResponse = await fetch(`${AUTH}:update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }),
    });
    if (!claimResponse.ok) {
      throw new Error(`Setting claims for ${email} failed: ${claimResponse.status}`);
    }
  }
};

export const seed = async () => {
  // --- permissions: two roles, one the administrator (r1), the other a plain member (r2) ---
  // r2 is granted the member-level flags explicitly rather than left to omit them, because a missing flag is an
  // evaluation error in the rules rather than a false.
  await put('roles/r1', roleRow('Administrator', true));
  await put(
    'roles/r2',
    roleRow('Firefighter', false, [
      'can_use_timeclock',
      'can_view_my_schedule',
      'can_edit_own_availability',
      'can_make_offers',
      'can_view_documents',
      'can_view_certifications',
      'can_sign_trainings',
    ])
  );

  // --- the roster: name, rank and role, and nothing else. Readable by every member. ---
  await put('ranks/k1', { description: 'Officer', rank_order: 3, color: '#ef4444', icon: 'shield' });
  await put('ranks/k2', { description: 'Firefighter', rank_order: 1, color: '#ef4444', icon: 'flame' });

  for (const account of DEMO_ACCOUNTS) {
    await createAccount(account);
    await put(`users/${account.uid}`, { name: account.name, rank_id: account.rank, role_id: account.role });
    // The private half, which no client may write - hence the owner token.
    await put(`users_private/${account.uid}`, {
      username: account.username,
      status: 'active',
      created_at: '2026-01-01 08:00:00',
    });
    await put(`user_settings/${account.uid}`, { time_format: '24', is_dark_mode: false });
  }

  // --- the configuration the login screen reads before anyone has signed in ---
  await put('settings/public', { department_name: 'Bolivia Volunteer Fire Department' });
  await put('settings/private', { clock_location_radius_m: 250 });


  // --- reference data for the schedule, with the private halves the member must never see ---
  await put('shifts/d1', { description: 'Day', start_time: '08:00', end_time: '18:00' });
  await put('apparatus/a1', { description: 'Engine 1' });
  await put('assignments/a1', { description: 'Engine 1', color: '#ef4444', icon: 'flame', rank_order_required: 1 });
  // A SECOND assignment with a HIGHER required rank, and a template for it at the same time as t1: two shifts that start
  // together must read in rank order (Officer above Firefighter - the same rule utils/crewOrder documents for a day's
  // pills), so the pair is what makes the ORDER assertion mean something rather than merely match the collection.
  await put('assignments/a2', { description: 'Command', color: '#3b82f6', icon: 'shield', rank_order_required: 3 });
  await put('assignment_private/a1', { admin_note: 'checked monthly' });
  await put('schedule_templates/t1', {
    day_of_week: 'monday',
    start_time: '08:00',
    end_time: '18:00',
    assignment_id: 'a1',
    nickname: 'Day Shift',
  });
  await put('schedule_template_private/t1', { admin_note: 'temporary cover' });
  // Two more, whose ids are deliberately NOT in the order the week reads in: the payload sorts templates by day and then
  // by start time, so 't0' has to come SECOND and 't2' last. A fixture set whose ids happened to match the sorted order
  // would pass whatever the reader did - which is the whole reason these two exist.
  await put('schedule_templates/t0', {
    day_of_week: 'monday',
    start_time: '20:00',
    end_time: '22:00',
    assignment_id: 'a1',
    nickname: 'Night Shift',
  });
  await put('schedule_templates/t2', {
    day_of_week: 'wednesday',
    start_time: '06:00',
    end_time: '12:00',
    assignment_id: 'a1',
    nickname: 'Early Wednesday',
  });
  // The same day and the same start time as t1, but a higher required rank: whichever order the payload puts these two in
  // is the rank rule showing, or its absence.
  await put('schedule_templates/t3', {
    day_of_week: 'monday',
    start_time: '08:00',
    end_time: '18:00',
    assignment_id: 'a2',
    nickname: 'Command Shift',
  });

  // --- one filled shift for u1, and one OPEN shift: the case the calendar asks its second question about ---
  await put('schedule/s1', {
    schedule_template_id: 't1',
    assignment_id: 'a1',
    user_id: 'u1',
    date_from: '2026-03-02',
    date_to: '2026-03-02',
    start_time: '08:00',
    end_time: '18:00',
    is_open: false,
  });
  await put('schedule/s2', {
    schedule_template_id: 't1',
    assignment_id: 'a1',
    user_id: '',
    date_from: '2026-03-09',
    date_to: '2026-03-09',
    start_time: '08:00',
    end_time: '18:00',
    is_open: true,
  });

  // --- availability: one document per member per month ---
  // The store the Member Availability module uses (utils/availability.js): a map of window id -> the days that member
  // claimed, one document per member per MONTH. The id carries the owner (`u2_2026-09`), which is what lets the rules
  // prove who may read a document without reading anything else, and the `month` field is what lets an officer ask for
  // one month across the whole crew - ~30 documents where a row per claim cost ~240.
  //
  // The claims here are the shape the APP writes (SET_MY_AVAILABILITY sends exactly this), so the harnesses below test
  // what production will hold rather than a fixture-only shape.
  //
  // The four windows are the four cases the derivation has to get right: a night window that crosses midnight and
  // belongs to its START day, an ordinary day window, a RETIRED configuration (ended, kept so old claims still read),
  // and one that has not taken effect yet. `2026-09-02` is a Wednesday and `2026-09-01` a Tuesday, which is what the
  // pill assertions in verify-availability-slots.mjs lean on.
  await put('availability_windows/aw1', {
    nickname: 'Tuesday night',
    start_time: '18:00',
    end_time: '08:00',
    is_tuesday: true,
    effective_date: '2026-01-01',
    end_date: '',
  });
  await put('availability_windows/aw2', {
    nickname: 'Saturday day',
    start_time: '08:00',
    end_time: '18:00',
    is_saturday: true,
    effective_date: '2026-01-01',
    end_date: '',
  });
  await put('availability_windows/aw3', {
    nickname: 'Old weekday pattern',
    start_time: '06:00',
    end_time: '14:00',
    is_monday: true,
    is_tuesday: true,
    effective_date: '2024-01-01',
    end_date: '2024-12-31',
  });
  await put('availability_windows/aw4', {
    nickname: 'Next year pattern',
    start_time: '08:00',
    end_time: '18:00',
    is_wednesday: true,
    effective_date: '2027-01-01',
    end_date: '',
  });
  // Two members on the same window and day, which is what the roster view is for, and one claim against a RETIRED window
  // - in its own month document, because the month is the unit: `u2_2024-06` is what a claim for 2024 looks like, and it
  // is also the fixture that proves the sign-in payload leaves old months out (verify-firestore-reads).
  await put('availability_months/u2_2026-09', {
    user_id: 'u2',
    month: '2026-09',
    claims: { aw1: ['2026-09-01'] },
  });
  await put('availability_months/u1_2026-09', {
    user_id: 'u1',
    month: '2026-09',
    claims: { aw1: ['2026-09-01'] },
  });
  await put('availability_months/u2_2024-06', {
    user_id: 'u2',
    month: '2024-06',
    claims: { aw3: ['2024-06-03'] },
  });

  // --- u1 on duty: the open clock entry, and the on_duty document the same transaction writes ---
  await put('timeclock/c1', { user_id: 'u1', time_in: '2026-03-02 07:55', time_out: '', is_manual: false });
  await put('timeclock/c2', { user_id: 'u2', time_in: '2026-03-01 08:00', time_out: '2026-03-01 17:00', is_manual: false });
  await put('on_duty/u1', { user_id: 'u1', time_in: '2026-03-02 07:55' });

  // --- the training and certification reference data, plus one member's own records ---
  await put('trainings/tr1', { title: 'SCBA Fit Test' });
  // A training that has been entered into an external system: LOCKED, and the lock has to mean its signatures as well as
  // its fields, or it is only half a lock.
  await put('trainings/tr2', { title: 'Hazmat Awareness', is_entered_into_external: true });
  await put('training_signatures/ts1', { training_id: 'tr1', user_id: 'u2', signed_at: '2026-02-01 09:00:00' });
  await put('certification_setup/c1', {
    name: 'EMT',
    icon: 'heart-pulse',
    sort_order: 1,
    warn_days_before: 60,
    is_renewable: true,
  });
  await put('certifications/cr1', {
    user_id: 'u2',
    certification_id: 'c1',
    effective_date: '2025-01-01',
    end_date: '2027-01-01',
    notes: '',
    updated_at: '2025-01-01 08:00:00',
  });

  // --- announcements and events, with the audience MATERIALIZED as `audience_keys` ---
  // Three announcements is the point: one for everybody, one for a role, one for a single member. A member's query
  // asks for all three at once with array-contains-any, and the rules answer with hasAny over the same four keys.
  await put('announcements/an1', {
    title: 'Everyone sees this',
    audience_keys: ['*'],
    // The login screen is no longer a place an announcement can appear (utils/announcements#ANNOUNCEMENT_LOCATIONS), so this
    // one is placed where a member actually reads it.
    is_visible_on_dashboard: true,
    created_at: '2026-02-01 08:00:00',
    // `live_until` is what the SAVE PATH materializes (firestoreWrites#saveAudienceDocument): the row's end date, or the
    // far-future sentinel when it has none. The read bounds by it (`>= today`) because neither date column can be queried
    // directly - a blank `end_date` means "indefinitely", and a range filter drops documents where the field is absent.
    live_until: '9999-12-31',
  });
  await put('announcements/an2', {
    title: 'Officers only',
    audience_keys: ['role:r1'],
    created_at: '2026-02-02 08:00:00',
    live_until: '9999-12-31',
    // A MIGRATED ROW, deliberately, which means it carries the sheet's own `id` column - and a DIFFERENT value from the
    // document id, which is the only way that column can do any harm. The app must key this row by `an2` (the document id)
    // and never by the stale `sheet-1043`: that is what the live listeners and the readers have to agree on, and the
    // fixture that proves it did not exist until a production announcement list went blank because of it.
    id: 'sheet-1043',
  });
  await put('announcements/an3', {
    title: 'For Bo',
    audience_keys: ['user:u2'],
    created_at: '2026-02-03 08:00:00',
    live_until: '9999-12-31',
  });
  // THE ONE THAT PROVES THE BOUND IS A BOUND. It is aimed at everyone and would have been read by every sign-in before the
  // active filter existed; it ended in February, so nothing should see it any more. Without a fixture like this the
  // narrowing is an assertion rather than a test - the three rows above all stay visible either way.
  await put('announcements/an4', {
    title: 'Expired notice',
    audience_keys: ['*'],
    // A LEGACY ROW, deliberately left as one: `is_visible_on_login` was a real column, rows in the wild still carry it, and
    // nothing consults it any more. It is here so "a leftover flag does no harm" is a fixture rather than a hope.
    is_visible_on_login: true,
    effective_date: '2025-11-01',
    end_date: '2026-02-28',
    live_until: '2026-02-28',
  });
  // AND THE ONE THAT PROVES THE PAYLOAD IS NOT ASKED TO DO THE CLIENT'S JOB. This is dated in the future: `live_until` is
  // open, so the read brings it, and `announcementIsLiveOn` is what keeps it off the screen until its date arrives.
  await put('announcements/an5', {
    title: 'Starts next year',
    audience_keys: ['*'],
    effective_date: '2027-01-01',
    live_until: '9999-12-31',
  });
  await put('events/ev1', { title: 'Everyone', date_from: '2026-03-10', date_to: '2026-03-10', audience_keys: ['*'] });
  await put('events/ev2', {
    title: 'Officer and firefighter',
    date_from: '2026-03-11',
    date_to: '2026-03-11',
    audience_keys: ['rank:k1', 'rank:k2'],
  });

  // --- one document with a checklist, and two signatures, so the Documents tab's per-document read has something to
  // answer with. It is the read that failed in the field: the collections and rules existed, the reader did not.
  //
  // The two signatures are deliberately different in TWO dimensions: sg1 is the older signature taken against the
  // current revision (content_revision 2, so not stale), and sg2 is the newer signature taken against revision 1 -
  // so it is stale even though it is more recent. That is the point of the staleness rule: it is about the document's
  // wording having changed under a signature, not about how long ago somebody signed.
  await put('documents/doc1', {
    title: 'Annual SOG Acknowledgement',
    // The body lives ON the row - `ADMIN_SAVE_DOCUMENT` merges the whole document into `documents/{id}` - so this is
    // what opening the document renders, and the assertion on it can tell a read body from an empty one.
    content: '# Annual SOG\n\nRead it, then sign it.',
    audience_keys: ['*'],
    content_revision: 2,
    is_published: true,
    // A plain document that wants a signature. `doc_type` is what SIGN_DOCUMENT reads to refuse a checklist, and
    // `is_sign_required` is what it reads to refuse a document nobody has to sign - two different refusals, and the
    // seed carries both shapes so neither goes untested.
    doc_type: 'document',
    is_sign_required: true,
  });
  // A plain document nobody has signed yet, so the ordinary sign has something to do: the other two carry signatures as
  // fixtures for the staleness report, which is exactly the state that makes "signing again" a different assertion.
  await put('documents/doc6', {
    title: 'New Policy Acknowledgement',
    audience_keys: ['*'],
    content_revision: 1,
    is_published: true,
    doc_type: 'document',
    is_sign_required: true,
  });
  // A CHECKLIST, which is signed item by item and cannot be signed as a whole. Its items are its own: an id from
  // another document must not be signable against this one.
  await put('documents/doc5', {
    title: 'Weekly Apparatus Check',
    audience_keys: ['*'],
    content_revision: 1,
    is_published: true,
    doc_type: 'checklist',
    is_sign_required: true,
  });
  await put('document_checklist_items/it3', {
    document_id: 'doc5',
    sort_order: 1,
    section: 'Engine',
    label: 'Fluids topped up',
  });
  await put('document_checklist_items/it4', {
    document_id: 'doc5',
    sort_order: 2,
    section: 'Engine',
    label: 'Lights tested',
  });
  // The other three exist to test the visibility rules the member's library applies, one each:
  //
  //   doc2 is aimed at a rank bo does not hold, so it must read as UNAVAILABLE rather than as forbidden - the sheet's
  //        rule, and the reason a crafted request learns nothing about what exists above somebody's rank.
  //   doc3 is aimed at everyone but is not live yet, so an audience alone is not enough.
  //   doc4 is live and aimed at everyone but unpublished, which is the same answer for a different reason: it is not a
  //        document yet.
  await put('documents/doc2', {
    title: 'Officer Only Policy',
    audience_keys: ['rank:k1'],
    content_revision: 1,
    is_published: true,
  });
  await put('documents/doc3', {
    title: 'Next Year Handbook',
    audience_keys: ['*'],
    content_revision: 1,
    is_published: true,
    // `effective_date`, NOT `date_from`: these are the document columns the app's own editor writes (see
    // utils/effectiveDates), and the first version of the reader asked for a field nothing has ever written - so every
    // window read as open and this fixture proved nothing.
    effective_date: '2027-01-01',
  });
  await put('documents/doc4', {
    title: 'Unpublished Draft',
    audience_keys: ['*'],
    content_revision: 1,
    is_published: false,
  });
  await put('document_checklist_items/it1', {
    document_id: 'doc1',
    sort_order: 1,
    section: 'Section A',
    label: 'I have read the SOG',
  });
  await put('document_checklist_items/it2', {
    document_id: 'doc1',
    sort_order: 2,
    section: 'Section A',
    label: 'I will follow it',
  });
  await put('document_signatures/sg1', {
    document_id: 'doc1',
    user_id: 'u2',
    checklist_item_id: '',
    signature_role: 'member',
    content_revision: 2,
    signed_at: '2026-02-01 09:00:00',
  });
  await put('document_signatures/sg2', {
    document_id: 'doc1',
    user_id: 'u1',
    checklist_item_id: '',
    signature_role: 'member',
    content_revision: 1,
    signed_at: '2026-03-01 09:00:00',
  });
  await put('schedule_offers/of1', {
    user_id: 'u2',
    schedule_id: 's2',
    date_from: '2026-03-09',
    assignment_id: 'a1',
    status: 'pending',
    slot_key: '2026-03-09|a1',
  });
  // THE ONE THAT PROVES THE FILTER IS A FILTER, and the one that proves it is not too tight. `of2` was approved, which fills
  // its shift: the slot is no longer open, so there is no pill for a calendar to colour and the row is not read any more -
  // it is the history the read stopped carrying. `of3` was DECLINED, and that one must still arrive, because a declined
  // shift is CLOSED to that member and the pill has to say so: without the row the slot would simply look open again and
  // they would try to re-offer a shift the officer has already turned them down for (makeOffer refuses that write, but the
  // screen should never have invited it). Approving one and declining another is the whole test: a filter that dropped both
  // would look identical on the pending pill alone.
  await put('schedule_offers/of2', {
    user_id: 'u2',
    schedule_id: 's1',
    date_from: '2026-03-02',
    assignment_id: 'a1',
    status: 'approved',
    slot_key: '2026-03-02|a1',
  });
  await put('schedule_offers/of3', {
    user_id: 'u2',
    schedule_id: 's2',
    date_from: '2026-03-16',
    assignment_id: 'a2',
    status: 'declined',
    slot_key: '2026-03-16|a2',
  });

  // --- the badge index, materialized: what the app draws beside a member's name ---
  // It depends on every member's records, which a member may not read, so it is a small public-safe document per
  // member rather than a query. Phase 4's certification work is what will maintain it; the seed writes it by hand.
  await put('certification_badges/u2', {
    user_id: 'u2',
    badges: [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }],
  });


// Run directly (node scripts/seed-emulator.mjs). The rules harness seeds through this same function, so the
// fixture cannot drift between what the tests set up and what a developer sees.
};


if (process.argv[1] && process.argv[1].endsWith('seed-emulator.mjs')) {
  seed()
    .then(() => console.log(`seeded the demo station into ${PROJECT}`))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
