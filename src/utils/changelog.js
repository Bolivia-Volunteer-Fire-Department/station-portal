import changelogMarkdown from '../content/changelog.md?raw';

/**
 * Classifies a changelog bullet item into a visual badge category.
 */
function classifyChangelogItem(text) {
  const lower = String(text || '').toLowerCase();
  if (
    lower.includes('security') ||
    lower.includes('password') ||
    lower.includes('permission') ||
    lower.includes('demote') ||
    lower.includes('bypass') ||
    lower.includes('auth')
  ) {
    return { tag: 'Security & Access', tone: 'amber' };
  }
  if (
    lower.startsWith('fixed') ||
    lower.includes('fixed a bug') ||
    lower.includes('fixed an issue') ||
    lower.includes('resolved')
  ) {
    return { tag: 'Fix', tone: 'emerald' };
  }
  if (
    lower.includes('firestore') ||
    lower.includes('faster') ||
    lower.includes('cache-first') ||
    lower.includes('lazy loading') ||
    lower.includes('optimization') ||
    lower.includes('efficiencies') ||
    lower.includes('speed')
  ) {
    return { tag: 'Performance', tone: 'sky' };
  }
  if (
    lower.startsWith('added') ||
    lower.includes('migrated') ||
    lower.includes('rebranded') ||
    lower.includes('initial production release') ||
    lower.includes('introduced')
  ) {
    return { tag: 'Feature', tone: 'red' };
  }
  return { tag: 'Improvement', tone: 'slate' };
}

/**
 * Parses `src/content/changelog.md` into structured version sections.
 */
export function parseChangelog(markdown = changelogMarkdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const releases = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const versionMatch = /^###\s+(.+)$/.exec(line);
    if (versionMatch) {
      const heading = versionMatch[1].trim();
      const code = heading.replace(/^version\s+/i, '').trim();
      current = {
        id: `v-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        version: code,
        heading,
        items: [],
      };
      releases.push(current);
      continue;
    }

    if (current && /^[-*+]\s+/.test(line)) {
      const text = line.replace(/^[-*+]\s+/, '').trim();
      if (text) {
        const { tag, tone } = classifyChangelogItem(text);
        current.items.push({
          text,
          tag,
          tone,
        });
      }
    }
  }

  return releases;
}

export { changelogMarkdown };

