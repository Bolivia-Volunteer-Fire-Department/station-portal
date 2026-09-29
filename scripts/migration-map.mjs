// The sheet-to-collection mapping, as data rather than as prose.
//
// Read alongside docs/MIGRATION_MAP.md, which explains the reasoning; this file is what the tools execute. Every
// decision here came from the live spreadsheet, the security rules, or Code.gs - and where Code.gs decides something
// subtle, the comment names the behaviour being reproduced, because reproducing the wrong half of it silently changes
// who can see what.

import { PUBLIC_SETTING_KEYS } from '../src/utils/systemSettings.js';

// A header the sheet carries that must never reach Firestore. `timeclock` really does have Column 1..Column 14.
const JUNK_HEADER = /^Column \d+$/;

// Anything whose NAME looks like a credential is refused rather than copied. The FCM service-account private key sits
// in system_settings today, and a credential in Firestore is readable by everyone the rules let read that document.
export const SECRET_KEY = /private_key|secret|password|passwd|token|api_key|apikey|credential|salt/i;

export const isSecretKey = (key) => SECRET_KEY.test(String(key || ''));

// A spreadsheet cell is a string; Firestore has real types, and the rules care.
//
// THIS IS THE BUG THAT MADE THE FIRST ROUTED READ FAIL. firestore.rules asks `role.is_admin == true` and
// `role.get('can_edit_users', false) == true`. The migration wrote every value as a trimmed string, so "TRUE" was
// compared to a boolean, read as false, and every officer permission granted by a role came out as not granted -
// which surfaced as permission-denied on the member payload, from a browser where the data and the rules were both
// correct. A boolean-looking COLUMN NAME plus a boolean-looking VALUE is the signal; anything else keeps its string.
const BOOLEAN_COLUMN = /^(is_|can_|has_|should_|exclude_|requires_)/;
// Numbers the app compares or does arithmetic with: row_version drives conflict detection, rank_order drives "this
// rank and above", and the rest are counts and day offsets.
const NUMERIC_COLUMNS = new Set([
  'row_version',
  'sort_order',
  'rank_order',
  'rank_order_required',
  'warn_days_before',
  'recurring_amount',
  'date_of_month',
  'duration',
  'calc_hours',
]);

export const typedValue = (header, value) => {
  const text = String(value ?? '').trim();
  if (BOOLEAN_COLUMN.test(header)) {
    // Anything that is not a recognisable yes is a no, which is what a blank cell meant in the sheet.
    if (/^(true|yes|on|1)$/i.test(text)) return true;
    return false;
  }
  if (NUMERIC_COLUMNS.has(header)) {
    const number = Number(text);
    return text !== '' && Number.isFinite(number) ? number : text;
  }
  return text;
};

// --- derived fields -----------------------------------------------------------------------------------------------

// The audience array a document has to carry, because the member payload queries `array-contains-any` against the
// four keys a member holds. Three rules are being reproduced, and the first two differ:
//
//   - Code.gs ANDs the three targeting columns ("fill one and only that group sees it"). An array cannot express an
//     AND, so a row that fills more than one is NOT representable and is reported rather than written.
//   - ANNOUNCEMENTS target the rank exactly (`rankId !== ownRankId` excludes). One `rank:<id>` key.
//   - EVENTS target the rank AND ABOVE (`ownOrder < required` excludes). So every rank at or above the target's,
//     because the member's own key list names only their own rank.
//   - Nothing filled means everybody, which is the `'*'` key.
export const audienceKeysFrom = ({ row = {}, ranks = [], rankAndAbove = false } = {}) => {
  const roleId = String(row.role_id || '').trim();
  const userId = String(row.user_id || '').trim();
  const rankId = String(row.rank_id || '').trim();
  const filled = [roleId, userId, rankId].filter(Boolean).length;

  // Reported by the plan; answered here so the shape stays a list rather than a throw.
  if (filled > 1) return { keys: [], notRepresentable: true };

  if (rankId) {
    const orderOf = (id) => {
      const rank = ranks.find((candidate) => String(candidate.id) === String(id));
      const order = parseInt(rank?.rank_order, 10);
      return Number.isFinite(order) ? order : null;
    };
    const required = orderOf(rankId);
    if (required === null) return { keys: [], unknownRank: rankId };
    const keys = rankAndAbove
      ? ranks
          .filter((rank) => {
            const order = parseInt(rank.rank_order, 10);
            return Number.isFinite(order) && order >= required;
          })
          .map((rank) => `rank:${rank.id}`)
      : [`rank:${rankId}`];
    return { keys };
  }

  if (roleId) return { keys: [`role:${roleId}`] };
  if (userId) return { keys: [`user:${userId}`] };
  return { keys: ['*'] };
};

// `is_open` on a schedule row: an unassigned shift is the board's open pill, so the field is queried and an absent
// value is a row that never appears.
export const isOpenFrom = (row) => String(row.user_id || '').trim() === '';

// The same value slotKeyOfOffer computes in Code.gs, because the calendar matches its open pills against it.
export const slotKeyFrom = (row) => {
  const scheduleId = String(row.schedule_id || '').trim();
  if (scheduleId) return `row-${scheduleId}`;
  const dateKey = String(row.date_from || '').slice(0, 10);
  const templateId = String(row.schedule_template_id || '').trim();
  return dateKey && templateId ? `slot-${dateKey}-${templateId}` : '';
};

// --- the mapping -------------------------------------------------------------------------------------------------

