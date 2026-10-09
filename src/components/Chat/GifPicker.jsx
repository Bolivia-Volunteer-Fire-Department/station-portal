// Picking a picture to send.
//
// THE PLACEHOLDER AND THE FOOTER ARE NOT DECORATION: KLIPY's terms ask for "Search KLIPY" as the field's placeholder and a
// visible mark wherever their content is shown, and this is a picker somebody will read quickly. Both are in from the
// start rather than retrofitted, because attribution that arrives later is attribution that was missing for a while.
//
// IT NEVER PLAYS SOUND. The API also offers mp4 and webm, which are smaller, and a chat that autoplays a video with a
// soundtrack in a fire station at three in the morning is not a feature - so the picker draws webp and gif only, the same
// two formats a message stores (utils/chatGifs.js#gifAssetFor).
//
// SEARCHES ARE CANCELLED WHEN THE NEXT ONE STARTS AND WHEN THE PICKER CLOSES. Without that, results land in whatever order
// the network feels like and a slow request for "fi" can overwrite the results for "fire truck" - the bug that makes people
// say a search box is "laggy" when it is really out of order.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { searchGifs, gifSearchConfigured } from '../../services/gifSearch';

const DEBOUNCE_MS = 300;

export default function GifPicker({ onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(null);
  const configured = gifSearchConfigured();

  // One loader for both "what is trending" and "load more": a page of results either replaces the grid or is appended to it,
  // and the difference is one argument.
  const load = useCallback(
    async (term, wanted, { append = false } = {}) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);
      const result = await searchGifs({ query: term, page: wanted, signal: controller.signal });
      // A LATER REQUEST HAS ALREADY TAKEN OVER when the controller is no longer the current one - so this result is dropped
      // rather than drawn, and it does not clear the loading state the newer one owns.
      if (inFlight.current !== controller) return;
      inFlight.current = null;
      setLoading(false);
      if (result.aborted) return;
      setMessage(result.message || '');
      setGifs((current) => (append ? [...current, ...result.gifs] : result.gifs));
      setPage(result.page || wanted);
      setHasNext(result.hasNext);
      // An append that returns nothing must not leave "Load more" on screen forever.
      if (append && !result.gifs.length) setHasNext(false);
    },
    []
  );

  // TRENDING FIRST, then a search 300ms after typing stops - and every keystroke cancels the request before it, so the grid
  // only ever shows the answer to the last thing typed.
  useEffect(() => {
    if (!configured) return undefined;
    const timer = setTimeout(() => {
      load(query, 1);
    }, query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, configured, load]);

  // CLOSING CANCELS: the request is worthless once nobody is looking at the picker, and a stale one could still arrive.
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    []
  );

  return (
    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-600 dark:bg-slate-800">
      <div className="mb-2 flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        {/* THE PLACEHOLDER IS KLIPY'S OWN REQUIREMENT, and it is also genuinely useful: it says where the pictures come
            from, which is a fact somebody using a station's chat is entitled to have. */}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search KLIPY"
          aria-label="Search KLIPY for a GIF"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-red-400 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Close
        </button>
      </div>

      {!configured ? (
        // A SENTENCE, NOT AN EMPTY GRID. Whoever sees this is not going to fix it themselves, and a search box that returns
        // nothing at all looks like the station's internet rather than like a missing key.
        <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
          GIF search is not set up for this station yet. Ask an administrator.
        </p>
      ) : (
        <>
          <div className="max-h-64 min-h-[8rem] overflow-y-auto">
            {gifs.length === 0 && !loading && (
              <p className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                {message || (query ? 'Nothing for that. Try another word.' : 'Nothing is trending just now.')}
              </p>
            )}
            {/* SQUARE TILES, CROPPED rather than letterboxed: a grid of varying heights is a grid nobody can scan, and every
                GIF picker anybody has used crops to a square for exactly that reason. The height is reserved by the aspect
                ratio, so the grid does not reflow as twenty pictures arrive at once. */}
            <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4">
              {gifs.map((gif) => (
                <li key={gif.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(gif.asset);
                      onClose?.();
                    }}
                    title={gif.title || 'Send this picture'}
                    className="block aspect-square w-full overflow-hidden rounded-lg bg-slate-100 hover:ring-2 hover:ring-red-500 dark:bg-slate-700"
                  >
                    <img
                      src={gif.previewUrl}
                      alt={gif.title || 'A GIF'}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {loading && (
              <p className="flex items-center justify-center gap-2 p-3 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Looking…
              </p>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            {/* THE MARK KLIPY ASKS FOR, in the one place a person looks after choosing a picture. It links to them, because a
                mark that does not go anywhere is a mark that is only there to satisfy a sentence. */}
            <a
              href="https://klipy.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              Powered by KLIPY
            </a>
            {hasNext && (
              <button
                type="button"
                onClick={() => load(query, page + 1, { append: true })}
                disabled={loading}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Load more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
