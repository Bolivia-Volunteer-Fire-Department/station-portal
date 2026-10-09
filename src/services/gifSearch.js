// Looking for a GIF.
//
// THE ONLY PLACE THE APP TALKS TO KLIPY, and it is a plain `fetch` from the browser rather than a Cloud Function. That is
// the API's own design: the key travels in the URL PATH and KLIPY issues a separate key per platform, so the WEB key is
// meant to live in a web bundle. Proxying it through a callable would hide nothing (the key would still be in every
// request) and would add a function invocation, and a cold start, to every keystroke somebody pauses on.
//
// THE KEY IS READ DEFENSIVELY, the way services/firebase.js and utils/pushNotifications.js read theirs - `import.meta` is
// not defined under plain Node, and this module is imported by screens that the harnesses render.
//
// WHAT THIS DOES NOT DO: send anything about the member. KLIPY offers per-user "recent GIFs" and share tracking, both of
// which take a user identifier, and neither is here on purpose - what a member searches for should not leave the station
// attached to their name. Every call below is a search or a list of what is trending, and nothing else.
import { GIF_PAGE_SIZE, gifResultsFrom } from '../utils/chatGifs.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const KLIPY_API_BASE = 'https://api.klipy.com/api/v1';

export const klipyKey = () => String(env.VITE_KLIPY_API_KEY || '').trim();

// Whether a search could work at all, so a screen can say so instead of offering a button that fails at the first byte -
// the same question services/avatarStorage.js answers about the storage bucket.
export const gifSearchConfigured = () => Boolean(klipyKey());

// A SEARCH WHEN THERE IS A QUERY AND WHAT IS TRENDING WHEN THERE IS NOT, which is the whole of the endpoint choice: an
// empty query is not an error, it is somebody opening the picker to see what is going on today.
const endpointFor = (query) => (String(query || '').trim() ? 'gifs/search' : 'gifs/trending');

// Answers `{ gifs, hasNext, page, message }` - ALWAYS with a sentence when something went wrong, never by throwing. A
// picker that throws is a blank panel with nothing in it; a picker that is told "that did not work" is one somebody can try
// again, which is what a station with a patchy connection needs.
export const searchGifs = async ({ query = '', page = 1, perPage = GIF_PAGE_SIZE, locale = 'en_US', signal } = {}) => {
  const key = klipyKey();
  if (!key) return { gifs: [], hasNext: false, page: 1, message: 'GIF search is not set up for this station yet.' };

  const url = new URL(`${KLIPY_API_BASE}/${encodeURIComponent(key)}/${endpointFor(query)}`);
  const term = String(query || '').trim();
  if (term) url.searchParams.set('q', term);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));
  url.searchParams.set('locale', locale);

  try {
    const response = await fetch(url, { signal });
    // A REFUSED KEY IS WORTH SAYING OUT LOUD RATHER THAN SHOWING AS "NO RESULTS": they mean different things to whoever is
    // looking, and only one of them is worth reporting to an administrator.
    if (response.status === 401 || response.status === 403) {
      return { gifs: [], hasNext: false, page: 1, message: 'The GIF search key was refused. Ask an administrator.' };
    }
    if (!response.ok) return { gifs: [], hasNext: false, page: 1, message: 'That search did not work. Try again.' };
    const payload = await response.json();
    // `result` is KLIPY's own success flag, beside the data rather than inside it - so a 200 with `result: false` is a
    // failure that an `response.ok` check alone would treat as a page of nothing.
    if (!payload || payload.result !== true) {
      return { gifs: [], hasNext: false, page: 1, message: 'That search did not work. Try again.' };
    }
    return { message: '', ...gifResultsFrom(payload) };
  } catch (failure) {
    // AN ABORT IS NOT A FAILURE. Typing fast cancels the request in flight, and showing "that did not work" for it would
    // flash an error at somebody for doing nothing wrong. `AbortError` is the only case this is, and it is silent.
    if (failure && failure.name === 'AbortError') return { gifs: [], hasNext: false, page: 1, aborted: true, message: '' };
    return { gifs: [], hasNext: false, page: 1, message: 'Could not reach the GIF service.' };
  }
};
