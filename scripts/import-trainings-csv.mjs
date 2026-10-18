// CLI script to import historical training data from a CSV file into Firestore.
//
// Usage:
//   node scripts/import-trainings-csv.mjs [path/to/trainings.csv]          (dry run - report only)
//   node scripts/import-trainings-csv.mjs [path/to/trainings.csv] --apply  (write to Firestore)
//
// The script:
//   1. Reads the CSV file.
//   2. Fetches the active member roster from Firestore ('users' collection).
//   3. Matches attendee names to member user IDs.
//   4. Groups identical attendee sessions (Date + Category + Duration) into single training documents.
//   5. Batches writes (trainings and training_signatures) into Firestore.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareTrainingImportPlan } from '../src/utils/trainingCsvImport.js';

const BATCH_LIMIT = 400;

// Resolve project ID from .firebaserc or environment
const projectFromFirebaserc = (() => {
  try {
    const raw = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8');
    return JSON.parse(raw).projects?.default;
  } catch {
    return undefined;
  }
})();

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileArg = args.find((arg) => !arg.startsWith('--'));

  if (!fileArg) {
    console.error('Usage: node scripts/import-trainings-csv.mjs <path-to-csv> [--apply]');
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), fileArg);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`\nReading CSV file: ${filePath}`);
  const csvContent = readFileSync(filePath, 'utf8');

  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (!projectId) {
    console.error('No default project in .firebaserc.');
    process.exit(1);
  }

  console.log(`Connecting to ${emulator ? 'Firestore Emulator' : `project "${projectId}"`}...`);

  let db;
  let users = [];

  try {
    const app = emulator
      ? initializeApp({ projectId: projectId || 'demo-station-portal' })
      : initializeApp({ credential: applicationDefault(), projectId });
    db = getFirestore(app);

    const userSnapshot = await db.collection('users').get();
    users = userSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`Loaded ${users.length} members from roster.\n`);
  } catch (error) {
    console.error(`Failed to connect to Firestore: ${(error && error.message) || error}`);
    console.error('\nMake sure you have authenticated via gcloud:');
    console.error(`  gcloud auth application-default login && gcloud config set project ${projectId}`);
    process.exit(1);
  }

  // Generate the plan
  const plan = prepareTrainingImportPlan(csvContent, users);

  console.log('=====================================================');
  console.log('              TRAINING IMPORT SUMMARY                ');
  console.log('=====================================================');
  console.log(`Total CSV rows:             ${plan.totalRows}`);
  console.log(`Valid attendee entries:     ${plan.validRowsCount}`);
  console.log(`Grouped training sessions:  ${plan.sessions.length}`);
  console.log(`Signatures to create:       ${plan.totalSignatures}`);
  console.log(`Matched roster members:     ${plan.matchedCount}`);
  console.log(`Unmatched attendee names:   ${plan.unmatchedAttendees.length}`);
  console.log(`Skipped / malformed rows:   ${plan.skippedRows.length}`);
  console.log('=====================================================\n');

  if (plan.unmatchedAttendees.length > 0) {
    console.warn('⚠️  UNMATCHED ATTENDEE NAMES (will not receive signatures):');
    plan.unmatchedAttendees.forEach((name) => console.warn(`   - "${name}"`));
    console.warn('');
  }

  if (plan.skippedRows.length > 0) {
    console.log(`ℹ️  SKIPPED ROWS (first ${Math.min(5, plan.skippedRows.length)} shown):`);
    plan.skippedRows.slice(0, 5).forEach((item) => {
      console.log(`   Line ${item.rowIndex}: ${item.reason}`);
    });
    console.log('');
  }

  console.log(`SAMPLE GROUPED SESSIONS (first ${Math.min(8, plan.sessions.length)}):`);
  plan.sessions.slice(0, 8).forEach((session, i) => {
    console.log(
      ` ${i + 1}. [${session.date_key}] "${session.title}" (${session.duration} hrs) — ${
        session.attendees.length
      } attendee(s)`
    );
  });
  console.log('');

  if (!apply) {
    console.log('-----------------------------------------------------');
    console.log('REPORT ONLY. No records were written to Firestore.');
    console.log('To perform the import, re-run with --apply:');
    console.log(`  node scripts/import-trainings-csv.mjs "${fileArg}" --apply`);
    console.log('-----------------------------------------------------\n');
    return;
  }

  console.log('Writing records to Firestore...');
  const now = new Date().toISOString();

  let batch = db.batch();
  let opCount = 0;
  let batchesCommitted = 0;

  for (const session of plan.sessions) {
    const trainingRef = db.collection('trainings').doc();
    const trainingData = {
      id: trainingRef.id,
      date: session.date,
      date_key: session.date_key,
      title: session.title,
      duration: session.duration,
      location: '',
      instructors: '',
      narrative: '',
      is_company_training: Boolean(session.is_company_training),
      is_hazmat: Boolean(session.is_hazmat),
      is_ems: Boolean(session.is_ems),
      is_fire_prevention: Boolean(session.is_fire_prevention),
      is_multicompany: Boolean(session.is_multicompany),
      is_training_facility: Boolean(session.is_training_facility),
      is_officer_training: Boolean(session.is_officer_training),
      is_driver_training: Boolean(session.is_driver_training),
      is_entered_into_external: false,
      signature_count: 0,
    };

    batch.set(trainingRef, trainingData);
    opCount++;

    if (opCount >= BATCH_LIMIT) {
      await batch.commit();
      batchesCommitted++;
      batch = db.batch();
      opCount = 0;
    }

    // Write signatures for matched attendees
    for (const attendee of session.attendees) {
      if (!attendee.user || !attendee.user.id) continue;

      const sigRef = db.collection('training_signatures').doc();
      batch.set(sigRef, {
        training_id: trainingRef.id,
        user_id: String(attendee.user.id),
        signed_at: now,
      });
      opCount++;

      if (opCount >= BATCH_LIMIT) {
        await batch.commit();
        batchesCommitted++;
        batch = db.batch();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await batch.commit();
    batchesCommitted++;
  }

  console.log(`\n✅ IMPORT COMPLETE!`);
  console.log(`Created ${plan.sessions.length} trainings and ${plan.totalSignatures} signatures.`);
  console.log(`Committed in ${batchesCommitted} Firestore batch write(s).\n`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

