// The drawing as a URL a browser can load, shared by the two screens that show a map: the member's map screen (which
// hands the URL to Leaflet) and the officer's upload card (which hands it to an `<img>` as a preview).
//
// WHY IT LIVES IN utils/ RATHER THAN BESIDE THE MAP SCREEN, which is where it started: importing it from the map screen
// would pull that screen - and Leaflet with it, ~40 kB gzipped - into the Administration chunk, for a preview that draws
// an <img>. The same reason utils/motion.js holds the app's other shared hook.
//
// A BLOB URL rather than a `data:` URL: base64 inflates a large drawing by a third in memory, and the drawing is already
// held as text. It is revoked when the drawing changes or the screen closes, so nothing keeps a copy of a map alive that
// the app has stopped drawing.
//
// SCRIPT INSIDE IT IS NOT RUN, and that is a property of the `<img>` element rather than a promise this code keeps: a
// browser does not execute an SVG loaded as an image. Nothing in this app ever inlines a drawing as markup.
import { useEffect, useState } from 'react';

export const useDrawingUrl = (svg) => {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const text = String(svg || '');
    if (!text) {
      setUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [svg]);

  return url;
};
