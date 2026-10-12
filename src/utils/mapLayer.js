// The district map: one department's drawn boundary, kept as SVG TEXT in a document of its own.
//
// WHY THE TEXT RATHER THAN A FILE IN THE BUCKET. storage.rules refuses `image/svg+xml` deliberately, and says why:
// an SVG is a picture that can carry script, and this bucket is served from a domain the app trusts. Loosening that
// to hold a district map would trade a real protection for a convenience - so the drawing is instead stored as text
// and drawn ONLY through an `<img>`, which is what Leaflet's imageOverlay is. A browser does not run script inside an
// image, so the picture stays a picture whatever is in it. Nothing is ever inlined as markup.
//
// WHY A DOCUMENT OF ITS OWN rather than a system setting. `settings/public` is read on EVERY sign-in (see
// firestorePayload#settingRows), so a few hundred kilobytes of drawing there would ride along with every member's
// payload and be paid for by the screens that never draw a map. This is read when the Map screen opens, once.
//
// WHAT IS PURE HERE, AND WHY THAT MATTERS. Everything except the three cache functions is a plain function over a
// string, so scripts/verify-district-map.mjs can exercise the refusals without a browser - and the refusals are where
// the risk is: a drawing accepted with a script in it, or refused for a reason nobody can act on, is not something a
// rendered screen would ever show.
//
// THE SIZE CAP IS THE DOCUMENT CAP, not a taste. Firestore refuses a document over 1 MiB, and a refusal at save time
// arrives without an explanation the officer can use. So the cap is checked here, in the browser, BEFORE the bytes leave -
// and repeated in firestore.rules as the backstop a crafted request cannot get past. Two copies of one number is what
// drifts, so scripts/verify-district-map reads both and fails if they ever disagree.

export const MAP_LAYER_COLLECTION = 'map_layers';

// ONE FIXED ID, like `settings/public`: there is one district map. A collection rather than a settings key because
// the shape here is nothing like a setting - it is a drawing with its own measurements - and because pins are a
// second document in this same collection later, which is the "separate pin layer" the station asked for.
export const MAP_LAYER_DOC_ID = 'district';

// 900 KB, which leaves the document encoding its room under Firestore's 1 MiB. A drawn boundary is normally tens of
// kilobytes - the cap is here so a photograph somebody renamed to .svg, or an exported raster map, is refused with a
// number in the message rather than by Firestore with none.
export const MAP_LAYER_MAX_BYTES = 900 * 1024;

// The device's copy, so the map draws with no network. Keyed by NOTHING else: the drawing is the station's, not the
// member's, so the same device shows the same map to everybody who signs in on it.
export const MAP_LAYER_CACHE_KEY = 'sp_district_map_layer';

