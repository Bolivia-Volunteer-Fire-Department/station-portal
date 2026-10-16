## Welcome

Welcome to **StationSync**. This guide is for members: what each module is for, and when to use it. Every entry in the list on the left covers one module — start here, then jump to whichever one you need.

## The modules

| Module | What it is for |
|----|----|
| **Timeclock** | Clock in and out, see the station clock, and see who is on duty |
| **Clock History** | Every entry you have made, with your running totals |
| **Chat** | A station communication module |
| **Roster** | A list of members of this station |
| **Schedule** | Your shifts, and open shifts you can offer to fill |
| **Availability** (My Availability) | Tell the department which shifts you could work |
| **Training** | Sign off the trainings you attended |
| **Documents** | Literature that the department wants to have available to you, for you to read and sign, or check off |
| **District Map** | An interactive map of this station's district and surrounding districts |
| **Reports & Forms** | A module for processing data entered into this app as some kind of organized output |
| **Help** | These guides |

> [!NOTE]
> **Administration** also appears in the sidebar if your role has any administrator permissions. Information about that module can be read at *Administration → System → Help*.

## Signing in

Your username and password are provided by an administrator. If you forget your password, ask an administrator to reset it. You can change your password anytime by clicking your name at the top of the sidebar to open your **User Profile**.

When you first use the app, you might be asked to re-enter your password before an important action, like clocking in. That is completely normal! The app is just double-checking that it is really you. Once you confirm your password, your action completes automatically.

> [!CAUTION]
> If you are using a shared computer or tablet, always click **Log out** at the bottom of the sidebar when you finish. Just closing the browser tab will leave you logged in!

## Why a module might be missing

The modules you see in the sidebar depend on your assigned **role**. If you do not see a module you need, your role may not have access to it yet. An administrator can update your role under *Administration → People → Roles*.

To see what you have access to, click your name at the top of the sidebar to open your **User Profile**, switch to the **My Settings** tab, and look at the **Your Access** card. This shows every permission your account currently has.

## A couple of extras

* The **Firefighter Runner** is a fun mini-game hidden inside the app! Look around and tap the right spot to find it.

## About this app

This app was originally created for the Bolivia Fire Department in Bolivia, North Carolina.

### Version 1.7x
* Added **Equipment** and **Apparatuses**
* Revamped how Documents are organized in the Administration module.
* Added formatting enhancements to the Markdown engine.
* Migrated the Timeclock module to a new **Dashboard** module, which is a customizable widget-based dashboard module.
* Added **Pre-Incident Plans** to the District Map.

### Version 1.6x
* Added the **District Map** module.
* Fixed an issue where the app would desync with Firestore when encountering intermittent connectivity issues. Added a self-healing mechanism to auto-resync.
* Repositioned toasts to avoid camera notches/iPhone's *Dynamic Island*.
* Added a button to collapse the sidebar on larger screens.
* Added a Navigation Setup tab.
* Simplified codebase comments.
* Fixed an issue where administrators could only see their own training signatures in the Administration module.
* Added an easier way for administrators to see documents to verify.
* Added some version-checking mechanisms to help transition users to new versions.
* *Moved* My Settings and Certifications to a new **User Profile** page, accessible to a user by clicking their own name.
* Properly set up **lazy loading** in Administration tabs.
* Extracted heavily-reused variables into their own React contexts to reduce prop drilling.
* Addressed `set-state-in-effect` warnings, Eliminates cascading double-renders in `DocumentsModule.jsx` and `AdminDocumentsTab.jsx`.
* Implemented a cache-first strategy for station metadata, like Ranks, Roles, and Shifts. This reduces document read billing to zero for repeat visits/background resumes.
* Reorganized codebase into feature-based folder structure for better maintainability.

