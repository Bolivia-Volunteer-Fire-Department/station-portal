// The sheet-to-collection mapping, as data rather than as prose.
//
// Read alongside docs/MIGRATION_MAP.md, which explains the reasoning; this file is what the tools execute. Every
// decision here came from the live spreadsheet, the security rules, or Code.gs - and where Code.gs decides something
// subtle, the comment names the behaviour being reproduced, because reproducing the wrong half of it silently changes
// who can see what.

// A header the sheet carries that must never reach Firestore. `timeclock` really does have Column 1..Column 14.
const JUNK_HEADER = /^Column \d+$/;

// Anything whose NAME looks like a credential is refused rather than copied. The FCM service-account private key sits
// in system_settings today, and a credential in Firestore is readable by everyone the rules let read that document.
export const SECRET_KEY = /private_key|secret|password|passwd|token|api_key|apikey|credential|salt/i;

export const isSecretKey = (key) => SECRET_KEY.test(String(key || ''));

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
    key: 'id',
  },
  roles: { collections: ['roles'], key: 'id' },
  ranks: { collections: ['ranks'], key: 'id' },
  push_devices: { collections: ['push_devices'], key: 'id' },
  user_settings: {
    collections: ['user_settings'],
    drop: ['fcm_token'], // the rules keep device tokens out of this document; push_devices has them
    key: 'id',
  },
  system_settings: {
    // Key/value, split by key. The split is by NAME, because the model's wording ("every other setting") is not a
    // list - so the plan prints which side every key lands on, where it can be argued with.
    collections: ['settings/public', 'settings/private'],
    pair: { key: 'key', value: 'value' },
    publicKeys: [
      'station_name',
      'timezone',
      'loading_messages',
      'clock_location_enabled',
      'clock_location_lat',
      'clock_location_lon',
      'clock_location_margin_feet',
      'calendar_events_enabled',
      'push_enabled',
      'documents_enabled',
      'default_time_format',
    ],
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
  schedule: { collections: ['schedule'], derive: { is_open: isOpenFrom }, key: 'id' },
  availability: { collections: ['availability'], key: 'id' },
  timeclock: { collections: ['timeclock'], junk: [JUNK_HEADER], key: 'id', foreignKeys: { user_id: 'users' } },
  schedule_offers: {
    collections: ['schedule_offers'],
    derive: { slot_key: slotKeyFrom },
    key: 'id',
    foreignKeys: { user_id: 'users', schedule_id: 'schedule', assignment_id: 'assignments' },
  },
  events: { collections: ['events'], audience: { rankAndAbove: true }, key: 'id' },
  announcements: { collections: ['announcements'], audience: { rankAndAbove: false }, key: 'id' },
  documents: {
    collections: ['documents'],
    audience: { rankAndAbove: false },
    key: 'id',
    foreignKeys: { author_user_id: 'users' },
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
  system_log: { collections: ['system_log'], key: 'id', foreignKeys: { user_id: 'users' } },
  id_migration: { skip: 'history: it records a one-off rewrite of every id' },
};

export const mappedTabs = () => Object.keys(TAB_MAP);
export const skippedTabs = () => Object.entries(TAB_MAP).filter(([, spec]) => spec.skip).map(([tab]) => tab);
