import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Code,
  Code2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  HelpCircle,
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
  Strikethrough,
  Table as TableIcon,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
  TextQuote,
  Underline,
  X,
} from 'lucide-react';
import Markdown from './Markdown';
import { DOCUMENT_CONTENT_LIMIT, documentCharactersLeft } from '../utils/documents';
import { EDITOR_SURFACE_CLASSES, bgColorClass, textColorClass } from '../utils/markdownStyles';
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
  Underline,
  Strikethrough,
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

const TEXT_COLOR_OPTIONS = [
  { id: 'default', label: 'Default', dotClass: 'bg-slate-700 dark:bg-slate-300' },
  { id: 'red', label: 'Red', dotClass: 'bg-red-600' },
  { id: 'amber', label: 'Amber / Orange', dotClass: 'bg-amber-600' },
  { id: 'green', label: 'Green', dotClass: 'bg-emerald-600' },
  { id: 'blue', label: 'Blue', dotClass: 'bg-blue-600' },
  { id: 'purple', label: 'Purple', dotClass: 'bg-purple-600' },
  { id: 'slate', label: 'Slate Gray', dotClass: 'bg-slate-500' },
];

const BG_COLOR_OPTIONS = [
  { id: 'none', label: 'Clear highlight', dotClass: 'border border-slate-300 dark:border-slate-600 bg-transparent' },
  { id: 'yellow', label: 'Yellow (Standard)', dotClass: 'bg-amber-300' },
  { id: 'red', label: 'Red', dotClass: 'bg-red-300' },
  { id: 'green', label: 'Green', dotClass: 'bg-emerald-300' },
  { id: 'blue', label: 'Blue', dotClass: 'bg-blue-300' },
  { id: 'purple', label: 'Purple', dotClass: 'bg-purple-300' },
  { id: 'slate', label: 'Gray', dotClass: 'bg-slate-300' },
];

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
  const [showTextColorMenu, setShowTextColorMenu] = useState(false);
  const [showBgColorMenu, setShowBgColorMenu] = useState(false);
  const [showReference, setShowReference] = useState(false);
  // The callout menu's own element, so a click inside it can be told from a click outside. See the outside-click effect.
  const calloutRef = useRef(null);
  const textColorRef = useRef(null);
  const bgColorRef = useRef(null);
  const [activeBlock, setActiveBlock] = useState('paragraph');
  const [activeBlockMeta, setActiveBlockMeta] = useState({ level: null, ordered: false });
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
    const blockType = block ? block.getAttribute('data-block') : 'paragraph';
    setActiveBlock(blockType);

    const level = block?.getAttribute('data-level') ? Number(block.getAttribute('data-level')) : null;
    const isOrdered = block ? (block.tagName === 'OL' || Boolean(block.closest('ol'))) : false;
    setActiveBlockMeta({ level, ordered: isOrdered });

    const marks = [];
    let node = element;
    while (node && node !== surface) {
      if (node.tagName === 'STRONG' || node.tagName === 'B') marks.push('bold');
      if (node.tagName === 'EM' || node.tagName === 'I') marks.push('italic');
      if (node.tagName === 'U') marks.push('underline');
      if (node.tagName === 'DEL' || node.tagName === 'S' || node.tagName === 'STRIKE') marks.push('strikethrough');
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

  // Close menus when clicking outside or pressing Escape
  useEffect(() => {
    if (!showCallouts && !showTextColorMenu && !showBgColorMenu) return undefined;
    const close = (event) => {
      if (calloutRef.current && calloutRef.current.contains(event.target)) return;
      if (textColorRef.current && textColorRef.current.contains(event.target)) return;
      if (bgColorRef.current && bgColorRef.current.contains(event.target)) return;
      setShowCallouts(false);
      setShowTextColorMenu(false);
      setShowBgColorMenu(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowCallouts(false);
        setShowTextColorMenu(false);
        setShowBgColorMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showCallouts, showTextColorMenu, showBgColorMenu]);

  // Resolves the block range selected by the author.
  // Handles collapsed carets at the end of a line and multi-block selections across the document.
  const getSelectedBlockRange = () => {
    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);

    const elements = Array.from(surface.children);
    if (elements.length === 0) return null;

    const getElementForNode = (node, offset, isEnd) => {
      if (!node || !surface.contains(node)) return null;
      if (node === surface) {
        let target = isEnd && offset > 0 ? surface.childNodes[offset - 1] : surface.childNodes[offset];
        if (!target) {
          return isEnd ? elements[elements.length - 1] : elements[0];
        }
        if (target.nodeType !== 1) {
          target = isEnd ? target.previousElementSibling : target.nextElementSibling;
        }
        return target && target.parentElement === surface ? target : null;
      }
      let curr = node.nodeType === 1 ? node : node.parentElement;
      while (curr && curr.parentElement && curr.parentElement !== surface) {
        curr = curr.parentElement;
      }
      return curr && curr.parentElement === surface ? curr : null;
    };

    if (range.collapsed) {
      let target = null;
      if (range.startContainer === surface) {
        if (range.startOffset > 0) {
          let prev = surface.childNodes[range.startOffset - 1];
          if (prev && prev.nodeType !== 1) prev = prev.previousElementSibling;
          target = prev;
        } else {
          let next = surface.childNodes[0];
          if (next && next.nodeType !== 1) next = next.nextElementSibling;
          target = next;
        }
      } else {
        target = getElementForNode(range.startContainer, range.startOffset, false);
      }
      if (!target) target = elements[0];
      const idx = elements.indexOf(target);
      const validIdx = idx !== -1 ? idx : 0;
      return {
        startBlock: target,
        endBlock: target,
        startIndex: validIdx,
        endIndex: validIdx,
      };
    }

    let startEl = getElementForNode(range.startContainer, range.startOffset, false);
    let endEl = getElementForNode(range.endContainer, range.endOffset, true);

    if (!startEl) startEl = endEl || elements[0];
    if (!endEl) endEl = startEl || elements[elements.length - 1];

    let startIdx = elements.indexOf(startEl);
    let endIdx = elements.indexOf(endEl);
    if (startIdx === -1) startIdx = 0;
    if (endIdx === -1) endIdx = startIdx;

    if (startIdx > endIdx) {
      const tmp = startIdx;
      startIdx = endIdx;
      endIdx = tmp;
      const tmpEl = startEl;
      startEl = endEl;
      endEl = tmpEl;
    }

    // Boundary bleed prevention:
    // If the selection ends at offset 0 of endEl (e.g. author dragged to end of previous block):
    if (startIdx < endIdx) {
      const isAtStart = (container, offset, topEl) => {
        if (offset !== 0) return false;
        if (container === topEl) return true;
        let curr = container;
        while (curr && curr !== topEl) {
          if (curr.previousSibling) return false;
          curr = curr.parentNode;
        }
        return curr === topEl;
      };

      if (isAtStart(range.endContainer, range.endOffset, endEl)) {
        endIdx = Math.max(startIdx, endIdx - 1);
        endEl = elements[endIdx];
      }
    }

    // If the selection starts at the very end of startEl (e.g. author clicked end of previous block):
    if (startIdx < endIdx) {
      const isAtEnd = (container, offset, topEl) => {
        if (container.nodeType === 3) {
          if (offset < container.textContent.length) return false;
        } else if (offset < container.childNodes.length) {
          return false;
        }
        let curr = container;
        while (curr && curr !== topEl) {
          if (curr.nextSibling) return false;
          curr = curr.parentNode;
        }
        return curr === topEl;
      };

      if (isAtEnd(range.startContainer, range.startOffset, startEl)) {
        startIdx = Math.min(endIdx, startIdx + 1);
        startEl = elements[startIdx];
      }
    }

    return {
      startBlock: startEl,
      endBlock: endEl,
      startIndex: startIdx,
      endIndex: endIdx,
    };
  };

  const currentBlockElement = () => {
    const range = getSelectedBlockRange();
    return range?.startBlock ?? null;
  };

  // Puts the caret at the end of a block, after the surface has been re-rendered from the model.
  const placeCaretInBlock = (index, cell = null) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const block = surface.querySelector(`[data-block][data-index="${index}"]`);
    if (!block) return;
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
    const range = getSelectedBlockRange();
    const blocks = blocksFromHtml(surface.innerHTML);
    const startIndex = range ? range.startIndex : blocks.length - 1;
    const endIndex = range ? range.endIndex : startIndex;
    const cell = action.mode === 'table' ? tableCellAt() : null;
    const result = applyBlockCommand(blocks, Number.isFinite(startIndex) ? startIndex : 0, { ...action, cell }, endIndex);

    surface.innerHTML = htmlFromBlocks(result.blocks);
    const markdown = blocksToMarkdown(result.blocks);
    renderedMarkdown.current = markdown;
    setDraft(markdown);
    onChange?.(markdown);

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

    const tag = {
      bold: 'STRONG',
      italic: 'EM',
      underline: 'U',
      strikethrough: 'DEL',
      highlight: 'MARK',
      code: 'CODE',
    }[action.id];
    if (!tag) return;
    toggleInlineTag(tag);
    scheduleCommit();
    refreshActiveFormats();
  };

  // Apply text color to selection in Write mode or Markdown mode
  const applyTextColor = (colorId) => {
    if (mode === 'markdown') {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      if (colorId === 'default' || !colorId) {
        setShowTextColorMenu(false);
        return;
      }
      const selected = draft.slice(start, end);
      const wrapped = `[color:${colorId}]${selected}[/color]`;
      const next = draft.slice(0, start) + wrapped + draft.slice(end);
      setDraft(next);
      onChange?.(next);
      setShowTextColorMenu(false);
      return;
    }

    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0 || !surface.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);

    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const existing = element?.closest('[data-color]');
    if (existing && surface.contains(existing)) {
      if (colorId === 'default' || !colorId) {
        const parent = existing.parentNode;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        parent.removeChild(existing);
        scheduleCommit();
        setShowTextColorMenu(false);
        return;
      }
      existing.setAttribute('data-color', colorId);
      existing.className = textColorClass(colorId);
      scheduleCommit();
      setShowTextColorMenu(false);
      return;
    }

    if (colorId === 'default' || !colorId) {
      setShowTextColorMenu(false);
      return;
    }

    const span = document.createElement('span');
    span.setAttribute('data-color', colorId);
    span.className = textColorClass(colorId);
    if (range.collapsed) {
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      const inner = document.createRange();
      inner.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(inner);
    } else {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      const after = document.createRange();
      after.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(after);
    }
    scheduleCommit();
    setShowTextColorMenu(false);
  };

  // Apply background / highlight color to selection
  const applyBgColor = (bgId) => {
    if (mode === 'markdown') {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      if (bgId === 'none' || !bgId) {
        setShowBgColorMenu(false);
        return;
      }
      const selected = draft.slice(start, end);
      const wrapped = bgId === 'yellow' ? `==${selected}==` : `[bg:${bgId}]${selected}[/bg]`;
      const next = draft.slice(0, start) + wrapped + draft.slice(end);
      setDraft(next);
      onChange?.(next);
      setShowBgColorMenu(false);
      return;
    }

    const surface = surfaceRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (!surface || !selection || selection.rangeCount === 0 || !surface.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0);

    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const existing = element?.closest('[data-bg]') || element?.closest('mark');
    if (existing && surface.contains(existing)) {
      if (bgId === 'none' || !bgId) {
        const parent = existing.parentNode;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        parent.removeChild(existing);
        scheduleCommit();
        setShowBgColorMenu(false);
        return;
      }
      existing.setAttribute('data-bg', bgId);
      existing.className = bgColorClass(bgId);
      scheduleCommit();
      setShowBgColorMenu(false);
      return;
    }

    if (bgId === 'none' || !bgId) {
      setShowBgColorMenu(false);
      return;
    }

    const mark = document.createElement('mark');
    mark.setAttribute('data-bg', bgId);
    mark.className = bgColorClass(bgId);
    if (range.collapsed) {
      mark.appendChild(document.createTextNode('\u200b'));
      range.insertNode(mark);
      const inner = document.createRange();
      inner.selectNodeContents(mark);
      selection.removeAllRanges();
      selection.addRange(inner);
    } else {
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
      const after = document.createRange();
      after.selectNodeContents(mark);
      selection.removeAllRanges();
      selection.addRange(after);
    }
    scheduleCommit();
    setShowBgColorMenu(false);
  };

  // Keyboard shortcuts in Write mode
  const handleKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey) {
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        runAction({ id: 'bold', mode: 'inline' });
      } else if (event.key === 'i' || event.key === 'I') {
        event.preventDefault();
        runAction({ id: 'italic', mode: 'inline' });
      } else if (event.key === 'u' || event.key === 'U') {
        event.preventDefault();
        runAction({ id: 'underline', mode: 'inline' });
      } else if ((event.key === 'x' || event.key === 'X' || event.key === 's' || event.key === 'S') && event.shiftKey) {
        event.preventDefault();
        runAction({ id: 'strikethrough', mode: 'inline' });
      } else if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        runAction({ id: 'link', mode: 'inline' });
      }
    }
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
    if (action.id === 'bullet') return activeBlock === 'list' && !activeBlockMeta.ordered;
    if (action.id === 'numbered') return activeBlock === 'list' && Boolean(activeBlockMeta.ordered);
    if (action.id === 'quote') return activeBlock === 'quote';
    if (action.id === 'codeBlock') return activeBlock === 'code';
    if (action.id === 'callout') return activeBlock === 'callout';
    if (action.id === 'heading') return activeBlock === 'heading' && activeBlockMeta.level === action.level;
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
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xs p-1.5 shadow-xs">
          {INLINE_ACTIONS.map((action) => (
            <ToolbarButton
              key={action.id}
              action={action}
              active={isActive(action)}
              onClick={() => runAction(action)}
              className={toolbarButtonClass(isActive(action))}
            />
          ))}

          {/* Text color picker */}
          <div className="relative" ref={textColorRef}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowTextColorMenu((open) => !open);
                setShowBgColorMenu(false);
                setShowCallouts(false);
              }}
              aria-expanded={showTextColorMenu}
              aria-haspopup="true"
              title="Text color"
              aria-label="Text color"
              className={`${toolbarButtonClass(false)} relative`}
            >
              <Baseline className="w-4 h-4" />
              <span className="absolute bottom-1 w-3 h-0.5 rounded-full bg-red-600" />
            </button>
            {showTextColorMenu && (
              <div className="absolute left-0 top-9 z-30 w-44 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-1.5 origin-top-left animate-popoverIn">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Text Color
                </div>
                {TEXT_COLOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyTextColor(opt.color)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                  >
                    <span className={`w-3.5 h-3.5 rounded-full ${opt.dotClass} shrink-0`} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Background / Highlight color picker */}
          <div className="relative" ref={bgColorRef}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowBgColorMenu((open) => !open);
                setShowTextColorMenu(false);
                setShowCallouts(false);
              }}
              aria-expanded={showBgColorMenu}
              aria-haspopup="true"
              title="Highlight background color"
              aria-label="Highlight background color"
              className={`${toolbarButtonClass(false)} relative`}
            >
              <Highlighter className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            </button>
            {showBgColorMenu && (
              <div className="absolute left-0 top-9 z-30 w-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-1.5 origin-top-left animate-popoverIn">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Highlight Color
                </div>
                {BG_COLOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyBgColor(opt.bg)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                  >
                    <span className={`w-3.5 h-3.5 rounded-full ${opt.dotClass} shrink-0`} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowCallouts((open) => !open);
                setShowTextColorMenu(false);
                setShowBgColorMenu(false);
              }}
              aria-expanded={showCallouts}
              aria-haspopup="true"
              title="Callout"
              aria-label="Callout"
              className={`${toolbarButtonClass(isActive({ id: 'callout' }))} w-auto px-2`}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            {showCallouts && (
              <div className="absolute left-0 top-9 z-30 w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-1 origin-top-left animate-popoverIn">
                {CALLOUT_ACTIONS.map((action) => (
                  <button
                    key={action.callout}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
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

          <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

          {/* Quick reference guide button */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowReference(true)}
            title="Markdown quick reference & cheat sheet"
            aria-label="Markdown quick reference & cheat sheet"
            className={`${toolbarButtonClass(false)} text-slate-500 hover:text-red-600 dark:hover:text-red-400`}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* THE TABLE'S OWN TOOLBAR, shown only while the caret is inside a table. It is a second row rather than five more
          buttons in the one above, because these mean nothing anywhere else: "Add column" beside "Bold" would be a
          button that does nothing for most of a document's life, and the toolbar is already long. The row appears when
          there is something for it to act on and disappears when there is not, so it reads as a property of the table
          rather than as part of the toolbar. */}
      {mode === 'write' && activeBlock === 'table' && (
        <div className="sticky top-11 z-20 flex flex-wrap items-center gap-1 rounded-xl border border-slate-300 bg-slate-50/95 p-1.5 dark:border-slate-700 dark:bg-slate-900/95 backdrop-blur-xs shadow-xs">
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
          onKeyDown={handleKeyDown}
          onKeyUp={refreshActiveFormats}
          onMouseUp={refreshActiveFormats}
          className={EDITOR_SURFACE_CLASSES}
        />
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Select text and use the toolbar, as in a word processor — the buttons show what is already applied, and
        pressing one twice takes it off. Bold, italic, underline, strikethrough, text and background colors, headings,
        lists, quotes, callouts, code, tables and dividers all render here exactly as they will for a member, spacing
        included. Put the cursor in a table and a second row of buttons appears for adding and removing rows and
        columns. <strong>Markdown</strong> shows the same document as plain text if you need to paste from elsewhere.
      </p>

      {/* Markdown Quick Reference Modal */}
      {showReference && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="markdown-ref-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn"
          onClick={() => setShowReference(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-popoverIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                <h3 id="markdown-ref-title" className="text-base font-semibold text-slate-900 dark:text-white">
                  Markdown Formatting Quick Reference
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReference(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                aria-label="Close reference guide"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm text-slate-700 dark:text-slate-200">
              {/* Text Formatting */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Text Formatting & Emphasis
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>**Bold text**</code>
                    <div className="mt-1 font-sans font-bold text-slate-900 dark:text-white">Bold text</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>*Italic text*</code> or <code>_Italic_</code>
                    <div className="mt-1 font-sans italic text-slate-800 dark:text-slate-200">Italic text</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>__Underlined text__</code>
                    <div className="mt-1 font-sans underline underline-offset-2 text-slate-800 dark:text-slate-200">
                      Underlined text
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>~~Strikethrough~~</code>
                    <div className="mt-1 font-sans line-through opacity-75 text-slate-800 dark:text-slate-200">
                      Strikethrough
                    </div>
                  </div>
                </div>
              </div>

              {/* Text & Background Colors */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Colors & Highlights
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>[color:red]Red alert[/color]</code>
                    <div className="mt-1 font-sans font-medium text-red-600 dark:text-red-400">Red alert</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>[color:green]Clear[/color]</code> or <code>amber</code>, <code>blue</code>
                    <div className="mt-1 font-sans font-medium text-emerald-600 dark:text-emerald-400">Clear status</div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>==Highlighted phrase==</code>
                    <div className="mt-1 font-sans">
                      <mark className="rounded bg-amber-200/80 dark:bg-amber-300/25 px-1">Highlighted phrase</mark>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Syntax: </span>
                    <code>[bg:red]Urgent[/bg]</code> or <code>blue</code>, <code>green</code>
                    <div className="mt-1 font-sans">
                      <mark className="rounded bg-red-100 dark:bg-red-950/60 text-red-900 dark:text-red-200 px-1">
                        Urgent note
                      </mark>
                    </div>
                  </div>
                </div>
              </div>

              {/* Headings */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Headings
                </h4>
                <div className="space-y-1.5 text-xs font-mono p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                  <div className="flex items-baseline justify-between">
                    <code># Heading 1</code>
                    <span className="font-sans font-bold text-base text-slate-900 dark:text-white">Heading 1</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-slate-200 dark:border-slate-700/60 pt-1.5">
                    <code>## Heading 2</code>
                    <span className="font-sans font-semibold text-sm text-slate-900 dark:text-white">Heading 2</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-slate-200 dark:border-slate-700/60 pt-1.5">
                    <code>### Heading 3</code>
                    <span className="font-sans text-xs uppercase tracking-wide font-semibold text-slate-700 dark:text-slate-300">
                      Heading 3
                    </span>
                  </div>
                </div>
              </div>

              {/* Lists and Checklists */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Lists & Checklists
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Bullets & Numbers:</span>
                    <pre className="mt-1 whitespace-pre-wrap font-mono">
                      {'- Bunker coat\n- Bunker pants\n1. First step\n2. Second step'}
                    </pre>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Task Checklists:</span>
                    <pre className="mt-1 whitespace-pre-wrap font-mono">
                      {'- [ ] Daily SCBA check\n- [x] Pass inspection'}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Callouts */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Callout Alert Boxes
                </h4>
                <div className="space-y-1.5 text-xs font-mono p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                  <div>
                    <code>&gt; [!NOTE] General information</code>
                  </div>
                  <div>
                    <code>&gt; [!TIP] Helpful recommendation</code>
                  </div>
                  <div>
                    <code>&gt; [!IMPORTANT] Critical station requirement</code>
                  </div>
                  <div>
                    <code>&gt; [!WARNING] Potential safety hazard</code>
                  </div>
                  <div>
                    <code>&gt; [!CAUTION] High-risk operation or gear retirement</code>
                  </div>
                </div>
              </div>

              {/* Links, Code & Tables */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Links, Code & Tables
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Links: </span>
                    <code>[NFPA 1851](https://nfpa.org)</code>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                    <span className="text-slate-400 select-none">Inline Code: </span>
                    <code>`SERIAL-2026`</code>
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 col-span-1 md:col-span-2">
                    <span className="text-slate-400 select-none">Table: </span>
                    <pre className="mt-1 whitespace-pre-wrap font-mono">
                      {'| Item | Serial # | Expiration |\n| --- | --- | --- |\n| SCBA Bottle | B-4921 | 2028-10-15 |'}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Keyboard Shortcuts */}
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Keyboard Shortcuts (Write Mode)
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex justify-between">
                    <span>Bold</span>
                    <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600">
                      ⌘/Ctrl+B
                    </kbd>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex justify-between">
                    <span>Italic</span>
                    <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600">
                      ⌘/Ctrl+I
                    </kbd>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex justify-between">
                    <span>Underline</span>
                    <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600">
                      ⌘/Ctrl+U
                    </kbd>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex justify-between">
                    <span>Strikethrough</span>
                    <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600">
                      ⇧⌘X
                    </kbd>
                  </div>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex justify-between">
                    <span>Add Link</span>
                    <kbd className="font-mono bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600">
                      ⌘/Ctrl+K
                    </kbd>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 px-5 py-3 flex justify-end bg-slate-50 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setShowReference(false)}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 transition"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}
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
      onMouseDown={(e) => e.preventDefault()}
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


