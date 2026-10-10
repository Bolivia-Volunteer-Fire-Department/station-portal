// Normalize availability_months so each month document only holds claims for its own month.
//
//   node scripts/normalize-availability-months.mjs            (report only)
//   node scripts/normalize-availability-months.mjs --apply    (write)
//
// WHY THIS EXISTS. A month document is one member's claims for ONE month (`uid_YYYY-MM`). An earlier bug in
// AvailabilityCalendar's save built its claims map from EVERY month the screen had loaded, then wrote them all under the
// CURRENT month - so saving December also wrote the member's November days into the December document. The screen now
// filters to the month being edited (see handleSave), but the documents written before that fix still carry another
// month's days. The symptom is exactly the reported one: a NEW mark can be added and removed, but an OLD mark that is
// duplicated into a neighbouring month's document cannot be removed - un-marking removes it from one document while the
// duplicate in the other one keeps drawing it.
//
// LOSSESS, not a deletion: a stray day is moved to the document named by its own YYYY-MM (the same place a clean save
// would have written it), and merged with whatever that document already holds. So every day is preserved, every
// document ends up holding only its own month, and a second run finds nothing to move.

import { readFileSync } from 'node:fs';

const projectFromFirebaserc = (() => {
  try {
    const raw = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8');
    return JSON.parse(raw).projects?.default;
  } catch {
    return undefined;
  }
})();
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc;

const MONTH_KEY = /^\d{4}-\d{2}$/;
const sortDays = (days) => Array.from(new Set(days)).sort();

// Pure: take every month document as read, and return the documents as they should be. A stray day is relocated to the
// document named by its own YYYY-MM, and merged into it - so nothing is dropped, every document ends up holding only its
// own month, and a second run finds nothing to move.
export const normalizedMonths = (docs) => {
  const final = new Map(); // id -> { user_id, month, claims }
  const moves = []; // { from, to, windowId, days }

  for (const doc of docs) {
    const data = doc.data ?? {};
    const id = doc.id;
    const month = String(data.month || id.slice(-7) || '').trim();
    const uid = String(data.user_id || id.slice(0, -8) || '').trim();

    if (!final.has(id)) final.set(id, { user_id: uid, month, claims: {} });
    const own = final.get(id).claims;

    for (const [windowId, days] of Object.entries(data.claims && typeof data.claims === 'object' ? data.claims : {})) {
      const stray = [];
      for (const day of Array.isArray(days) ? days : []) {
        const key = String(day ?? '').trim();
        const dayMonth = key.slice(0, 7);
        if (!MONTH_KEY.test(dayMonth) || dayMonth === month) {
          if (!own[windowId]) own[windowId] = [];
          if (!own[windowId].includes(key)) own[windowId].push(key);
        } else {
          stray.push(key);
        }
      }
      if (stray.length) {
        const targetMonth = stray[0].slice(0, 7);
        const target = `${uid}_${targetMonth}`;
        moves.push({ from: id, to: target, windowId, days: stray });
        if (!final.has(target)) final.set(target, { user_id: uid, month: targetMonth, claims: {} });
        const targetClaims = final.get(target).claims;
        if (!targetClaims[windowId]) targetClaims[windowId] = [];
        for (const key of stray) if (!targetClaims[windowId].includes(key)) targetClaims[windowId].push(key);
      }
    }
  }

  const result = [];
  for (const [id, value] of final) {
    const claims = {};
    for (const [windowId, days] of Object.entries(value.claims)) claims[windowId] = sortDays(days);
    result.push({ id, user_id: value.user_id, month: value.month, claims });
  }
  return { result, moves };
};

const apply = process.argv.includes('--apply');

const main = async () => {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const serviceAccount = JSON.parse(readFileSync(new URL('../secrets/fire-clock-76723-adminsdk.json', import.meta.url), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), projectId });
  const db = getFirestore();

  const snapshot = await db.collection('availability_months').get();
  const docs = snapshot.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  const { result, moves } = normalizedMonths(docs);

  console.log(`project: ${projectId}`);
  console.log(`month documents scanned: ${docs.length}`);
  console.log(`stray days to relocate: ${moves.reduce((n, m) => n + m.days.length, 0)}`);
  for (const m of moves) {
    console.log(`\n- ${m.from} -> ${m.to}`);
    console.log(`    ${m.windowId}: ${m.days.join(', ')}`);
  }
  if (!moves.length) console.log('\nnothing to relocate.');

  if (apply && moves.length) {
    let written = 0;
    for (const doc of result) {
      const ref = db.collection('availability_months').doc(doc.id);
      const existing = await ref.get();
      if (existing.exists) {
        await ref.update({ claims: doc.claims, user_id: doc.user_id, month: doc.month });
      } else {
        await ref.set({ user_id: doc.user_id, month: doc.month, claims: doc.claims });
      }
      written += 1;
    }
    console.log(`\nAPPLIED: ${written} document(s) written.`);
  } else if (apply) {
    console.log('\nnothing to write.');
  } else if (moves.length) {
    console.log('\n(report only - run with --apply to write)');
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

