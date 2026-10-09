// THE PICTURE THAT RIDES ON A MESSAGE, and nothing else: no key, no network, no React. It is here rather than beside the
// search call so it can be asserted under plain Node (scripts/verify-chat.mjs), because the choice it makes is the one
// that decides what a station's phones download all day.
//
// A GIF IN A CHAT IS ONE DOWNLOAD PER MEMBER PER MESSAGE: everybody who scrolls past it fetches it again, on a phone, on
// a station's connection, every time the conversation is reopened. KLIPY hands back the same clip in FIVE formats at FOUR
// sizes each - twenty URLs for one joke - so the choice is made once, at send time, instead of on every reader's phone.
//
// THE CHOICE IS BY SIZE, NOT BY FORMAT, and that is not a detail. Measured on a real trending result:
//
//     hd webp   498x249    29 KB      hd gif   498x249  1025 KB    <- webp 35x smaller
//     md webp   640x320   342 KB      md gif   640x320   150 KB    <- and here the GIF is smaller
//
// So "use webp" is not the rule and "use md" is not the rule either. The rule is the SMALLEST asset that is still wide
// enough to see, which picks the 29 KB one above and would pick the gif in the second case.
export const KLIPY_MEDIA_SUFFIX = '.klipy.com';

// WIDE ENOUGH TO READ ON A PHONE, and no more. Everything below this is a thumbnail: the 220px and 90px assets exist for
// grid tiles, and blowing one up in a bubble is a blurry picture with a small file size, which is not a saving.
export const GIF_MIN_WIDTH = 300;

// What a row can hold. A KLIPY media URL is around 80 characters, so this is headroom rather than a limit anybody meets.
export const GIF_URL_MAX = 512;
export const GIF_ALT_MAX = 200;

// WHY A LINK CANNOT BE STORED, or '' when it can. The mirror of the rule in the SEND function (functions/chat.js), which
// is the one that actually decides: this copy exists so a bad link is refused where somebody can see why, and
// scripts/verify-chat.mjs asserts the two agree rather than trusting that they do.
//
// HTTPS, AND KLIPY ONLY. A suffix rather than a fixed list of hosts, because KLIPY serves media from subdomains
// (`static.klipy.com` today) and a fixed list would break sending the day they add one - while a suffix still refuses
// every other host on the internet. Nobody should be able to put an arbitrary URL in a message and have the app fetch it
// for every member in the station.
export const gifUrlProblem = (url, { required = true } = {}) => {
  const clean = String(url || '').trim();
  if (!clean) return required ? 'That message has no picture link.' : '';
  if (clean.length > GIF_URL_MAX) return 'That picture link is too long to store.';
  let parsed = null;
  try {
    parsed = new URL(clean);
  } catch {
    return 'That picture link is not a link.';
  }
  if (parsed.protocol !== 'https:') return 'A picture link has to be https.';
  const host = parsed.hostname.toLowerCase();
  const bare = KLIPY_MEDIA_SUFFIX.slice(1);
  // The bare domain as well as the suffix, because `endsWith('.klipy.com')` is false for `klipy.com` itself, and that is
  // a link a person could plausibly paste.
  if (host !== bare && !host.endsWith(KLIPY_MEDIA_SUFFIX)) return 'Pictures have to come from KLIPY.';
  return '';
};

// The dimensions the bubble reserves before a single byte of the picture arrives, so a conversation does not push its text
// up and down as each GIF loads - a problem that looks like a browser bug rather than like a missing field.
export const gifAspectRatio = ({ width = 0, height = 0 } = {}) => {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return '';
  return `${w} / ${h}`;
};

// The alt text: KLIPY's own title for the clip, tidied. It is written for a human ("Friends Joey: Yeah Baby! It's
// Friday!"), it costs nothing to carry, and it is the difference between a screen reader saying "image" and saying what
// somebody chose to send.
export const gifAltFrom = (title) => String(title || '').replace(/\s+/g, ' ').trim().slice(0, GIF_ALT_MAX);

