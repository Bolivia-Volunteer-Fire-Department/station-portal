import React, { useCallback, useMemo, useState } from 'react';
import AnnouncementCallout from './AnnouncementCallout';
import {
  announcementDismissalKey,
  announcementFlag,
  visibleAnnouncementsFor,
} from '../utils/announcements';

/**
 * The announcements to show in one place: the login screen, the dashboard or the sidebar.
 *
 * Dismissal state lives per device in localStorage, keyed by reader and announcement (see
 * utils/announcements for the trade-off). Reading it is wrapped in try/catch: localStorage throws in a
 * privacy-restricted context, and the right answer there is to show the announcement rather than to
 * crash the login screen.
 */
const readDismissed = (userId, announcements) => {
  const dismissed = [];
  try {
    (Array.isArray(announcements) ? announcements : []).forEach((announcement) => {
      if (!announcementFlag(announcement?.is_dismissable)) return;
      if (window.localStorage.getItem(announcementDismissalKey(userId, announcement.id)) === '1') {
        dismissed.push(String(announcement.id));
      }
    });
  } catch {
    // No storage: nothing is remembered, so nothing is filtered out.
  }
  return dismissed;
};

export default function AnnouncementList({
  announcements = [],
  location,
  audience = {},
  compact = false,
  className = '',
}) {
  const userId = audience?.userId || '';
  const [dismissed, setDismissed] = useState(() => readDismissed(userId, announcements));

  const dismiss = useCallback(
    (announcement) => {
      try {
        window.localStorage.setItem(announcementDismissalKey(userId, announcement.id), '1');
      } catch {
        // Storing failed, so it will reappear on the next visit rather than erroring now.
      }
      setDismissed((previous) => [...previous, String(announcement.id)]);
    },
    [userId]
  );

  const visible = useMemo(
    () =>
      visibleAnnouncementsFor({
        announcements,
        location,
        audience,
        dismissedIds: dismissed,
        // The login screen has no reader to target, so it only shows announcements meant for everyone.
        includeEveryoneOnly: location === 'is_visible_on_login',
      }),
    [announcements, location, audience, dismissed]
  );

  if (visible.length === 0) return null;

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {visible.map((announcement) => (
        <AnnouncementCallout
          key={String(announcement.id)}
          announcement={announcement}
          compact={compact}
          onDismiss={announcementFlag(announcement.is_dismissable) ? () => dismiss(announcement) : undefined}
        />
      ))}
    </div>
  );
}
