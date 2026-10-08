// What a certification scan may be, and what it may weigh - the CLIENT's copy of the rule.
//
// This copy exists to answer BEFORE anything is uploaded, not to enforce: storage.rules refuses the same files on the
// server, and functions/certificationFiles.js says the same thing a third time where the metadata row is written. Three
// statements of one rule is two too many, so scripts/verify-certifications.mjs asserts that all three agree - a cap
// raised in one place and not the others fails the suite rather than shipping. What this copy buys is a sentence
// beside the file picker instead of the same refusal arriving after a 4 MB upload has crossed the network.

export const CERTIFICATION_FILE_MAX_BYTES = 5 * 1024 * 1024;

// Deliberately the same three types as storage.rules: no SVG (a picture that can carry script) and no HEIC (which no
// browser can open, so a file nobody can see is refused while the officer can still do something about it).
export const CERTIFICATION_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// The file picker's own accept list, so the dialog that opens is already the list that will be accepted - and so a
// phone offers its camera for the photo cases rather than its files app.
export const CERTIFICATION_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png';

// Why a chosen file cannot be attached, as a sentence, or null when it can. The type comes from the FILE rather than
// the name: that is what the browser declares to the bucket, so it is what the rules will read.
export const certificationFileProblem = (file) => {
  if (!file) return 'Choose a file first.';
  const type = String(file.type || '').trim().toLowerCase();
  if (!CERTIFICATION_FILE_TYPES.includes(type)) {
    if (type === 'image/heic' || type === 'image/heif') {
      return 'Photos from an iPhone are often HEIC, which no browser can open. Take a screenshot instead, or set the camera to JPEG (Settings, Camera, Formats, Most Compatible).';
    }
    return 'A scan has to be a PDF, a JPEG or a PNG.';
  }
  if (!(file.size > 0)) return 'That file is empty.';
  if (file.size > CERTIFICATION_FILE_MAX_BYTES) {
    return `That file is ${formatFileSize(file.size)}, and the limit is 5 MB.`;
  }
  return null;
};

// "18 KB", "1.4 MB" - for the line that shows what is attached to a record.
export const formatFileSize = (bytes) => {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

// Photos are downscaled before upload (see services/certificationFileStorage.js). A 12-megapixel phone photo of a card
// is several megabytes of detail nobody needs, and it is read on a phone screen: the longest edge comes down to this,
// which still leaves a card comfortably legible.
export const CERTIFICATION_PHOTO_MAX_EDGE = 2000;
export const CERTIFICATION_PHOTO_QUALITY = 0.85;
