/**
 * Who a notification goes to, whether they asked for it, and the words they read.
 *
 * Why this exists as its own harness: FCM cannot be exercised in the emulator, so the half of push delivery that can be
 * WRONG without anybody noticing - the wrong recipients, a member's opt-out ignored, the station default read backwards,
 * an announcement aimed at the wrong audience - is asserted here instead, without sending anything. The other half
 * (reading rows, calling FCM, logging the counts) is exercised by the test-push button in a live deployment, which is
 * the only place a real push can be proven at all.
 *
 * The rules asserted are the SHEET'S, because they were arrived at by using them: a member who has turned "my shift
 * request approved" off must not start receiving it again because the backend changed.
 *
 * Run with: npm run verify:push-audience
 */
import pushAudience from '../functions/pushAudience.js';

const {
  viewerKeys,
  notificationEnabled,
  approverIds,
  offerEventFromStatus,
  offerRecipients,
  offerCopy,
  announcementRecipients,
  audienceTargetsFrom,
} = pushAudience;

let failures = 0;
let cases = 0;
const check = (label, actual, expected) => {
  cases++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

console.log('--- the words a member reads ---');
check('a new request says what happened and when', offerCopy('SUBMITTED', { dateFrom: '2026-03-09', dateTo: '2026-03-09' }), {
  preference: 'notify_new_offer',
  title: 'New shift request',
  body: 'A member offered to take an open shift (2026-03-09).',
});
check(
  'a range is spelled out as a range',
  offerCopy('SUBMITTED', { dateFrom: '2026-03-09', dateTo: '2026-03-11' }).body,
  'A member offered to take an open shift (2026-03-09 to 2026-03-11).'
);
check(
  'an approval is told from a decline',
  [offerCopy('APPROVED', {}).title, offerCopy('DECLINED', {}).title],
  ['Shift request approved', 'Shift request declined']
);
check('and with no dates it still reads as a sentence', offerCopy('APPROVED', {}).body, 'The shift you offered to take was approved.');
check('an unknown event has no copy, so nothing is sent', offerCopy('SOMETHING', {}), null);

console.log('\n--- a status only notifies when it MOVES ---');
check('approved is an event', offerEventFromStatus('approved'), 'APPROVED');
check('declined is an event', offerEventFromStatus('declined'), 'DECLINED');
check('pending is not', offerEventFromStatus('pending'), '');
check('nor is a status nobody recognises', offerEventFromStatus(''), '');

console.log('\n--- the preference: member, else station, else ON ---');
check('a member who said yes', notificationEnabled('TRUE', 'FALSE'), true);
check('a member who said no, against a station that said yes', notificationEnabled('FALSE', 'TRUE'), false);
check('a blank override inherits the station', notificationEnabled('', 'FALSE'), false);
check('a blank station default has no opinion either', notificationEnabled('', ''), true);
check('so a new member hears about shifts without anybody configuring anything', notificationEnabled(undefined, undefined), true);
check('a real boolean behaves like the text form', [notificationEnabled(false, true), notificationEnabled(true, '')], [false, true]);
check('and whitespace is not an opinion', notificationEnabled('   ', ''), true);

console.log('\n--- who can approve a shift ---');
const roles = [
  { id: 'r1', is_admin: true, can_approve_shifts: false },
  { id: 'r2', is_admin: false, can_approve_shifts: true },
  { id: 'r3', is_admin: false, can_approve_shifts: false },
];
const users = [
  { id: 'u1', role_id: 'r1' },
  { id: 'u2', role_id: 'r2' },
  { id: 'u3', role_id: 'r3' },
];
check('an administrator counts as an approver without the column being set', approverIds(roles, users), ['u1', 'u2']);
check('and a role that can approve counts through whoever holds it', approverIds([roles[1]], [users[1], users[2]]), ['u2']);
check('a role nobody holds reaches nobody', approverIds([{ id: 'r9', can_approve_shifts: true }], users), []);

console.log('\n--- a new offer goes to the approvers, a decision goes to the member ---');
check('submitted', offerRecipients({ event: 'SUBMITTED', offer: { user_id: 'u2' }, roles, users }), ['u1', 'u2']);
check('approved goes back to whoever offered', offerRecipients({ event: 'APPROVED', offer: { user_id: 'u3' }, roles, users }), ['u3']);
check('declined likewise', offerRecipients({ event: 'DECLINED', offer: { user_id: 'u3' }, roles, users }), ['u3']);
check('an offer with no owner reaches nobody rather than everybody', offerRecipients({ event: 'APPROVED', offer: {}, roles, users }), []);

console.log('\n--- an announcement reaches its audience, by the keys the rules check ---');
const accounts = [
  { userId: 'u1', roleId: 'r1', rankId: 'k1' },
  { userId: 'u2', roleId: 'r2', rankId: 'k2' },
  { userId: 'u3', roleId: 'r2', rankId: 'k1' },
];
check('the four keys the rules use', viewerKeys(accounts[1]), ['*', 'user:u2', 'role:r2', 'rank:k2']);
check('everyone', announcementRecipients({ audienceKeys: ['*'], accounts }), ['u1', 'u2', 'u3']);
check('one role', announcementRecipients({ audienceKeys: ['role:r2'], accounts }), ['u2', 'u3']);
check('one rank', announcementRecipients({ audienceKeys: ['rank:k1'], accounts }), ['u1', 'u3']);
check('one member', announcementRecipients({ audienceKeys: ['user:u2'], accounts }), ['u2']);
// The "rank and above" case is SEVERAL keys, which is what the materialized list is for: two ranks is the union, and no
// single column could express it - which is why an announcement carries a list and the rule checks it with hasAny.
check('two keys are a union, which is how rank-and-above works', announcementRecipients({ audienceKeys: ['rank:k1', 'rank:k2'], accounts }), ['u1', 'u2', 'u3']);
check('an audience naming nobody reaches nobody', announcementRecipients({ audienceKeys: ['role:r9'], accounts }), []);
check('and an announcement with no audience at all sends nothing', announcementRecipients({ accounts }), []);

// An audience is resolved by QUERY now rather than by scanning the whole directory, so the split has to be right: the
// same four keys the rules check with hasAny become the three fields a query can filter on, plus the wildcard.
console.log('\n--- an audience is split into the queries that reach it ---');
check('everyone is the wildcard, and needs no other query', audienceTargetsFrom(['*']), {
  everyone: true,
  roleIds: [],
  rankIds: [],
  userIds: [],
});
check('a role key becomes a role query', audienceTargetsFrom(['role:r2']).roleIds, ['r2']);
check(
  'a rank key a rank query, and a user key a direct read',
  [audienceTargetsFrom(['rank:k1', 'user:u3']).rankIds, audienceTargetsFrom(['rank:k1', 'user:u3']).userIds],
  [['k1'], ['u3']]
);
// "Rank and above" is several keys, which is exactly why the audience is a list the query has to honour in full.
check('rank-and-above keeps every key', audienceTargetsFrom(['rank:k1', 'rank:k2']).rankIds, ['k1', 'k2']);
check('duplicates collapse, so a widened audience is not asked twice', audienceTargetsFrom(['role:r1', 'role:r1']).roleIds, ['r1']);
check('a key of an unknown kind narrows nothing', audienceTargetsFrom(['team:x']), {
  everyone: false,
  roleIds: [],
  rankIds: [],
  userIds: [],
});
check('and no audience at all matches nobody', audienceTargetsFrom([]), {
  everyone: false,
  roleIds: [],
  rankIds: [],
  userIds: [],
});

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${cases} cases)`);
process.exit(failures === 0 ? 0 : 1);
