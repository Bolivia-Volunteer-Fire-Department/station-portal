// The markdown look, in one place, because TWO consumers render markdown: components/Markdown.jsx (what a member
// reads) and the rich editor (what an author writes). Same tables, so a heading that looks one way while writing
// looks that way when read - which is the whole point of a WYSIWYG editor, and the failure mode this prevents.
//
// There is no icon here: which icon a callout wears is React's business, and it lives with the component that
// draws it. Everything that decides how something LOOKS is here.
export const HEADING_CLASSES = {
  1: 'text-lg font-bold text-slate-900 dark:text-white',
  2: 'text-base font-semibold text-slate-900 dark:text-white',
  3: 'text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300',
};

export const headingClass = (level) => HEADING_CLASSES[level] || HEADING_CLASSES[3];

// The five callouts, styled like GitHub's: a colored left rule, the type's name, and a color nobody has to be
// able to see - the label is the signal, not the hue.
export const CALLOUT_CLASSES = {
  note: {
    label: 'Note',
    box: 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50',
    head: 'text-slate-600 dark:text-slate-300',
  },
  tip: {
    label: 'Tip',
    box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40',
    head: 'text-emerald-700 dark:text-emerald-400',
  },
  important: {
    label: 'Important',
    box: 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40',
    head: 'text-violet-700 dark:text-violet-400',
  },
  warning: {
    label: 'Warning',
    box: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40',
    head: 'text-amber-700 dark:text-amber-400',
  },
  caution: {
    label: 'Caution',
    box: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40',
    head: 'text-red-700 dark:text-red-400',
  },
};

// Inline runs. `highlight` is the one colored mark COLOR_MARKS defines; the key is its tone.
export const INLINE_CLASSES = {
  code: 'rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]',
  link: 'text-red-600 dark:text-red-400 underline underline-offset-2',
  highlight: 'rounded bg-amber-200/80 dark:bg-amber-300/25 px-0.5',
};

// Blocks. `bullets` and `numbers` are the list-style classes; `list` is what both share.
export const BLOCK_CLASSES = {
  body: 'space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200',
  code: 'overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 text-[11px] leading-relaxed',
  list: 'pl-5 space-y-1',
  bullets: 'list-disc',
  numbers: 'list-decimal',
  quote: 'border-l-4 border-slate-300 dark:border-slate-600 pl-3 text-slate-500 dark:text-slate-400 italic',
  rule: 'border-slate-200 dark:border-slate-700',
  calloutBox: 'rounded-xl border border-l-4 px-3 py-2',
  calloutHead: 'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide',
  calloutBody: 'mt-1.5 space-y-2',
  tableWrap: 'overflow-x-auto',
  table: 'w-full border-collapse text-left text-xs',
  tableHeadRow: 'border-b border-slate-300 dark:border-slate-600',
  tableHeadCell: 'py-1.5 pr-3 font-semibold',
  tableRow: 'border-b border-slate-100 dark:border-slate-800',
  tableCell: 'py-1.5 pr-3 align-top',
};

// The editor surface is the READER'S OWN BODY, plus the chrome an editing surface needs and a reader does not.
//
// THAT COMPOSITION IS THE FIX FOR A REPORTED BUG: "the rendered spacing in Write mode does not match what members see".
// It did not, because the surface carried no typography of its own beyond a text colour and its own padding - so
// paragraphs sat one against the next with NO gap where the reader has `space-y-3`, the text was the browser's default
// size instead of `text-sm`, and the leading was the default rather than `leading-relaxed`. A heading in the editor
// looked like a slightly bolder line than a paragraph rather than a new section, which is exactly the difference an
// author is trying to judge when they press Save.
//
// Starting from `BLOCK_CLASSES.body` rather than restating it is what stops this drifting again: the spacing between
// blocks, the size of the type and the colour it is drawn in are now the SAME DECLARATION the reader uses, so there is
// no second list to fall behind. The `text-*` and `leading-*` on the children (a heading's size, a table cell's) still
// win where they are set, exactly as they do on the reading side.
//
// The chrome stays: a minimum height so an empty document is still a place to click, the border and rounding, and the
// focus ring that says the surface has the caret.
export const EDITOR_CHROME_CLASSES =
  'min-h-[16rem] w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-500';

export const EDITOR_SURFACE_CLASSES = `${EDITOR_CHROME_CLASSES} ${BLOCK_CLASSES.body}`;
