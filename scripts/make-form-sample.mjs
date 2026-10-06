// Builds the STAND-IN blank the Forms feature is demonstrated with, until the station's real state PDF arrives.
//
//   npm run make:form-sample
//
// WHY A SAMPLE RATHER THAN NOTHING. The engine, the config screen and the run screen are all built and tested without a
// PDF (that was the point), but nothing can be SHOWN working without a blank to fill - and a blank has to be a file in
// `public/forms/`. This writes one: a plain "Member Training Record" whose field names line up with the `training_summary`
// source, so mapping it in Administration → Forms is a real exercise rather than a guess.
//
// THE REAL FORM REPLACES IT WITH NOTHING CODE-SHAPED: drop the state's PDF into `public/forms/`, point the row in
// `src/utils/formCatalog.js` at it, and delete this sample and its row. Nothing in the engine, the filler or the screens
// knows the difference - they take bytes.
//
// Generated rather than committed as a mystery binary: this file is the record of what the sample contains, and
// regenerating it is one command.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// The fields, in the order they are drawn. The names are what an officer will see in the mapper and point at values, so
// they are spelled the way the app's own data is: `Member Name`, and one per training category the source totals.
const ROWS = [
  ['Member name', 'Member Name'],
  ['Total hours', 'Total Hours'],
  ['Company training (hrs)', 'Company Training Hours'],
  ['Hazmat (hrs)', 'Hazmat Hours'],
  ['EMS (hrs)', 'EMS Hours'],
  ['Fire prevention (hrs)', 'Fire Prevention Hours'],
  ['Multi-company (hrs)', 'Multi-company Hours'],
  ['Training facility (hrs)', 'Training Facility Hours'],
  ['Officer training (hrs)', 'Officer Training Hours'],
  ['Driver training (hrs)', 'Driver Training Hours'],
  ['Other (hrs)', 'Other Hours'],
  ['Generated', 'Generated'],
];

const main = async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([420, 560]);

  page.drawText('Member Training Record', { x: 40, y: 522, size: 16, font: bold });
  page.drawText('Sample blank — replace with the station’s own form.', { x: 40, y: 504, size: 9, font });
  page.drawLine({ start: { x: 40, y: 494 }, end: { x: 380, y: 494 }, thickness: 0.75 });

  const form = doc.getForm();
  let y = 460;
  ROWS.forEach(([label, name]) => {
    page.drawText(label, { x: 40, y: y + 5, size: 10, font });
    form.createTextField(name).addToPage(page, { x: 230, y, width: 150, height: 18 });
    y -= 30;
  });

  mkdirSync(new URL('../public/forms/', import.meta.url), { recursive: true });
  const target = new URL('../public/forms/member-training-record.pdf', import.meta.url);
  writeFileSync(target, await doc.save());
  console.log(`Wrote ${ROWS.length} fields to ${target.pathname}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
