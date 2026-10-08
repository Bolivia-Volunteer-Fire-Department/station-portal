// The certification files: what may be attached, where the object lives, and what is written down about it.
//
// PURE, AND SEPARATE FROM THE CALLABLES FOR THE REASON functions/rosterPage.js IS: this repo runs no Functions
// emulator, so nothing in functions/index.js is exercised by the suite at all - anything a callable could get wrong
// has to live where a harness can reach it. scripts/verify-certifications.mjs asks these directly, and it also
// asserts that the cap and the type list below still agree with storage.rules, which is where they are ENFORCED.

// 5 MB. A one- or two-page scan is a few hundred KB and a phone photo of a card is a couple of MB, so this is
// generous for what belongs here and small enough that nothing else can hide in it.
const CERTIFICATION_FILE_MAX_BYTES = 5 * 1024 * 1024;

// application/pdf, image/jpeg, image/png - and NOTHING else. Two omissions are the point, and both are refused
// rather than quietly stored:
//
//   * no image/svg+xml, because an SVG is a picture that can carry script and these files are served from a domain
//     the app trusts;
//   * no image/heic, because an iPhone will upload one happily and no browser can display it - so a file nobody can
//     open is refused at the moment an officer can still do something about it.
const CERTIFICATION_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// The object path: certifications/{member uid}/{record id}/{file id}. The member's uid is IN THE PATH so the member's
// own read in storage.rules is a string comparison rather than another pair of document reads; the record id is in
// there so a bucket listing reads as a filing system rather than a pile of uuids.
const CERTIFICATION_FILE_PREFIX = 'certifications';

const certificationFilePath = ({ userId, recordId, fileId }) =>
  `${CERTIFICATION_FILE_PREFIX}/${userId}/${recordId}/${fileId}`;

// Why a file may not be attached, as a sentence for the officer who chose it - or null when it may. A message they can
// act on beats a code they cannot: "that file is 12 MB" is fixable, "invalid-argument" is not.
const certificationFileError = ({ contentType, size }) => {
  const type = String(contentType || '').trim().toLowerCase();
  if (!CERTIFICATION_FILE_TYPES.includes(type)) {
    if (type === 'image/heic' || type === 'image/heif') {
      return 'Photos from an iPhone are often HEIC, which no browser can open. Take a screenshot instead, or set the camera to JPEG (Settings, Camera, Formats, Most Compatible) and attach that.';
    }
    return 'A scan has to be a PDF, a JPEG or a PNG.';
  }
  const bytes = Number(size) || 0;
  if (bytes <= 0) return 'That file is empty.';
  if (bytes > CERTIFICATION_FILE_MAX_BYTES) {
    return `That file is about ${Math.ceil(bytes / (1024 * 1024))} MB, and the limit is 5 MB.`;
  }
  return null;
};

// The row written when a file is attached: one per certification record, holding the PATH of the object and never a
// download URL. A download URL carries a token, and a token is a secret that works for whoever holds it - so it is
// minted when somebody opens the file and is never written down.
//
// The id is a FIELD as well as the document key, as every other row in this app is, because everything that lists
// rows reads it off the row. `uploaded_at` is a station-time string, the same shape the rest of the app stores and
// sorts by (see stationTimestamp in functions/index.js).
const certificationFileRow = ({
  id,
  recordId,
  userId,
  storagePath,
  name,
  contentType,
  size,
  uploadedBy,
  uploadedAt,
}) => ({
  id,
  certification_id: recordId,
  user_id: userId,
  storage_path: storagePath,
  name,
  content_type: contentType,
  size,
  uploaded_by: uploadedBy,
  uploaded_at: uploadedAt,
});

module.exports = {
  CERTIFICATION_FILE_MAX_BYTES,
  CERTIFICATION_FILE_PREFIX,
  CERTIFICATION_FILE_TYPES,
  certificationFileError,
  certificationFilePath,
  certificationFileRow,
};