// A number a person can read, for the two messages that have to say one.
export const formatBytes = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} bytes`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

// UTF-8 bytes, because that is what both limits count. TextEncoder is in every browser this app supports and in Node,
// so the fallback is only for a harness on something older - and it is the byte count that matters, not the character
// count: a drawing full of accented street names is bigger than it looks.
export const mapSvgBytes = (svgText) => {
  const text = String(svgText ?? '');
  if (typeof TextEncoder === 'undefined') return text.length;
  return new TextEncoder().encode(text).length;
};

// The opening `<svg …>` tag, which is where the drawing's own measurements live.
const svgOpeningTag = (svgText) => (String(svgText ?? '').match(/<svg\b[^>]*>/i) || [''])[0];

// One attribute's raw value. Written as a function rather than a table of regexes so the quoting is handled in one
// place: an exporter may write width="600" or width='600', and both are the same drawing.
const svgAttribute = (svgText, name) => {
  const tag = svgOpeningTag(svgText);
  if (!tag) return '';
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  if (!match) return '';
  return match[1] !== undefined ? match[1] : match[2];
};

// A length the drawing actually states. A PERCENTAGE IS NOT ONE: `width="100%"` is a share of a box the file has not
// seen, and treating it as 100 pixels would lay the map out at a size its author never chose. Zero means "not stated".
const svgLength = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || raw.includes('%')) return 0;
  const number = Number.parseFloat(raw);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

// The numbers out of a viewBox or a `points` list. Split on commas AND whitespace, because both spellings are common
// and a viewBox is legal with either.
export const svgNumbers = (value) =>
  String(value ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => Number.parseFloat(part));

// The box the drawing was authored in, which is the map's coordinate space: Leaflet is handed a plain x/y plane (its
// CRS.Simple) and the drawing is laid across it, so one unit of the drawing is one unit of the map.
//
// IT PREFERS THE viewBox, and that is not arbitrary: a viewBox states the drawing's own coordinates, while width and
// height state how big it happens to be drawn on someone's screen. When a viewBox exists it is the truth about the
// picture, and it is also what survives a resize of the drawing.
export const mapSvgSize = (svgText) => {
  const box = svgNumbers(svgAttribute(svgText, 'viewBox'));
  if (box.length === 4 && box.every((number) => Number.isFinite(number)) && box[2] > 0 && box[3] > 0) {
    return { width: box[2], height: box[3] };
  }
  const width = svgLength(svgAttribute(svgText, 'width'));
  const height = svgLength(svgAttribute(svgText, 'height'));
  if (width > 0 && height > 0) return { width, height };
  return null;
};

// The viewBox to WRITE DOWN: the drawing's own when it has one, and a synthesised one when it only states a size.
// Stored rather than derived on every read, because it is the one number that makes the file draw the same way in
// every renderer - an SVG with only width and height and no viewBox is scaled differently by different browsers.
export const mapSvgViewBox = (svgText) => {
  const raw = String(svgAttribute(svgText, 'viewBox') ?? '').trim();
  const numbers = svgNumbers(raw);
  if (numbers.length === 4 && numbers.every((number) => Number.isFinite(number))) {
    return numbers.join(' ');
  }
  const size = mapSvgSize(svgText);
  return size ? `0 0 ${size.width} ${size.height}` : '';
};

// An XML declaration, a doctype and comment banners are legal before the root element, and an exported drawing very
// often has all three. Stripped so that the "is this an SVG" check is about the ROOT element rather than about the
// first eleven characters of the file - which is how a perfectly good drawing gets refused.
const svgBody = (svgText) =>
  String(svgText ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^\s*<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/^\s*<!--[\s\S]*?-->/, '')
    .trim();

// Every tag in the drawing, which is where an attribute may live. Attributes are checked HERE rather than across the
// whole file so that a word in a street label cannot be mistaken for one: "on" followed by "=" inside a <text> is text,
// and refusing a drawing because of its own labels would be a refusal nobody could explain.
const svgTags = (svgText) => String(svgText ?? '').match(/<[^>]*>/g) || [];

// The refusals. NOTHING IS REWRITTEN, deliberately: a drawing is a surveyed artefact, the officer should recognise what
// is stored, and a silent repair pass is one clever edit away from damaging a file nobody can regenerate. So a drawing
// carrying scripting is refused with the reason said out loud, and it is fixed in the editor it was drawn in.
//
// WHY THESE FOUR. A script tag can run code, a foreignObject can carry a whole HTML document, an `on…=` attribute is the
// same thing in one attribute, and a javascript: URL is the third way of saying it. The first three are refused
// anywhere in the file; the last is only meaningful in an attribute, so it is looked for there.
const SVG_SCRIPT_TAG = /<\s*script\b/i;
const SVG_FOREIGN_OBJECT = /<\s*foreignObject\b/i;
const SVG_EVENT_HANDLER = /\son[a-z]+\s*=/i;
const SVG_JAVASCRIPT_URL = /javascript\s*:/i;

// Every reference the drawing makes to something else. A drawing may legitimately point INSIDE itself (`#area-4`, which
// is how one shape is reused as another) or at an image EMBEDDED in the file (`data:`). Anything else - a path, a file
// beside it, an http address - is refused, because inside an <img> a browser will not fetch it: the map would simply be
// missing that part, silently, on somebody else's machine. Better to say so at upload than to look wrong later.
const svgReferences = (svgText) =>
  [...String(svgText ?? '').matchAll(/\b(?:xlink:href|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((match) =>
    match[1] !== undefined ? match[1] : match[2]
  );

export const svgReferenceIsExternal = (value) => {
  const target = String(value ?? '').trim();
  if (!target) return false;
  return !target.startsWith('#') && !target.startsWith('data:');
};

// Why a file cannot be used as the district map - an empty string when it can.
//
// THE ORDER IS THE POINT. These are messages an officer acts on, so the first one that fits has to be the one with the
// most obvious thing to do about it: a file that is merely too big should hear the cap rather than a lecture about
// scripting it does not contain.
export const mapSvgProblem = (svgText) => {
  const svg = String(svgText ?? '');
  if (!svg.trim()) return 'Choose an SVG file to upload.';

  if (!/^<svg[\s>]/i.test(svgBody(svg))) {
    return 'That file is not an SVG drawing. Export the map as SVG from the app you drew it in, and upload that file.';
  }

  if (SVG_SCRIPT_TAG.test(svg) || SVG_FOREIGN_OBJECT.test(svg)) {
    return 'That drawing contains a script, and this app will not store one. Remove the script, export the map again, and upload it.';
  }

  const tags = svgTags(svg);
  if (tags.some((tag) => SVG_EVENT_HANDLER.test(tag)) || tags.some((tag) => SVG_JAVASCRIPT_URL.test(tag))) {
    return 'That drawing runs code when something is clicked, and this app will not store one. Remove the click handlers, export the map again, and upload it.';
  }

  const external = svgReferences(svg).filter(svgReferenceIsExternal);
  if (external.length) {
    const what = external.length === 1 ? 'a file' : `${external.length} files`;
    return `That drawing points at ${what} outside itself, which the map cannot show. Embed the image in the drawing (or delete the reference), and upload it again.`;
  }

  const bytes = mapSvgBytes(svg);
  if (bytes > MAP_LAYER_MAX_BYTES) {
    return `That drawing is ${formatBytes(bytes)}, and the most this app can store is ${formatBytes(MAP_LAYER_MAX_BYTES)}. Simplify it - or export it at a coarser detail - and upload it again.`;
  }

  if (!mapSvgSize(svg)) {
    return 'That drawing does not state its size, so the map has nothing to scale it by. Open it in your editor, give it a width and a height (or a viewBox), and upload it again.';
  }

  return '';
};

// The bounds Leaflet lays the drawing across, in the drawing's OWN units: [[south, west], [north, east]], because a map
// counts up from the bottom-left and an SVG counts down from the top-left. CRS.Simple has no earth underneath it at all,
// so this is the whole of the geometry - there is no latitude here to be right or wrong about.
//
// The stored numbers are preferred and the text is the fallback, so a document that already carries its measurements
// (every save does) never re-parses its own drawing just to be drawn.
export const mapLayerBounds = (layer) => {
  const size = mapSvgSize(layer?.svg);
  const width = Number(layer?.width) > 0 ? Number(layer.width) : (size?.width ?? 0);
  const height = Number(layer?.height) > 0 ? Number(layer.height) : (size?.height ?? 0);
  if (!(width > 0) || !(height > 0)) return null;
  return [
    [0, 0],
    [height, width],
  ];
};

// Whether there is a drawing at all. Nothing uploaded is NOT a fault - it is a station that has not drawn one yet - so
// the map screen says that rather than showing an error.
export const mapLayerIsEmpty = (layer) => !String(layer?.svg ?? '').trim();

// Whether a STORED layer can be drawn. A document edited by hand, or written by an older build, is checked through the
// same refusals an upload is: the map screen should not be the place a bad drawing is discovered.
export const mapLayerProblem = (layer) => (mapLayerIsEmpty(layer) ? '' : mapSvgProblem(layer.svg));

// The fields a save writes, normalised in ONE place: the admin card checks a file with this and the writer stores its
// answer, so what the screen promised and what the document holds cannot drift apart. null means "refused", and the
// caller has already shown the reason.
export const mapLayerFields = (svgText) => {
  const svg = String(svgText ?? '');
  if (mapSvgProblem(svg)) return null;
  const size = mapSvgSize(svg);
  return { svg, width: size.width, height: size.height, view_box: mapSvgViewBox(svg) };
};

// THE DEVICE'S COPY, so the map draws with no network - which is most of the reason this app exists.
//
// Guarded in every direction, because localStorage is not always there: a Node harness has none, and a browser in
// private mode throws on write. A cache that cannot be written is a MISS, never an error: the map still draws from the
// read just made and is read again next time, so a failure here never becomes a sentence on somebody's screen.
const cacheAvailable = () => {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch {
    return false;
  }
};

export const cachedMapLayer = () => {
  if (!cacheAvailable()) return null;
  try {
    const raw = localStorage.getItem(MAP_LAYER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !mapLayerIsEmpty(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const cacheMapLayer = (layer) => {
  if (!cacheAvailable()) return false;
  try {
    // Removing the map clears the copy as well, or the next visit would draw the drawing an officer just deleted.
    if (mapLayerIsEmpty(layer)) {
      localStorage.removeItem(MAP_LAYER_CACHE_KEY);
      return true;
    }
    localStorage.setItem(
      MAP_LAYER_CACHE_KEY,
      JSON.stringify({
        svg: layer.svg,
        width: layer.width,
        height: layer.height,
        view_box: layer.view_box,
      })
    );
    return true;
  } catch {
    return false;
  }
};

export const clearCachedMapLayer = () => {
  if (!cacheAvailable()) return false;
  try {
    localStorage.removeItem(MAP_LAYER_CACHE_KEY);
    return true;
  } catch {
    return false;
  }
};





