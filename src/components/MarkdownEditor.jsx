import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Code2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pencil,
  Pilcrow,
  Rows3,
  Columns3,
  SquareCode,
  Table as TableIcon,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
  TextQuote,
} from 'lucide-react';
import Markdown from './Markdown';
import { DOCUMENT_CONTENT_LIMIT, documentCharactersLeft } from '../utils/documents';
import { EDITOR_SURFACE_CLASSES } from '../utils/markdownStyles';
import {
  BLOCK_ACTIONS,
  CALLOUT_ACTIONS,
  INLINE_ACTIONS,
  INSERT_ACTIONS,
  TABLE_ACTIONS,
  applyBlockCommand,
  applyTextCommand,
  blocksFromHtml,
  blocksToMarkdown,
  editorBlocksFromMarkdown,
  htmlFromBlocks,
  wrapLinkText,
} from '../utils/richMarkdown';

// The document editor: a formatting toolbar over a WYSIWYG surface, with the raw markdown one click away.
//
// WHY NOT A RICH-TEXT LIBRARY. The storage format is markdown, and every WYSIWYG library brings its own dialect and
// its own preview - so what an author saw while writing would not be what a member reads, and the difference would
// surface in the worst possible place, a procedure. Here the preview IS components/Markdown.jsx, and the editing
// surface renders with the SAME parser and the SAME style tables (utils/richMarkdown, utils/markdownStyles).
//
// WHAT IS WHERE. Everything that decides meaning lives in utils/richMarkdown: markdown to blocks, blocks to editable
// HTML, the reverse, and every command - all pure, all covered by scripts/verify-rich-markdown. This file is the
// thin part no test here can reach: a contenteditable div, a debounce, and a toolbar.
//
// THREE MODES. Write is the default, and the one most authors should never leave: select text, press a button, as in
// a word processor. Markdown shows the same document as text, for what a toolbar cannot express - pasting from
// elsewhere, or repairing a table by hand. Preview is the reader's own renderer, so the last thing before saving is
// the member's view.
const EDITOR_MODES = ['write', 'markdown', 'preview'];

// The toolbar's icon names as components. utils/richMarkdown names them so it can stay free of React, and the
// verifier asserts every name it declares has a component here.
const ICONS = {
  Bold,
  Italic,
  Highlighter,
  Code,
  Link: LinkIcon,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  TextQuote,
  SquareCode,
  Table: TableIcon,
  Minus,
  // The table row's five. `Rows3` and `Columns3` say "a grid" beside the split icons that add to one; `Trash2` is the
  // remove, as it is on every other row in the app.
  TableRowAdd: Rows3,
  TableColumnAdd: Columns3,
  TableRowRemove: TableRowsSplit,
  TableColumnRemove: TableColumnsSplit,
  TableRemove: Trash2,
};

// How long after the last keystroke the surface becomes markdown. Short enough for the character count to feel
// live, long enough that a sentence is not one document conversion per character.
const COMMIT_DELAY_MS = 180;

const MODE_LABELS = { write: 'Write', markdown: 'Markdown', preview: 'Preview' };

// The HTML for a document, put on the surface. A plain function rather than a memoized callback: there is nothing to
// memoize, and a `useCallback` here reads itself while the component initializes (React Compiler flags exactly that).
const applySurfaceHtml = (element, markdown) => {
  if (!element) return;
  element.innerHTML = htmlFromBlocks(editorBlocksFromMarkdown(markdown));
};

