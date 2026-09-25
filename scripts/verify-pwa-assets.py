#!/usr/bin/env python3
"""Verify every PWA asset referenced by the built app actually exists.

Catches the easy-to-miss failure after swapping icons or splash images: a path
that is referenced but not shipped (or shipped but never referenced), which
otherwise only shows up as a 404 in a browser's Network tab.

Files in `public/` are copied to `dist/` verbatim, so the manifest and service
worker must reference them with **relative** paths; `index.html` uses absolute
paths that Vite rewrites to the deployed base path.

Usage:
    npm run build && python3 scripts/verify-pwa-assets.py
    python3 scripts/verify-pwa-assets.py --base /my-repo/ --dist dist
"""

import argparse
import json
import os
import re
import sys

# Assets that are allowed to be referenced only by index.html, never by the
# manifest or service worker (and vice versa). Used for the orphan report.
EXPECTED_ORPHAN_OK = 'favicon.ico'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', default='dist', help='build output directory')
    parser.add_argument('--base', default='/',
                        help='deployed base path, e.g. /station-portal/ (default /)')
    args = parser.parse_args()

    index_path = os.path.join(args.dist, 'index.html')
    manifest_path = os.path.join(args.dist, 'manifest.webmanifest')
    sw_path = os.path.join(args.dist, 'sw.js')

    for path in (index_path, manifest_path, sw_path):
        if not os.path.exists(path):
            sys.exit('%s not found - run `npm run build` first.' % path)

    html = open(index_path, encoding='utf-8').read()
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    service_worker = open(sw_path, encoding='utf-8').read()

    referenced = {}   # dist-relative path -> list of origins
    missing = []

    def check(url, origin):
        if url.startswith(('http://', 'https://', 'data:', '#')):
            return
        # Absolute URLs in index.html are rewritten to the base path; strip it so
        # what remains is dist-relative. Relative URLs are already dist-relative.
        path = url[len(args.base):] if url.startswith(args.base) else url.lstrip('/')
        path = path.split('?')[0].split('#')[0]
        if not path:
            return
        referenced.setdefault(path, []).append(origin)
        if not os.path.exists(os.path.join(args.dist, path)):
            missing.append('%s (referenced by %s)' % (url, origin))

    # index.html: <link href> and <script src>
    for match in re.finditer(r'(?:href|src)="([^"]+)"', html):
        check(match.group(1), 'index.html')

    # manifest icons
    for icon in manifest.get('icons', []):
        check(icon['src'], 'manifest')

    # service worker: paths built from registration.scope
    for match in re.finditer(r"registration\.scope \+ '([^']+)'", service_worker):
        check(match.group(1), 'sw.js')

    # Anything shipped in dist/icons, dist/splash that nothing references.
    orphans = []
    for folder in ('icons', 'splash'):
        full = os.path.join(args.dist, folder)
        if not os.path.isdir(full):
            continue
        for name in sorted(os.listdir(full)):
            rel = '%s/%s' % (folder, name)
            if rel not in referenced:
                orphans.append(rel)

    print('base path:      %s' % args.base)
    print('references:     %d' % len(referenced))
    print('manifest:       %s / display=%s' % (manifest.get('name'), manifest.get('display')))

    if missing:
        print('\nMISSING (%d):' % len(missing))
        for item in missing:
            print('  ' + item)
    else:
        print('\nall referenced assets exist')

    if orphans:
        print('\nORPHANED (shipped but never referenced) (%d):' % len(orphans))
        for item in orphans:
            print('  ' + item)

    # A service worker that never displays a notification silently produces no
    # alerts at all, so this is worth asserting rather than assuming.
    if 'showNotification' not in service_worker:
        print('\nWARNING: sw.js never calls showNotification - pushes will not display.')

    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
