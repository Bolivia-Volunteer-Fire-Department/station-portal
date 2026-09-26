import React, { useMemo } from 'react';
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';
import { parseMarkdown } from '../utils/markdown';
import { BLOCK_CLASSES, CALLOUT_CLASSES, INLINE_CLASSES, headingClass } from '../utils/markdownStyles';

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

const inlineChildren = (tokens, keyPrefix) =>
  (tokens || []).map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (token.type) {
      case 'bold':
        return <strong key={key}>{inlineChildren(token.children, key)}</strong>;
      case 'italic':
        return <em key={key}>{inlineChildren(token.children, key)}</em>;
      case 'color':
        return (
          <mark key={key} className={INLINE_CLASSES.highlight}>
            {inlineChildren(token.children, key)}
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
            {inlineChildren(token.children, key)}
          </a>
        );
      default:
        return <React.Fragment key={key}>{token.value}</React.Fragment>;
    }
  });

const renderBlock = (block, index) => {
  const key = `block-${index}`;

  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level, 1), 6)}`;
      return (
        <Tag key={key} className={`${headingClass(block.level)} ${index === 0 ? '' : 'pt-2'}`}>
          {inlineChildren(block.children, key)}
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
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{inlineChildren(item, `${key}-${itemIndex}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className={BLOCK_CLASSES.quote}>
          {inlineChildren(block.children, key)}
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
          <div className={BLOCK_CLASSES.calloutBody}>{block.blocks.map(renderBlock)}</div>
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
                    {inlineChildren(cell, `${key}-h-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-r-${rowIndex}`} className={BLOCK_CLASSES.tableRow}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-r-${rowIndex}-${cellIndex}`} className={BLOCK_CLASSES.tableCell}>
                      {inlineChildren(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return <p key={key}>{inlineChildren(block.children, key)}</p>;
  }
};

export default function Markdown({ markdown }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  return <div className={BLOCK_CLASSES.body}>{blocks.map(renderBlock)}</div>;
}
