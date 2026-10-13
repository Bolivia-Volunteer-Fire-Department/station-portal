import React from 'react';
import { CONTENT_MAX_WIDTH } from '../utils/contentWidth';

// Centers content on the screen with a maximum width so lines of text don't stretch too wide.
export default function CenteredContent({ children, className = '' }) {
  return <div className={`w-full ${CONTENT_MAX_WIDTH} mx-auto ${className}`.trim()}>{children}</div>;
}
