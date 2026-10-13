// Searches and fetches trending GIFs from KLIPY for the chat system.
import { GIF_PAGE_SIZE, gifResultsFrom } from '../utils/chatGifs.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const KLIPY_API_BASE = 'https://api.klipy.com/api/v1';

export const klipyKey = () => String(env.VITE_KLIPY_API_KEY || '').trim();

// Returns true if the station has configured a KLIPY API key.
export const gifSearchConfigured = () => Boolean(klipyKey());

// Choose search or trending endpoint based on whether the user typed a query.
const endpointFor = (query) => (String(query || '').trim() ? 'gifs/search' : 'gifs/trending');

// Searches for GIFs or fetches trending GIFs if query is empty.
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
    // Tell the user if the station's API key is invalid.
    if (response.status === 401 || response.status === 403) {
      return { gifs: [], hasNext: false, page: 1, message: 'The GIF search key was refused. Ask an administrator.' };
    }
    if (!response.ok) return { gifs: [], hasNext: false, page: 1, message: 'That search did not work. Try again.' };
    const payload = await response.json();
    // Verify the KLIPY API success field.
    if (!payload || payload.result !== true) {
      return { gifs: [], hasNext: false, page: 1, message: 'That search did not work. Try again.' };
    }
    return { message: '', ...gifResultsFrom(payload) };
  } catch (failure) {
    // If the request was aborted because the user kept typing, do not show an error.
    if (failure && failure.name === 'AbortError') return { gifs: [], hasNext: false, page: 1, aborted: true, message: '' };
    return { gifs: [], hasNext: false, page: 1, message: 'Could not reach the GIF service.' };
  }
};