// tab -> what it becomes. Every header is treated as known, and the plan REPORTS anything junk, secret or dropped -
// so a column added to the sheet later turns up in the report rather than quietly vanishing.
export const TAB_MAP = {
  users: {
    collections: ['users', 'users_private'],
    drop: ['password'], // a credential: it goes to Auth or nowhere
    rename: { user_name: 'username' }, // the readers say username
    toPrivate: ['username', 'status', 'is_change_password_on_login'],
    // A member's role and rank ARE references, and a typo in either is invisible: the member keeps a row, signs in,
    // and has no permissions or no rank on the roster. Nothing else in this file would notice.
    foreignKeys: { role_id: 'roles', rank_id: 'ranks' },
    key: 'id',
  },
  roles: { collections: ['roles'], key: 'id' },
  ranks: { collections: ['ranks'], key: 'id' },
  push_devices: {
    collections: ['push_devices'],
    // The device token IS this collection's data - a member's browser registered it. Declared so the
    // credential-looking refusal below does not mistake the collection's whole point for a leak.
    keeps: ['token'],
    key: 'id',
    foreignKeys: { user_id: 'users' },
  },
  user_settings: {
    collections: ['user_settings'],
    drop: ['fcm_token'], // the rules keep device tokens out of this document; push_devices has them
    key: 'id',
  },
  system_settings: {
    // Key/value, split by key. PUBLIC IS BY NAMING and private is the default, so a setting added later is readable
    // by officers until somebody decides it belongs to everyone - the safe way round for a document any signed-in
    // member can read.
    //
    // Every key below is public because the BROWSER reads it: the loading messages and the theme and the time format
    // are drawn on screen, and the clock location is checked client-side by decision (see firestoreRouting.js), which
    // is only possible if the member's browser can read the boundary it is checking against.
    collections: ['settings/public', 'settings/private'],
    pair: { key: 'key', value: 'value' },
    publicKeys: PUBLIC_SETTING_KEYS,
  },
  shifts: { collections: ['shifts'], key: 'id' },
  apparatus: { collections: ['apparatus'], key: 'id' },
  assignments: {
    collections: ['assignments', 'assignment_private'],
    privateExtras: { admin_note: '' }, // a field the sheet has no column for
    key: 'id',
  },
  schedule_templates: {
    collections: ['schedule_templates', 'schedule_template_private'],
    privateExtras: { admin_note: '' },
    key: 'id',
  },
  schedule: {
    collections: ['schedule'],
    derive: { is_open: isOpenFrom },
    key: 'id',
    // An EMPTY user_id is what "open shift" means, and the check skips empties - so this catches only a row pointing
    // at a member who is not there, which is a shift nobody can be found for.
    foreignKeys: { user_id: 'users' },
  },
  availability: { collections: ['availability'], key: 'id', foreignKeys: { user_id: 'users' } },
  timeclock: { collections: ['timeclock'], junk: [JUNK_HEADER], key: 'id', foreignKeys: { user_id: 'users' } },
  schedule_offers: {
    collections: ['schedule_offers'],
    derive: { slot_key: slotKeyFrom },
    key: 'id',
    foreignKeys: { user_id: 'users', schedule_id: 'schedule', assignment_id: 'assignments' },
  },
  events: {
    collections: ['events'],
    audience: { rankAndAbove: true },
    key: 'id',
    // rank_id is checked by the audience expansion (which names the rank), so a bad ROLE is what is left: an event
    // targeting a role that does not exist is an event nobody sees.
    foreignKeys: { role_id: 'roles' },
  },
  announcements: {
    collections: ['announcements'],
    audience: { rankAndAbove: false },
    key: 'id',
    foreignKeys: { role_id: 'roles' },
  },
  documents: {
    collections: ['documents'],
    audience: { rankAndAbove: false },
    key: 'id',
    foreignKeys: { author_user_id: 'users', role_id: 'roles' },
  },
  document_checklist_items: {
    collections: ['document_checklist_items'],
    key: 'id',
    foreignKeys: { document_id: 'documents' },
  },
  document_signatures: {
    collections: ['document_signatures'],
    key: 'id',
    foreignKeys: { document_id: 'documents', user_id: 'users', signed_by_user_id: 'users' },
  },
  training: { collections: ['trainings'], key: 'id' }, // the rules and the readers say trainings
  training_signatures: {
    collections: ['training_signatures'],
    key: 'id',
    foreignKeys: { training_id: 'training', user_id: 'users' },
  },
  certifications: {
    collections: ['certifications'],
    key: 'id',
    foreignKeys: { user_id: 'users', certification_id: 'certification_setup' },
  },
  certification_setup: { collections: ['certification_setup'], key: 'id' },
  system_log: {
    // The log's DATA is not migrated: it is development noise rather than the station's history, and the owner said so.
    // The STRUCTURE stays - firestore.rules already matches /system_log/{entryId} and the functions write audit rows
    // through the Admin SDK - and Firestore creates a collection with its first document, so nothing needs creating
    // here. What the writer must still know is the id rule below, for the first real audit write to look like the
    // rest of this file.
    skip: 'its existing rows are development noise; the rules and the audit writers already define the collection',
    collections: ['system_log'],
    key: 'id',
    // The id column here is a row counter, not an id: 35 of the 688 rows share one with another row, so using it as
    // a document id would overwrite rows. The writer mints one per row instead.
    mintIds: true,
    softForeignKeys: { user_id: 'users' },
  },
  id_migration: { skip: 'history: it records a one-off rewrite of every id' },
};

export const mappedTabs = () => Object.keys(TAB_MAP);
export const skippedTabs = () => Object.entries(TAB_MAP).filter(([, spec]) => spec.skip).map(([tab]) => tab);
