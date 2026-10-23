import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { parseMarkdown } from '../utils/markdown';
import { BLOCK_CLASSES, CALLOUT_CLASSES, INLINE_CLASSES, bgColorClass, headingClass, headingTopSpacing, textColorClass } from '../utils/markdownStyles';
import { renderInViewport } from '../utils/viewportLayer';

// Renders the parsed markdown tree as React elements.
//
// Nothing here uses dangerouslySetInnerHTML: every piece of guide text becomes a text node, so HTML written inside
// a guide shows up as literal text instead of being executed. Links open in a new tab (a guide is documentation,
// not a navigation step) and carry rel="noreferrer".
//
// THE STYLES ARE SHARED. Every class that decides how something looks comes from utils/markdownStyles, which the
// rich editor also renders with - so a heading cannot look one way while an author writes it and another way when
// a member reads it. What stays here is only what React owns: which icon a callout wears.

// The five alert types, styled like GitHub's: a colored left rule, the type's icon, and its name, because color
// alone is not a signal everyone receives. The classes and the name come from the shared table; the icon is here.
const CALLOUT_ICONS = {
  note: Info,
  tip: Lightbulb,
  important: CircleAlert,
  warning: TriangleAlert,
  caution: OctagonAlert,
};

const inlineChildren = (tokens, keyPrefix, onOpenImage) =>
  (tokens || []).map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (token.type) {
      case 'bold':
        return <strong key={key}>{inlineChildren(token.children, key, onOpenImage)}</strong>;
      case 'italic':
        return <em key={key}>{inlineChildren(token.children, key, onOpenImage)}</em>;
      case 'underline':
        return (
          <u key={key} className={INLINE_CLASSES.underline}>
            {inlineChildren(token.children, key, onOpenImage)}
          </u>
        );
      case 'strikethrough':
        return (
          <del key={key} className={INLINE_CLASSES.strikethrough}>
            {inlineChildren(token.children, key, onOpenImage)}
          </del>
        );
      case 'textColor': {
        const cls = textColorClass(token.color);
        return (
          <span key={key} className={cls} style={cls ? undefined : { color: token.color }}>
            {inlineChildren(token.children, key, onOpenImage)}
          </span>
        );
      }
      case 'bgColor': {
        const cls = bgColorClass(token.bg);
        return (
          <mark key={key} className={cls} style={cls ? undefined : { backgroundColor: token.bg }}>
            {inlineChildren(token.children, key, onOpenImage)}
          </mark>
        );
      }
      case 'color':
        return (
          <mark key={key} className={INLINE_CLASSES.highlight}>
            {inlineChildren(token.children, key, onOpenImage)}
          </mark>
        );
      case 'code':
        return (
          <code key={key} className={INLINE_CLASSES.code}>
            {token.value}
          </code>
        );
      case 'link':
        return (
          <a key={key} href={token.href} target="_blank" rel="noreferrer" className={INLINE_CLASSES.link}>
            {inlineChildren(token.children, key, onOpenImage)}
          </a>
        );
      case 'image':
        return (
          <img
            key={key}
            src={token.src}
            alt={token.alt || ''}
            title={token.caption || undefined}
            loading="lazy"
            onClick={() => onOpenImage?.(token)}
            style={token.width ? { maxWidth: token.width, width: '100%' } : undefined}
            className={`${INLINE_CLASSES.image} cursor-zoom-in`}
          />
        );
      default:
        return <React.Fragment key={key}>{token.value}</React.Fragment>;
    }
  });

