import React from 'react';
import { CONTENT_MAX_WIDTH } from '../utils/contentWidth';

/**
 * Caps a slice of a screen to a readable column and centres it.
 *
 * For screens that cannot use the whole-module rule in utils/contentWidth - an administration sub-tab, or
 * one view inside a tab (Member Availability's All Members list, where the single-member grid beside it
 * needs the full width).
 *
 * Below the cap the wrapper is simply full width, so nothing changes on a phone or a narrow tablet:
 * `w-full` then `max-w-*` means "this wide, or the whole panel if that is narrower". `mx-auto` centres
 * what is left over once the sidebar has taken its share.
 */
export default function CenteredContent({ children, className = '' }) {
  return <div className={`w-full ${CONTENT_MAX_WIDTH} mx-auto ${className}`.trim()}>{children}</div>;
}
