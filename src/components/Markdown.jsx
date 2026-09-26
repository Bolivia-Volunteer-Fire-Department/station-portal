import React, { useMemo } from 'react';
import { CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';
import { parseMarkdown } from '../utils/markdown';

// Renders the parsed markdown tree as React elements.
//
// Nothing here uses dangerouslySetInnerHTML: every piece of guide text becomes a text node, so
// HTML written inside a guide shows up as literal text instead of being executed. Links open in
// a new tab (a guide is documentation, not a navigation step) and carry rel="noreferrer".

const HEADING_CLASSES = {
  1: 'text-lg font-bold text-slate-900 dark:text-white',
  2: 'text-base font-semibold text-slate-900 dark:text-white',
  3: 'text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300',
};

// The five alert types, styled like GitHub's: a colored left rule, the type's icon, and its name -
// the label matters because color alone is not a signal everyone receives.
const ALERTS = {
  note: {
    label: 'Note',
    Icon: Info,
    box: 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50',
    head: 'text-slate-600 dark:text-slate-300',
  },
  tip: {
    label: 'Tip',
    Icon: Lightbulb,
    box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40',
    head: 'text-emerald-700 dark:text-emerald-400',
  },
  important: {
    label: 'Important',
    Icon: CircleAlert,
    box: 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/40',
    head: 'text-violet-700 dark:text-violet-400',
  },
  warning: {
    label: 'Warning',
    Icon: TriangleAlert,
    box: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40',
    head: 'text-amber-700 dark:text-amber-400',
  },
  caution: {
    label: 'Caution',
    Icon: OctagonAlert,
    box: 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40',
    head: 'text-red-700 dark:text-red-400',
  },
};

const headingClass = (level) =>
  HEADING_CLASSES[level] || HEADING_CLASSES[3];

const inlineChildren = (tokens, keyPrefix) =>
  (tokens || []).map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (token.type) {
      case 'bold':
        return <strong key={key}>{inlineChildren(token.children, key)}</strong>;
      case 'italic':
        return <em key={key}>{inlineChildren(token.children, key)}</em>;
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]"
          >
            {token.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer"
            className="text-red-600 dark:text-red-400 underline underline-offset-2"
          >
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
        <pre
          key={key}
          className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 text-[11px] leading-relaxed"
        >
          <code>{block.value}</code>
        </pre>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`${block.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1`}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{inlineChildren(item, `${key}-${itemIndex}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote
          key={key}
          className="border-l-4 border-slate-300 dark:border-slate-600 pl-3 text-slate-500 dark:text-slate-400 italic"
        >
          {inlineChildren(block.children, key)}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} className="border-slate-200 dark:border-slate-700" />;
    case 'alert': {
      // An unknown kind cannot reach here (the parser refuses unrecognised markers), but defaulting
      // to Note keeps a future kind from rendering as an unstyled box.
      const alert = ALERTS[block.kind] || ALERTS.note;
      const { Icon } = alert;
      return (
        <div key={key} className={`rounded-xl border border-l-4 px-3 py-2 ${alert.box}`}>
          <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${alert.head}`}>
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{alert.label}</span>
          </div>
          <div className="mt-1.5 space-y-2">{block.blocks.map(renderBlock)}</div>
        </div>
      );
    }
    case 'table':
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-600">
                {block.head.map((cell, cellIndex) => (
                  <th key={`${key}-h-${cellIndex}`} className="py-1.5 pr-3 font-semibold">
                    {inlineChildren(cell, `${key}-h-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={`${key}-r-${rowIndex}`}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-r-${rowIndex}-${cellIndex}`} className="py-1.5 pr-3 align-top">
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

  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
      {blocks.map(renderBlock)}
    </div>
  );
}
