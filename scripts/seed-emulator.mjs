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
export const DEMO_ACCOUNTS = [
  { uid: 'u1', username: 'jane', email: 'jane@boliviavfd.invalid', name: 'Jane Smith', rank: 'k1', role: 'r1' },
  { uid: 'u2', username: 'bo', email: 'bo@boliviavfd.invalid', name: 'Bo Jones', rank: 'k2', role: 'r2' },
];

// Firestore's REST API wants typed values, which is verbose enough to hide a mistake inside a fixture. This maps
// the four types the seed needs and throws on anything else, rather than writing something surprising.
const docValue = (value) => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(docValue) } };
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

const createAccount = async ({ uid, email }) => {
  const response = await fetch(AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, email, password: DEMO_PASSWORD, emailVerified: true }),
  });
  // A 400 saying EMAIL_EXISTS is what a second run of the seed looks like, and is not a failure.
  if (!response.ok && !(await response.text()).includes('EMAIL_EXISTS')) {
    throw new Error(`Creating ${email} failed: ${response.status}`);
  }
};

export const seed = async () => {
  // --- permissions: two roles, one the administrator (r1), the other a plain member (r2) ---
  await put('roles/r1', {
    description: 'Administrator',
    is_admin: true,
    can_edit_users: false,
    can_edit_roles: false,
    can_edit_schedule: false,
    can_view_system_log: false,
  });
  await put('roles/r2', {
    description: 'Firefighter',
    is_admin: false,
    can_edit_users: false,
    can_edit_roles: false,
    can_edit_schedule: false,
    can_view_system_log: false,
  });

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
  await put('assignment_private/a1', { admin_note: 'checked monthly' });
  await put('schedule_templates/t1', {
    day_of_week: 'monday',
    start_time: '08:00',
    end_time: '18:00',
    assignment_id: 'a1',
    nickname: 'Day Shift',
  });
  await put('schedule_template_private/t1', { admin_note: 'temporary cover' });

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

  // --- an availability row each, so "not the other member's" has something to fail on ---
  await put('availability/av1', { user_id: 'u1', schedule_template_id: 't1', date_from: '2026-03-06', date_to: '2026-03-06' });
  await put('availability/av2', { user_id: 'u2', schedule_template_id: 't1', date_from: '2026-03-07', date_to: '2026-03-07' });

  // --- u1 on duty: the open clock entry, and the on_duty document the same transaction writes ---
  await put('timeclock/c1', { user_id: 'u1', time_in: '2026-03-02 07:55', time_out: '', is_manual: false });
  await put('timeclock/c2', { user_id: 'u2', time_in: '2026-03-01 08:00', time_out: '2026-03-01 17:00', is_manual: false });
  await put('on_duty/u1', { user_id: 'u1', time_in: '2026-03-02 07:55' });

  // --- one audit row, so the rules can show an officer reading it and a member unable to ---
  await put('system_log/l1', {
    user_id: 'u1',
    action: 'SEED',
    details: 'the demo station was seeded',
    created_at: '2026-03-02 08:00:00',
  });
};

// Run directly (node scripts/seed-emulator.mjs). The rules harness seeds through this same function, so the
// fixture cannot drift between what the tests set up and what a developer sees.
if (process.argv[1] && process.argv[1].endsWith('seed-emulator.mjs')) {
  seed()
    .then(() => console.log(`seeded the demo station into ${PROJECT}`))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
