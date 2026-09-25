// Help guides, loaded from markdown files in this repository.
//
// Two separate folders, because the audience differs:
//
//   src/content/help/member/*.md   the member Help module (open to everyone)
//   src/content/help/admin/*.md    Administration → System → Help
//
// The files are bundled at build time (import.meta.glob with ?raw), so a guide works offline,
// needs no fetch, no index file and no base-path handling on GitHub Pages. Adding a guide is
// adding a file - nothing else to register. A numeric filename prefix controls the order
// (01-, 02-), and the first `# heading` becomes the title.

import { markdownTitle } from './markdown';

const MEMBER_GUIDES = import.meta.glob('../content/help/member/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ADMIN_GUIDES = import.meta.glob('../content/help/admin/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// "01-getting-started.md" -> "Getting started", for a guide whose file has no `# heading`.
const titleFromPath = (path) => {
  const name = String(path)
    .split('/')
    .pop()
    .replace(/\.md$/i, '')
    .replace(/^\d+[-_]+/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Untitled guide';
};

const toGuides = (sources) =>
  Object.keys(sources)
    .sort()
    .map((path) => ({
      path,
      slug: String(path).split('/').pop().replace(/\.md$/i, ''),
      title: markdownTitle(sources[path]) || titleFromPath(path),
      markdown: sources[path],
    }));

export const HELP_SCOPES = ['member', 'admin'];

// The guides for one audience. An unknown scope falls back to the member set, so a typo shows
// the wrong-but-harmless list rather than an empty screen.
export const helpGuides = (scope) => toGuides(scope === 'admin' ? ADMIN_GUIDES : MEMBER_GUIDES);

// Where a guide file lives, for the empty state (which is the only time anyone needs to know).
export const helpFolderFor = (scope) => `src/content/help/${scope === 'admin' ? 'admin' : 'member'}/`;

// Whether a guide has any content to render. A file that exists but is empty is still listed -
// the guide is where you expect it, rather than vanishing - and the screen explains that
// instead of showing a blank pane. Exported so that rule is testable without needing a real
// empty file to exist in the repository.
export const hasGuideContent = (guide) => String(guide?.markdown ?? '').trim() !== '';