// WHICH ASSET TO STORE, from one item of a KLIPY response.
//
// Returns `{ url, fallbackUrl, width, height, bytes, alt }`, or null when the item has nothing usable. What it returns is
// all the message row holds: the rest of the response - ids, slugs, tags, the nineteen assets nobody chose - is left
// behind, because a conversation should not carry a copy of the search index that produced it.
export const gifAssetFor = (item, { minWidth = GIF_MIN_WIDTH } = {}) => {
  const file = (item && item.file) || {};
  const candidates = [];
  for (const [size, formats] of Object.entries(file)) {
    for (const [format, asset] of Object.entries(formats || {})) {
      // ONLY THINGS A BROWSER PLAYS BY ITSELF. `jpg` is a still, which is not what somebody picking a GIF asked for; `mp4`
      // and `webm` are often smaller but need a <video>, and a chat that has to choose a player per message renders
      // differently on every device for the same conversation.
      if (format !== 'webp' && format !== 'gif') continue;
      const url = String((asset && asset.url) || '');
      const width = Number(asset && asset.width) || 0;
      const height = Number(asset && asset.height) || 0;
      const bytes = Number(asset && asset.size) || 0;
      if (!url || !width || !height) continue;
      if (width < minWidth) continue;
      candidates.push({ size, format, url, width, height, bytes });
    }
  }
  if (!candidates.length) return null;
  // SMALLEST FIRST, with webp winning a tie: an animated webp is what every current browser prefers, and a tie means the
  // two files are the same size anyway. `sort` is stable, so within a tie the order is the order KLIPY sent.
  candidates.sort((a, b) => a.bytes - b.bytes || (a.format === b.format ? 0 : a.format === 'webp' ? -1 : 1));
  const chosen = candidates[0];
  // THE FALLBACK IS THE GIF OF THE SAME SIZE, and only when the choice was a webp: older iOS cannot animate one, and a
  // message that draws nothing at all is worse than one that costs more bytes. Storing the second URL costs eighty
  // characters and removes the case.
  const sameSize = file[chosen.size] || {};
  const gif = chosen.format === 'webp' ? String((sameSize.gif && sameSize.gif.url) || '') : '';
  return {
    url: chosen.url,
    fallbackUrl: gifUrlProblem(gif, { required: false }) ? '' : gif,
    width: chosen.width,
    height: chosen.height,
    bytes: chosen.bytes,
    alt: gifAltFrom(item && item.title),
  };
};

// WIDE ENOUGH TO RECOGNISE IN A GRID. A tile is a thumbnail somebody scans, not a picture somebody reads, so it can be much
// smaller than what a message stores - and it is fetched for every result on the page, which is the one place in this
// feature where being cheap matters more than being sharp.
export const GIF_TILE_MIN_WIDTH = 120;
export const GIF_PAGE_SIZE = 24;

// TURNING A RESPONSE INTO WHAT A SCREEN DRAWS, and it is here rather than in the service so it can be asserted under plain
// Node against a real response body. The service's job is the fetch; everything that could be wrong about the SHAPE lives
// in this function.
//
// TWO ASSETS PER RESULT, DELIBERATELY. `previewUrl` is the small one the grid draws, and `asset` is the full-size choice
// (gifAssetFor with no floor) that gets stored if somebody picks it. They are different files, and using the preview as the
// message would send a 220px blur to everybody in the station.
export const gifResultsFrom = (response, { minWidth = GIF_TILE_MIN_WIDTH } = {}) => {
  const page = (response && response.data) || {};
  const items = Array.isArray(page.data) ? page.data : [];
  return {
    gifs: items
      .map((item) => {
        const tile = gifAssetFor(item, { minWidth });
        // The FULL-size choice can come back null (nothing wide enough, no webp or gif) while a tile exists, and the reverse
        // cannot happen - so a result is dropped only when there is nothing to draw at all.
        const full = gifAssetFor(item) || tile;
        if (!tile || !full) return null;
        return {
          // `id` is a number in the response and a string everywhere else in this app; the slug and the url are fallbacks
          // so that a result always has a key to draw by.
          id: String(item.id ?? item.slug ?? tile.url),
          title: gifAltFrom(item.title),
          previewUrl: tile.url,
          width: tile.width,
          height: tile.height,
          asset: full,
        };
      })
      .filter(Boolean),
    // The paging shape, read exactly as KLIPY sends it: `has_next` and `current_page` inside `data`, beside the items.
    page: Number(page.current_page) || 1,
    hasNext: Boolean(page.has_next),
  };
};