export default function MarkdownEditor({
  value = '',
  onChange,
  label = 'Content',
  id = 'document-content',
  rows = 16,
}) {
  const [mode, setMode] = useState('write');
  const [draft, setDraft] = useState(() => String(value ?? ''));
  const [linkDraft, setLinkDraft] = useState(null);
  const [showCallouts, setShowCallouts] = useState(false);
  // The callout menu's own element, so a click inside it can be told from a click outside. See the outside-click effect.
  const calloutRef = useRef(null);
  const [activeBlock, setActiveBlock] = useState('paragraph');
  const [activeInline, setActiveInline] = useState([]);

  const surfaceRef = useRef(null);
  const textareaRef = useRef(null);
  const commitTimer = useRef(null);
  // The markdown the surface was last rendered FROM. An edit is only sent up when the conversion actually changed
  // something, which is what stops re-reading the surface after a toolbar press from looping forever.
  const renderedMarkdown = useRef(String(value ?? ''));

  const asText = String(value ?? '');
  const left = documentCharactersLeft(draft);
  const overLimit = left < 0;


  // An external change - a different document opened, or a reload after a save - replaces the surface. An edit that
  // came FROM the surface is not one of these: the parent stores exactly what this component emitted, so the value
  // arriving back is the one already on screen, and the caret is left where it is.
  useEffect(() => {
    if (asText === renderedMarkdown.current) return;
    renderedMarkdown.current = asText;
    setDraft(asText);
    if (surfaceRef.current) {
      surfaceRef.current.innerHTML = htmlFromBlocks(editorBlocksFromMarkdown(asText));
    }
  }, [asText]);

  // The surface is rebuilt when Write is shown, so returning from another mode shows the current document.
  useEffect(() => {
    if (mode === 'write') applySurfaceHtml(surfaceRef.current, renderedMarkdown.current);
  }, [mode]);

  const commitSurface = useCallback(() => {
    if (!surfaceRef.current) return;
    const markdown = blocksToMarkdown(blocksFromHtml(surfaceRef.current.innerHTML));
    if (markdown === renderedMarkdown.current) return;
    renderedMarkdown.current = markdown;
    setDraft(markdown);
    onChange?.(markdown);
  }, [onChange]);

  const scheduleCommit = useCallback(() => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commitSurface, COMMIT_DELAY_MS);
  }, [commitSurface]);

  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    []
  );

  // Pasting brings whatever markup its source had. Only the text is kept: a pasted paragraph should not deliver a
  // font, a size and a link nobody asked for, and nothing from another page belongs in a procedure.
  const handlePaste = useCallback((event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    // insertText is deprecated, and is still the only way to paste that leaves the browser's undo history intact.
    if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  }, []);

  // Which block and which inline marks the caret is in, so the toolbar shows what is already applied rather than
  // offering to apply it twice. Read from the DOM, because the DOM is where the caret is.
  const refreshActiveFormats = useCallback(() => {
    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    if (!anchor || !surface.contains(anchor)) return;

    const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    const block = element?.closest('[data-block]');
    setActiveBlock(block ? block.getAttribute('data-block') : 'paragraph');

    const marks = [];
    let node = element;
    while (node && node !== surface) {
      if (node.tagName === 'STRONG' || node.tagName === 'B') marks.push('bold');
      if (node.tagName === 'EM' || node.tagName === 'I') marks.push('italic');
      if (node.tagName === 'MARK') marks.push('highlight');
      if (node.tagName === 'CODE') marks.push('code');
      if (node.tagName === 'A') marks.push('link');
      node = node.parentElement;
    }
    setActiveInline(marks);
  }, []);

  useEffect(() => {
    if (mode !== 'write' || typeof document === 'undefined') return undefined;
    const handler = () => refreshActiveFormats();
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [mode, refreshActiveFormats]);

  // A MENU THAT ONLY ITS OWN BUTTON CAN CLOSE IS A MENU PEOPLE CLICK TWICE. The callout list had exactly that problem in
  // Markdown mode (see `runAction`, which fixed the choosing half); this is the other half - clicking anywhere else, or
  // pressing Escape, dismisses it the way every other menu in the app does.
  //
  // `mousedown` rather than `click`, so the dismissal lands BEFORE whatever was clicked does its work: a click outside
  // should put the menu away and then do what it was aimed at, rather than being swallowed by the close. Clicks INSIDE
  // are left alone entirely, which is what lets a callout be chosen at all.
  useEffect(() => {
    if (!showCallouts || typeof document === 'undefined') return undefined;
    const close = (event) => {
      if (calloutRef.current && calloutRef.current.contains(event.target)) return;
      setShowCallouts(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setShowCallouts(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showCallouts]);

  // The element the caret's line belongs to, and the index the model knows its block by. A list item reports its
  // LIST, because the whole list converts together - which is what pressing the bullet button inside one line of it
  // should do.
  const currentBlockElement = () => {
    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0) return null;
    const anchor = selection.anchorNode;
    if (!anchor || !surface.contains(anchor)) return null;
    const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    return element?.closest('li')?.closest('[data-block]') ?? element?.closest('[data-block]') ?? null;
  };

  // Puts the caret at the end of a block, after the surface has been re-rendered from the model.
  const placeCaretInBlock = (index, cell = null) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const block = surface.querySelector(`[data-block][data-index="${index}"]`);
    if (!block) return;
    // A TABLE LANDS IN THE CELL THE EDIT WAS ABOUT, not at the end of the grid. Adding a row and being put at the bottom
    // of the last cell is the small annoyance that makes a table feel unusable; landing in the new row is what makes the
    // button worth pressing. `cell` is where the author was, or '' for "wherever the block starts".
    const wanted = cell ? block.querySelector(`tr:nth-child(${cell.row + 1}) > *:nth-child(${cell.column + 1})`) : null;
    const target = wanted || (block.matches('ul, ol') ? block.querySelector('li') || block : block);
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    surface.focus({ preventScroll: true });
  };

  // WHERE THE CARET IS INSIDE A TABLE, as the rendered position the table commands take: `row` counts from the header
  // (0), `column` from the left. Null when the caret is not in one, which is what hides the table toolbar.
  //
  // Read from the DOM rather than from the model, like every other "where is the caret" question here: the DOM is where
  // the caret actually is, and the model is rebuilt from it anyway.
  const tableCellAt = () => {
    const element = currentBlockElement();
    if (!element || element.getAttribute('data-block') !== 'table') return null;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    const anchor = selection?.anchorNode;
    if (!anchor) return null;
    const node = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    const cellElement = node?.closest('th, td');
    const rowElement = cellElement?.closest('tr');
    const table = cellElement?.closest('table');
    if (!cellElement || !rowElement || !table) return null;
    return {
      row: [...table.querySelectorAll('tr')].indexOf(rowElement),
      column: [...rowElement.children].indexOf(cellElement),
    };
  };

  // Wraps the selection in a tag, or takes the tag off when the selection is already inside one. One function for
  // both directions because that is what one button does: the same press that turns bold on turns it off.
  const toggleInlineTag = (tagName) => {
    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0 || !surface.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);

    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const existing = element?.closest(tagName);
    if (existing && surface.contains(existing)) {
      // Unwrapping: the tag goes, its text stays exactly where it was.
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
      return;
    }

    const wrapper = document.createElement(tagName);
    if (range.collapsed) {
      // Nothing selected: an empty run holding a zero-width space, selected, so the next keystroke lands inside the
      // formatting instead of beside it.
      wrapper.appendChild(document.createTextNode('\u200b'));
      range.insertNode(wrapper);
      const inner = document.createRange();
      inner.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(inner);
      return;
    }

    wrapper.appendChild(range.extractContents());
    range.insertNode(wrapper);
    const after = document.createRange();
    after.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(after);
  };

  // A block or insert command: the MODEL changes and the surface is re-rendered from it, so what ends up on screen
  // is the markdown that will be stored rather than whatever the browser decided a heading should look like.
  const runBlockCommand = (action) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const element = currentBlockElement();
    const blocks = blocksFromHtml(surface.innerHTML);
    const index = element ? Number(element.getAttribute('data-index')) : blocks.length - 1;
    // Where in the table the caret is, BEFORE the surface is rebuilt - the position is a fact about the DOM as it stands,
    // and the rebuilt surface no longer has the caret in it. Only a table action uses it.
    const cell = action.mode === 'table' ? tableCellAt() : null;
    const result = applyBlockCommand(blocks, Number.isFinite(index) ? index : 0, { ...action, cell });

    surface.innerHTML = htmlFromBlocks(result.blocks);
    const markdown = blocksToMarkdown(result.blocks);
    renderedMarkdown.current = markdown;
    setDraft(markdown);
    onChange?.(markdown);
    // After an ADD, the caret goes where the author is looking: the new row, or the new column of the cell they were in.
    // A delete keeps them where they were, which is the cell beside the gap that closed - and deleting the whole table
    // has no cell to aim at, so it falls back to the block.
    const caret =
      cell && action.id !== 'tableRemove'
        ? {
            row: action.id === 'tableAddRow' ? cell.row + 1 : cell.row,
            column: action.id === 'tableAddColumn' ? cell.column + 1 : cell.column,
          }
        : null;
    placeCaretInBlock(result.index, caret);
    refreshActiveFormats();
  };

  // An inline command applies to the SELECTION: a wrap is a text operation, and the browser already knows exactly
  // which characters are selected. Reading the surface back afterwards is what turns it into markdown.
  const runInlineCommand = (action) => {
    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0 || !surface.contains(selection.anchorNode)) return;

    if (action.id === 'link') {
      setLinkDraft({ label: selection.toString(), inSurface: true });
      return;
    }

    const tag = { bold: 'STRONG', italic: 'EM', highlight: 'MARK', code: 'CODE' }[action.id];
    if (!tag) return;
    toggleInlineTag(tag);
    scheduleCommit();
    refreshActiveFormats();
  };


  // The link form's answer, applied where the request came from: a selection in the rich surface, or a selection in
  // the markdown textarea.
  const applyLink = () => {
    const url = String(linkDraft?.url || '').trim();
    if (!url) {
      setLinkDraft(null);
      return;
    }

    if (linkDraft?.inSurface) {
      const surface = surfaceRef.current;
      const selection = window.getSelection();
      if (surface && selection && selection.rangeCount > 0 && surface.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        const anchor = document.createElement('A');
        anchor.setAttribute('href', url);
        if (range.collapsed) anchor.appendChild(document.createTextNode(linkDraft?.label || url));
        else anchor.appendChild(range.extractContents());
        range.insertNode(anchor);
        scheduleCommit();
      }
      setLinkDraft(null);
      return;
    }

    const result = wrapLinkText(draft, url, linkDraft?.start ?? 0, linkDraft?.end ?? 0);
    setDraft(result.text);
    onChange?.(result.text);
    setLinkDraft(null);
  };

  // The raw-markdown surface's toolbar: the same buttons, acting on the textarea's selection. Inline marks are a
  // pure text transform, so this path needs none of the DOM work above.
  const runTextCommand = (action) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const result = applyTextCommand(draft, action, start, end);

    if (result.needsUrl) {
      setLinkDraft({ label: draft.slice(start, end), start, end });
      return;
    }

    setDraft(result.text);
    onChange?.(result.text);
    requestAnimationFrame(() => {
      // preventScroll IS THE FIX FOR A REPORTED BUG, and it is not a nicety: clicking a toolbar button took focus off the
      // textarea, and calling `focus()` again made the browser scroll the nearest scrollable ancestor to reveal the
      // element it was focusing. The textarea is taller than the editor's modal frame, so "reveal it" means scrolling the
      // frame to the BOTTOM of the document - the author pressed Bold and the view jumped to the end of the page. Only
      // focusing is asked not to scroll: `setSelectionRange` below still scrolls the textarea's own contents to the
      // caret, which is what should happen and is not the thing that was moving the page.
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  // One entry point for every toolbar button, so the menu closes whatever was pressed. It used to close only in the
  // block path, which meant that in Markdown mode - where every button goes through the text path instead - choosing a
  // callout left the menu open over the document and the author had to click the button again to dismiss it.
  //
  // The link prompt is deliberately NOT touched here: the link action OPENS it and returns, so clearing it at this level
  // would close the prompt in the same breath as opening it.
  const runAction = (action) => {
    if (mode === 'markdown') runTextCommand(action);
    else if (action.mode === 'inline') runInlineCommand(action);
    else runBlockCommand(action);
    setShowCallouts(false);
  };

  // Which button is lit. Only meaningful in Write mode: in Markdown mode the caret is in a textarea and there is no
  // element to read the formatting from.
  const isActive = (action) => {
    if (mode !== 'write') return false;
    if (action.mode === 'inline') return activeInline.includes(action.id);
    if (action.id === 'bullet') return activeBlock === 'list';
    if (action.id === 'numbered') return activeBlock === 'list';
    if (action.id === 'quote') return activeBlock === 'quote';
    if (action.id === 'codeBlock') return activeBlock === 'code';
    if (action.id === 'callout') return activeBlock === 'callout';
    if (action.id === 'heading') return activeBlock === 'heading';
    if (action.id === 'paragraph') return activeBlock === 'paragraph';
    return false;
  };

  const toolbarButtonClass = (active) =>
    `flex h-8 w-8 items-center justify-center rounded-lg transition ${
      active ? 'bg-red-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
    }`;


  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-slate-600 dark:text-slate-300">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs tabular-nums ${
              overLimit ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {overLimit
              ? `${Math.abs(left).toLocaleString('en-US')} characters over the limit`
              : `${draft.length.toLocaleString('en-US')} of ${DOCUMENT_CONTENT_LIMIT.toLocaleString('en-US')}`}
          </span>
          {/* Write is the default, and the mode an author should not have to leave. Markdown is the same document as
              text, for what a toolbar cannot express; Preview is the member's own renderer. */}
          <div className="flex rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden">
            {EDITOR_MODES.map((modeId) => {
              const Icon = modeId === 'preview' ? Eye : modeId === 'markdown' ? Code2 : Pencil;
              const active = mode === modeId;
              return (
                <button
                  key={modeId}
                  type="button"
                  onClick={() => setMode(modeId)}
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {MODE_LABELS[modeId]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {mode !== 'preview' && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5">
          {INLINE_ACTIONS.map((action) => (
            <ToolbarButton
              key={action.id}
              action={action}
              active={isActive(action)}
              onClick={() => runAction(action)}
              className={toolbarButtonClass(isActive(action))}
            />
          ))}

          <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

          {BLOCK_ACTIONS.map((action) => (
            <ToolbarButton
              key={`${action.id}-${action.level ?? action.ordered ?? ''}`}
              action={action}
              active={isActive(action)}
              onClick={() => runAction(action)}
              className={toolbarButtonClass(isActive(action))}
            />
          ))}

          {/* The five callouts are one action with five answers, so they are a menu rather than five buttons. */}
          <div className="relative" ref={calloutRef}>
            <button
              type="button"
              onClick={() => setShowCallouts((open) => !open)}
              aria-expanded={showCallouts}
              aria-haspopup="true"
              title="Callout"
              aria-label="Callout"
              className={`${toolbarButtonClass(isActive({ id: 'callout' }))} w-auto px-2`}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            {showCallouts && (
              <div className="absolute left-0 top-9 z-20 w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-1 origin-top-left animate-popoverIn">
                {CALLOUT_ACTIONS.map((action) => (
                  <button
                    key={action.callout}
                    type="button"
                    onClick={() => runAction(action)}
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {action.callout.charAt(0).toUpperCase() + action.callout.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

          {INSERT_ACTIONS.map((action) => (
            <ToolbarButton
              key={action.id}
              action={action}
              active={false}
              onClick={() => runAction(action)}
              className={toolbarButtonClass(false)}
            />
          ))}
        </div>
      )}

      {/* THE TABLE'S OWN TOOLBAR, shown only while the caret is inside a table. It is a second row rather than five more
          buttons in the one above, because these mean nothing anywhere else: "Add column" beside "Bold" would be a
          button that does nothing for most of a document's life, and the toolbar is already long. The row appears when
          there is something for it to act on and disappears when there is not, so it reads as a property of the table
          rather than as part of the toolbar. */}
      {mode === 'write' && activeBlock === 'table' && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 bg-slate-50 p-1.5 dark:border-slate-700 dark:bg-slate-900">
          <span className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">Table</span>
          {TABLE_ACTIONS.map((action) => (
            <ToolbarButton
              key={action.id}
              action={action}
              active={false}
              onClick={() => runAction(action)}
              className={toolbarButtonClass(false)}
            />
          ))}
        </div>
      )}

      {linkDraft && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2">
          <LinkIcon className="w-4 h-4 text-slate-400" />
          <input
            type="url"
            autoFocus
            value={linkDraft.url || ''}
            onChange={(event) => setLinkDraft((current) => ({ ...current, url: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') setLinkDraft(null);
            }}
            placeholder="https://example.com"
            aria-label="Link address"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            type="button"
            onClick={applyLink}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
          >
            <Check className="w-3.5 h-3.5" />
            Add link
          </button>
          <button
            type="button"
            onClick={() => setLinkDraft(null)}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {mode === 'preview' && (
        // The reader's own renderer, so the last thing an author checks before saving is exactly what a member gets.
        <div className="min-h-[12rem] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
          {draft.trim() ? (
            <Markdown markdown={draft} />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to preview yet.</p>
          )}
        </div>
      )}

      {mode === 'markdown' && (
        <textarea
          id={id}
          ref={textareaRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange?.(event.target.value);
          }}
          rows={rows}
          spellCheck="true"
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 font-mono text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      )}

      {mode === 'write' && (
        // The editing surface. Its content is generated (never dangerouslySetInnerHTML from stored text: every piece
        // of it is escaped by utils/richMarkdown), and every edit is converted back to markdown after a pause.
        <div
          id={id}
          ref={surfaceRef}
          role="textbox"
          aria-multiline="true"
          aria-label={`${label}, rich text`}
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          onInput={scheduleCommit}
          onBlur={commitSurface}
          onPaste={handlePaste}
          onKeyUp={refreshActiveFormats}
          onMouseUp={refreshActiveFormats}
          className={EDITOR_SURFACE_CLASSES}
        />
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Select text and use the toolbar, as in a word processor — the buttons show what is already applied, and
        pressing one twice takes it off. Bold, italic, highlights, headings, lists, quotes, callouts, code, tables and
        dividers all render here exactly as they will for a member, spacing included. Put the cursor in a table and a
        second row of buttons appears for adding and removing rows and columns.{' '}
        <strong>Markdown</strong> shows the same document as plain text if you need to paste from elsewhere.
      </p>
    </div>
  );
}

// One toolbar button. Extracted so the three groups cannot drift apart in look or in accessibility: every button
// carries its own label, so a toolbar of icons is still usable by somebody who cannot see them.
function ToolbarButton({ action, active, onClick, className }) {
  const Icon = ICONS[action.icon];
  return (
    <button
      type="button"
      onClick={onClick}
      title={action.label}
      aria-label={action.label}
      aria-pressed={active}
      className={className}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}