### Version 1.5x
* **Rebranded** to *StationSync*!
* Added **Firebase Storage** for Certification uploads.
* Fixed an issue with the Roster not showing everyone.
* Added enhancements to the **Firefighter Runner** to make mobile play easier.
* Added the **Chat** module.
* Removed redundant and unnecessary fetch events/unbounded scans.
* Tweaked handling of push notifications.
* Fixed certifications viewing permissions.
* Updated button labels to "Clocking In..." and "Clocking Out..." during loading, keeping offline/disabled safeguards intact.
* Added autoCapitalize="none", autoCorrect="off", and spellCheck={false} to the username field to prevent mobile keyboards from uppercasing or autocorrecting station credentials.
* Replaced standard button text with `<Loader2 className="w-5 h-5 animate-spin" />` and "Signing In..." while submission is in flight, disabling double-submissions.
* Relocated the version number on the Login Screen.
* Added a lightweight sticky bottom bar for mobile devices featuring the top daily firefighter actions.
* Added bottom safe-area clearance to main content area to ensure no content is obscured.
* **Calendar viewing enhancements**: made "today" more apparent, boosted contrast and sizing on weekday headers and regular date keys, week numbers.
* Styled table headers with `sticky top-0 z-10 bg-slate-100/95 dark:bg-slate-900/95 backdrop-blur-sm border-b` across Reports, Roster, and Admin management tabs so column titles remain visible during long table scrolls.
* Added animated skeleton shimmer rows to: Roster table during member searches/loads and the Administration module initial read.

### Version 1.4x
* Every password field now has an **eye** on it, so you can check what you are typing on the login screen and anywhere else a password is entered.
* Added **Member ID**, **Email Address** and **Phone Number** to member records. Members keep their own email, phone and FEMA ID up to date in **My Settings → Personal Information**; the member ID is set by administrators and is not shown to members at all.
* Renamed the FEMA card in **My Settings** to **Personal Information**, and moved it to the top. It now shows your name and your contact details as well.
* Combined **Reports** and **Forms** into one module in the sidebar. They are configured together, so they are now one screen — it shows whichever of the two your role allows.
* Added a **single-horn bugle** icon to the icon library, alongside the existing pair.
* Added the **Forms** module, which allows specified users to export data onto pre-existing PDF forms. (i.e. state forms)
* Added some ID fields to the users_private table.
* Added a boss level to the mini game.
* Fixed a bug in document permissions.
* Added a "members without availability" card to the Administration module.
* Added some reports.
* Fixed an auth session retention issue.
* Resolved some Firestore reads issues.

### Version 1.3x
* Added the **Reports** module
* Added the Reports Configuration tab to the Administration module.
* Added **Accessibility settings** to the My Settings module.
* Fixed an issue where Schedule Management would say someone isn't available during a time when they said they were available.
* Added an **export** button to the Schedule module, allowing members to export their schedule to something like Google Calendar.
* Added a bugles icon to the icon library for Captains.
* Moved the position of the Availability toolbar buttons to be consistent with other modules.
* Normalized some language across the app.
* Added a ton of **Firestore optimizations** to reduce read & write costs.

### Version 1.2x
* Added the **Roster** module
* Added rank coloring to Administration > People > Members to match the new Roster module.
* Fixed an issue where users could grant themselves administrator access.
* Fixed an issue where one member could overwrite another member's availability.
* Fixed the role editor, which could be used to demote an administrator from their role.
* Fixed an issue where members could rewrite their own clock history and on-duty state directly.
* Fixed an issue where verifiers could verify their own work. (allowed for admins)
* Fixed an issue that allowed members to bypass a forced password change.
* Fixed unnecessary Firestore reads and writes.
* Removed duplicate approval refreshes.
* Reorganized checklist items in Firestore to be more efficient and low-cost.
* Made additional security enhancements.
* Refined filtering and sorting for Certifications.
* Added **printing and exporting** to Certifications.
* Added a badge to the Administration menu page for Documents that need verification.
* Fixed an issue where popovers on the Schedule Management tab overflowed themselves off the page causing Myles' eye to twitch.
* Reduced the amount of time it took to drag and drop shift pills on the Schedule Management tab.
* Added a horizontal line to the Schedule module and Schedule Management tab to separate the day shift from the night shift.
* Added a user setting toggle for hiding events by default on the various calendar pages.

