## Welcome

Welcome to the **Station Portal**. This guide is for members: what each module is for, and when to use it. Every entry in the list on the left covers one module — start here, then jump to whichever one you need.

## The modules

| Module | What it is for |
|----|----|
| **Timeclock** | Clock in and out, see the station clock, and see who is on duty |
| **Clock History** | Every entry you have made, with your running totals |
| **My Schedule** | Your shifts, and open shifts you can offer to fill |
| **My Availability** | Tell the department which shifts you could work |
| **Training** | Sign off the trainings you attended |
| **Help** | These guides |
| **User Settings** | Your preferences, notifications, password and access |

> [!NOTE]
> **Administration** also appears in the sidebar if your role has any administrator permissions. Information about that module can read at *Administration → System → Help*.

## Signing in

Your username and password are issued by an administrator. If you have forgotten your password, ask an administrator to reset it — you can change it yourself afterwards in **User Settings**.

Towards the start you may be asked to confirm your password again before a sensitive action such as clocking in. That is normal: the app is re-checking that it is still you, and it replays the action you were trying once you have confirmed, without needing you to repeat it.

> [!CAUTION]
> If you share a device, use **Log out** at the bottom of the sidebar rather than just closing the tab. Closing the tab leaves you signed in.

## Why a module might be missing

Modules are switched on by your **role**, not by you. If something you expect is not in the sidebar, your role does not include it and an administrator can add it in *Administration → People → Roles*.

**User Settings → Your Access** lists exactly which permissions your role has, so if you need to ask for something you can say precisely what is missing.

## A couple of extras

* The **Firefighter Runner** is a small hidden game.

## About this app

This app was created by Matt Wills for the Bolivia Fire Department.

**Version 1.05x**
* Added sounds.
* Added a swapping mechanism to the Schedule Management tab.
* Added a modal that would explain why you can't drag a pill somewhere, if that happens.
* Fixed a visual bug where you could scroll the entire app up to reveal an empty white void.
* Removed the ridiculous rubber band effect that happens on scrolling/dragging the viewport.
* Made a small adjustment to how help guides scroll.
* Fixed "apple-mobile-web-app-capable" deprecation.
* Fixed some ugly confirm() usages.
* Adjusted some wording on the Events configuration page.

**Version 1.04x**
* Fixed an issue with app state where loading messages couldn’t be edited (Administration > System Settings)
* Hardened protections in Code.gs to reduce potential issues where writes conflict with each other.
* Switched sequential enumerated ids to uuids, also to reduce write conflicts.
* Fixed bizarre issue where users are asked to verify their username and password after logging in.
* Added a version number to the login screen.
* Added administrative ability to force a user to change their password the next time they log in.

**Version 1.03**
* Fixed System Log timestamp sorting in the Google Apps Scripts.
* Introduced "bar labels", which are how page titles will stick to the header on mobile so users know where they are after they scroll on the page.
* Removed an extra and unnecessary heading from User Settings.
* Added informational modals to the My Schedule module that appear when you tap on a calendar item, or list item.
* Swapped out the icon for the Content dropdown in the Administration module.

**Version 1.02**
* Fixed HTTP REFERRER blocks for push notifications
* Fixed sticky header (again lol)

**Version 1.01**
* Fixed push notifications bug that didn't recognize different devices.
* Fixed header to be sticky when on a mobile device or small screen.

**Version 1.0**
* Initial public release.

**Version 0.823**
* Polished help guides to help Myles not break anything.
* Added the **System Log** tab.
* Added filtering to several tabs and modules where it would be most useful.
* Added printing to schedules
* Added toasts for loading
* Improved loading speeds by removing some requests from script locks.
* Added **Announcements**
* Added **Events**
