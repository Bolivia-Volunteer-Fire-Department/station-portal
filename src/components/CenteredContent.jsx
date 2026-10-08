import React from 'react';
import { CONTENT_MAX_WIDTH } from '../utils/contentWidth';

/**
 * Caps a slice of a screen to a readable column and centers it.
 *
 * For screens that cannot use the whole-module rule in utils/contentWidth: an administration sub-tab, or one
 * view inside a tab that reads as a document rather than a board. A board spans the frame instead - Member
 * Availability's All Members list does, with the no-availability card beside it.
 *
 * Below the cap the wrapper is simply full width, so nothing changes on a phone or a narrow tablet:
 * `w-full` then `max-w-*` means "this wide, or the whole panel if that is narrower". `mx-auto` centers
 * what is left over once the sidebar has taken its share.
 */
export default function CenteredContent({ children, className = '' }) {
  return <div className={`w-full ${CONTENT_MAX_WIDTH} mx-auto ${className}`.trim()}>{children}</div>;
}