### Version 1.1x
* **Moved the app onto a modern database** (Firebase, in place of the Google Sheet it used to run on).
* **Sign-in is much faster.** The app now asks for everything it needs in one request instead of two dozen small ones.
* **Things that used to need a refresh now update by themselves.** The *who is on duty* card, plus announcements and events, appear as soon as they change — nobody has to reload a page to see you clock in.
* **Reads keep working with no signal.** If you lose your bars, the schedule, your history and these guides still open. Clocking in and out is the exception: that needs a connection, because the app has to record the *real* time it happened rather than the time your phone thinks it is. While you are offline, the clock buttons are switched off and say why.
* Two people editing at the same moment can no longer overwrite each other, and every entry gets its own unique number so a slow save cannot collide with a fast one.
* Internal codes are no longer shown anywhere in the app — you see names, not identifiers.
* Condensed README.md & other docs that didn't belong in their own doc.
* Added a new menu-like landing page for the Administration module.
* Renamed anything "users" to "members".
* Fixed an issue with Clock History not working correctly.
* Modified some visual things on Schedule Management.
* Added **assessments**.
* Made some corrections to document configuration.
* Fixed an issue where users forced to change their password were forever forced to change their password.

### Version 1.06x
* Added **Documents** - used for creating and viewing things like SOP's. This included creating both a parser/viewer and an in-app editor, allowing administrators or roles with the proper permissions to create new documents. The same goes for...
* Added **Checklists** - used for creating and viewing things like new hire orientation packet lists.
* Added **Links** - used for external URLs.
* Added a "Turn Off" button for administrators in the Notifications configuration tab.
* Added some animations and transitions to the app overall to help this feel fast, as opposed to abrupt.
* Adjusted the app settings so that, once it is installed on a phone or tablet, it feels like an app rather than a web page, and a stray two-finger touch cannot resize the screen by accident.
* Added **Certifications**, where things like an EMT certification can be tracked. Optionally allowed the representing icon be displayed next to user names (to assist with scheduling).
* Added more icons.
* Changed icon dropdown to icon pickers, allowing users and administrators to visually select an icon instead of guessing based on name.
* Added a **print** option to Training in the Administration module.
* Altered training categories.
* Added a filter for category to Training screens.
* Added a loading spinner to some areas where you're left wondering what was happening while it's loading.
* Fixed a bug where completed checklist items in the Administration module showed twice.
* Transitioned most "new" forms to a modal pop-up format, to save space and streamline modules.
* Did an AI review of the codebase to look for opportunities to improve efficiency and loading performance - thanks to Cline and Deepseek!

### Version 1.05x
* Added **sounds**.
* Added a swapping mechanism to the Schedule Management tab.
* Added a modal that would explain why you can't drag a pill somewhere, if that happens.
* Fixed a visual bug where you could scroll the entire app up to reveal an empty white void.
* Removed the ridiculous rubber band effect that happens on scrolling/dragging the viewport.
* Made a small adjustment to how help guides scroll.
* Fixed "apple-mobile-web-app-capable" deprecation.
* Fixed some ugly confirm() usages.
* Adjusted some wording on the Events configuration page.
* Update the modal sounds to be shorter and better matching to the visual animation.
* Removed the presence of UUIDs from the front end.
* Sign-in used to make about a dozen separate requests to the server, one after another. It now makes one, which was the single biggest speed improvement the app has had.

### Version 1.04x
* Fixed an issue with app state where loading messages couldn’t be edited (Administration > System Settings)
* Two people saving at the same moment can no longer overwrite each other.
* Each new entry gets its own unique number, so two saves at once cannot collide.
* Fixed bizarre issue where users are asked to verify their username and password after logging in.
* Added a **version number** to the login screen.
* Added administrative ability to force a user to change their password the next time they log in.

### Version 1.03
* Fixed the order of entries in the System Log.
* Introduced **"bar labels"**, which are how page titles will stick to the header on mobile so users know where they are after they scroll on the page.
* Removed an extra and unnecessary heading from User Settings.
* Added informational modals to the My Schedule module that appear when you tap on a calendar item, or list item.
* Swapped out the icon for the Content dropdown in the Administration module.

### Version 1.02
* Fixed notifications not arriving on some devices.
* Fixed sticky header (again lol)

### Version 1.01
* Fixed push notifications bug that didn't recognize different devices.
* Fixed header to be sticky when on a mobile device or small screen.

### Version 1.0
* **Initial production release**.

### Version 0.823
* Polished help guides to help Myles not break anything.
* Added the **System Log** tab.
* Added filtering to several tabs and modules where it would be most useful.
* Added **printing** to schedules
* Added toasts for loading
* Made several screens load faster.
* Added **Announcements**
* Added **Events**