const renderBlock = (block, index, onOpenImage) => {
  const key = `block-${index}`;

  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level, 1), 6)}`;
      const topSpace = index === 0 ? '' : headingTopSpacing(block.level);
      return (
        <Tag key={key} className={`${headingClass(block.level)} ${topSpace}`.trim()}>
          {inlineChildren(block.children, key, onOpenImage)}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre key={key} className={BLOCK_CLASSES.code}>
          <code>{block.value}</code>
        </pre>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`${block.ordered ? BLOCK_CLASSES.numbers : BLOCK_CLASSES.bullets} ${BLOCK_CLASSES.list}`}
        >
          {block.items.map((item, itemIndex) => {
            const itemKey = `${key}-${itemIndex}`;
            if (Array.isArray(item) && item[0]?.type === 'text' && /^\[([ xX])\]\s+/.test(item[0].value)) {
              const match = /^\[([ xX])\]\s+/.exec(item[0].value);
              const isChecked = match[1].toLowerCase() === 'x';
              const trimmedFirst = { ...item[0], value: item[0].value.slice(match[0].length) };
              const modifiedItem = [trimmedFirst, ...item.slice(1)];
              return (
                <li key={itemKey} className="list-none -ml-4 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    readOnly
                    tabIndex={-1}
                    aria-label="List item checkbox"
                    className="mt-1 h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600 text-red-600 pointer-events-none"
                  />
                  <span>{inlineChildren(modifiedItem, itemKey, onOpenImage)}</span>
                </li>
              );
            }
            return <li key={itemKey}>{inlineChildren(item, itemKey, onOpenImage)}</li>;
          })}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className={BLOCK_CLASSES.quote}>
          {inlineChildren(block.children, key, onOpenImage)}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} className={BLOCK_CLASSES.rule} />;
    case 'alert': {
      // An unknown kind cannot reach here (the parser refuses unrecognized markers), but defaulting to Note keeps a
      // future kind from rendering as an unstyled box.
      const kind = CALLOUT_CLASSES[block.kind] ? block.kind : 'note';
      const style = CALLOUT_CLASSES[kind];
      const Icon = CALLOUT_ICONS[kind] || Info;
      return (
        <div key={key} className={`${BLOCK_CLASSES.calloutBox} ${style.box}`}>
          <div className={`${BLOCK_CLASSES.calloutHead} ${style.head}`}>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{style.label}</span>
          </div>
          <div className={BLOCK_CLASSES.calloutBody}>
            {block.blocks.map((childBlock, childIdx) => renderBlock(childBlock, childIdx, onOpenImage))}
          </div>
        </div>
      );
    }
    case 'table':
      return (
        <div key={key} className={BLOCK_CLASSES.tableWrap}>
          <table className={BLOCK_CLASSES.table}>
            <thead>
              <tr className={BLOCK_CLASSES.tableHeadRow}>
                {block.head.map((cell, cellIndex) => (
                  <th key={`${key}-h-${cellIndex}`} className={BLOCK_CLASSES.tableHeadCell}>
                    {inlineChildren(cell, `${key}-h-${cellIndex}`, onOpenImage)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-r-${rowIndex}`} className={BLOCK_CLASSES.tableRow}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-r-${rowIndex}-${cellIndex}`} className={BLOCK_CLASSES.tableCell}>
                      {inlineChildren(cell, `${key}-r-${rowIndex}-${cellIndex}`, onOpenImage)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default: {
      if (
        Array.isArray(block.children) &&
        block.children.length === 1 &&
        block.children[0]?.type === 'image'
      ) {
        const img = block.children[0];
        const captionText = img.caption || '';
        return (
          <figure key={key} className={BLOCK_CLASSES.figure}>
            <img
              src={img.src}
              alt={img.alt || captionText || 'Guide illustration'}
              loading="lazy"
              onClick={() => onOpenImage?.(img)}
              style={img.width ? { maxWidth: img.width, width: '100%' } : undefined}
              className={BLOCK_CLASSES.figureImage}
            />
            {captionText && (
              <figcaption className={BLOCK_CLASSES.figcaption}>{captionText}</figcaption>
            )}
          </figure>
        );
      }
      return <p key={key}>{inlineChildren(block.children, key, onOpenImage)}</p>;
    }
  }
};

export default function Markdown({ markdown, content }) {
  const raw = markdown ?? content ?? '';
  const blocks = useMemo(() => parseMarkdown(raw), [raw]);
  const [lightboxImage, setLightboxImage] = useState(null);

  useEffect(() => {
    if (!lightboxImage || typeof window === 'undefined') return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setLightboxImage(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxImage]);

  return (
    <div className={BLOCK_CLASSES.body}>
      {blocks.map((block, index) => renderBlock(block, index, setLightboxImage))}
      {lightboxImage &&
        renderInViewport(
          <div
            onClick={() => setLightboxImage(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn"
            role="dialog"
            aria-modal="true"
            aria-label={lightboxImage.alt || lightboxImage.caption || 'Expanded image preview'}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-5xl w-full max-h-[90dvh] flex flex-col items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-2xl animate-modalIn"
            >
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="absolute top-3 right-3 p-1.5 rounded-xl bg-slate-900/80 text-white hover:bg-red-600 transition cursor-pointer"
                aria-label="Close image preview"
              >
                <X className="w-4 h-4" />
              </button>
              <img
                src={lightboxImage.src}
                alt={lightboxImage.alt || ''}
                className="max-h-[78dvh] w-auto max-w-full object-contain rounded-lg"
              />
              {(lightboxImage.caption || lightboxImage.alt) && (
                <p className="mt-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 text-center">
                  {lightboxImage.caption || lightboxImage.alt}
                </p>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
