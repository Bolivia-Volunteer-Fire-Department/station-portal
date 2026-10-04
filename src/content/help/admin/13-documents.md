The station's own documents: procedures, policies and checklists, written and organized here and read by members in the **Documents** module.

> [!IMPORTANT]
> Access to this area requires the **Manage documents** role permission, which itself requires **View documents**. A role with **Verify checklists** also opens this tab, but sees only the verification view at the bottom of it — never the editor.

Unlike the Help guides — which are files in the app's repository, written by whoever maintains it — these are written **from this screen**, by your own administrators, and stored on the station's server. Adding one needs no code change and no new deployment.

## Writing a document

Press **New document** at the top of the list — or choose a document from it — and the editor opens **over the page**, taking most of the screen. It is not a small dialog: it is the fields below, plus the markdown body, plus — on a checklist — the items and the whole signature record, and all of that needs room. The list behind it is untouched until you save.

**Save and Cancel live in the bar at the top**, which stays put while the rest of the editor scrolls underneath it. That matters on a 40-item checklist: the bottom of the form is a long way from the top of it, and Save should not be. **Delete** is up there too, for a document that already exists.

While a save is in flight the editor is **disabled** — every field, in one go — and the bar shows a spinner saying whether it is saving or still opening. It cannot be dismissed in that moment: Escape, clicking outside and Cancel are all ignored until the write comes back, because a form that vanishes mid-save leaves you with no way to know whether it saved. When it does come back the editor closes, and only then — a save that fails keeps it open with the reason in it, and nothing you typed is lost.

> [!TIP]
> On a phone the editor is the whole screen, with the toolbar pinned above a scrolling form, so a thumb never has to find a Save button at the bottom of a long checklist.

| Field | What it does |
|---|---|
| **Title** | What members see in the list. Required |
| **Folder** | Groups documents in the list. Type a new name to make a new folder |
| **Type** | *Document* for reading, *Checklist* for something signed item by item, *Link* for an address kept elsewhere, or *Assessment* for something a member is given a **score** on |
| **Minimum rank** | Who may see it. *Everyone*, or a rank and above |
| **Effective Date** | The first date members may see it. Blank means it is live now |
| **End Date** | The last date members may see it. After that it is **retired** — see below |
| **Visible to members** | Untick for a draft — it stays out of every member's list, including yours |
| **Members must sign this** | For a *Document* or *Link*: whether members sign it. **Always on, and fixed on, for a Checklist** — a checklist's items are what gets signed |

There is no **Order** box: position is set by dragging the rows in the list above (see *Ordering*), which is the only place the order is visible. A number typed in the editor and a row sitting in the list would be two answers to the same question, and the one on screen would win.

Write the text in **Write** mode — the default — and press **Preview** to see it exactly as a member will: the preview is the same renderer the Documents module uses, so there is nothing to guess at.

A **Link** has no body to write. Its one field is an **Address**, which must start with `http://` or `https://` — anything else is refused, because a link that runs code rather than opening a page is the one kind of document this app must never hand to a member. The reader sees the address with an **Open in a new tab** button, so a policy kept in the county's own system can live here without being copied in.

## Starting and retiring a document

The two dates are optional, and **both blank means no restriction at all** — which is how every document behaved before these columns existed, so nothing written earlier had to be changed.

| Dates | What members see |
|---|---|
| Both blank | Always in the list. The normal case |
| Effective date only | Nothing until that date, then always |
| End date only | In the list until that date, retired after |
| Both | In the list from the first date to the second |

A date ending **today** still counts as in force: both ends are inclusive, so an end date of 30 June is retired on 1 July.

**Retiring is the alternative to deleting.** A document past its end date leaves every member's list and stops asking for signatures, but the row, its checklist items and every signature on it are kept exactly as they were. That is the point: *the 2023 SOG is superseded, and here is who signed it* is a record you can only keep if the document is still there.

The document list marks what state each one is in — **· draft**, **· scheduled** (not started yet) and **· retired** — because those are exactly the documents whose behavior is not obvious from the row. Retired documents are only visible here; a member never sees one, and cannot sign one even from a page they opened before it retired.

## The toolbar

Write mode is a rich editor: the document appears as it will be read, and formatting is applied to whatever is selected, exactly as in a word processor.

| Button | What it does to the selected text or the line the cursor is in |
|---|---|
| **B**, *I*, Highlight, `</>` | Bold, italic, a yellow highlight, or inline code |
| Link | Asks for an address, then wraps the selection in it |
| ¶ Normal text | Takes a heading, list, quote or callout back to ordinary text |
| H1 / H2 / H3 | Makes it a heading, in the three sizes the guides use |
| Bulleted / Numbered list | Turns the line into a list, or the other kind of list |
| Quote | A quote block — the gray bar with a line down the side |
| Callout (the ▾ menu) | A colored box: Note, Tip, Important, Warning or Caution |
| Code block | A fenced block of literal text |
| Table | Inserts a 3-column table with a header row; type into the cells |
| Divider | A horizontal rule across the page |

Every styling button is a **toggle**: pressing it again on the same text takes the formatting off, and the button stays lit while the cursor is inside the formatting it applies. So there is no syntax to remember and no way to get it half right.

Three things worth knowing:

- **Pasting brings only the text.** A paragraph copied from a web page arrives as plain text rather than dragging a font, a size and a link along with it.
- **Markdown mode** (the middle tab) shows the same document as plain markdown. It has the same toolbar, and it is the mode for what a toolbar cannot express — repairing a table's divider row, or pasting markdown written somewhere else. Nothing is lost by switching between the two: they are two views of one document.
- **Preview** is the member's own renderer, not a second one, so if it looks right there it looks right for them.

> [!NOTE]
> A table needs its **divider row** (`| --- | --- |`) to be a table at all. The Table button writes one for you; in Markdown mode the second line is the one to keep intact, and a row with fewer cells than the header is padded to match rather than breaking the table.

> [!NOTE]
> A document holds about **45,000 characters**, which is a long procedure. If you run past it, the counter turns red and the save is refused with the limit named — split it into two documents rather than shortening a procedure to fit.

## Formatting, in markdown mode

The buttons write this syntax; it is worth knowing if you ever repair a document by hand.

| To get | Type |
|---|---|
| A heading | `## Heading` |
| **Bold** / *italic* | `**bold**` / `*italic*` |
| A bulleted list | `- item` |
| A numbered list | `1. item` |
| A link | `[text](https://example.com)` |
| A table | `| Column | Column |` with a `|---|---|` row under it |
| A highlighted phrase | `==read this==` |
| A note box | `> [!NOTE]` on the first line, then `> the text` |
| A warning box | `> [!WARNING]`, or `>[!CAUTION]` for the loudest |

The callout boxes are the colored panels you see throughout these guides — *Note*, *Tip*, *Important*, *Warning* and *Caution*.

## Folders

A folder is simply a name carried by the documents in it, so there is no folder to create, rename or leave empty: it appears when the first document uses the name and disappears when the last one moves out.

The folder button beside a heading opens a rename box. Renaming moves **every document in that folder**, and clearing the name moves them all to *Unfiled*. Documents with no folder are shown last, under **Unfiled**.

**The library is two columns** — the folders, then the documents in the folder you picked — and they use the whole width of the card. There is no third column held open for a document: opening one takes the entire card, and the back arrow in the header hands it back. So the space you are working in is never half list and half empty pane.

## Ordering

Position is set by **dragging**, not by typing numbers:

- **Drag a document between two others** to put it exactly there. The narrow space between two rows is a drop target: hover it while dragging and a red bar appears between them, showing where the document will land. There is a bar before every document and one after the last one, so you can also drop a document straight to the **end** of a folder.
- **Drag a document onto another one** to put it beside that document — above the row if you dragged up, below it if you dragged down. Useful when you are aiming at a row rather than at a gap.
- **Drag a folder heading** to move the whole folder, and every document in it, in front of another folder.
- **Unfiled is pinned last** and cannot be dragged: it is where documents with no folder are shown, not a shelf you chose.

Both are saved the moment you drop, and the list redraws in the order you set immediately. A drag that ends where it started — including dropping a document back into the gap it is already sitting in — writes nothing at all.

> [!NOTE]
> **A tablet cannot drag.** Touch screens do not fire the events dragging is built on, so the editor also has **Move up** and **Move down** for the document you have open — the same move, done without dragging, and the first and last rows of a folder simply have the button grayed out. If your crew writes documents on an iPad, that is the way to set a position.

A drag **never changes a document's folder**: the folder is a field on the document, and dragging is about position. Drop a document into another folder's gap, or onto a row from another folder, and the app says so instead of moving it silently — change the **Folder** field for that.

> [!NOTE]
> A folder only exists as a name carried by the documents in it, so there is no folder order stored anywhere: a folder sits where its first document sits. That is why dragging a folder heading rewrites the order of the documents inside it — it is the only thing there is to write.

## Publishing and deleting

New documents are **visible to members straight away**, so untick *Visible to members* before you start writing something you would rather nobody read yet.

> [!CAUTION]
> A document that has been signed **cannot be deleted** — the app refuses and tells you how many signatures it has. Unpublish it instead. A signature is a record that somebody read a procedure, and deleting the procedure would leave that record pointing at nothing.
> **Deleting is for mistakes; an end date is for superseding.** If a procedure is simply being replaced, give it an **End Date** rather than deleting or unpublishing it: the new one takes over the list, and the old one stays here with the record of who signed it and when.

## Signatures

Tick **Members must sign this** and the document appears in each member's list as **to sign**, until they sign it. Signed documents show **Signed** with the date beside the title.

Selecting a document shows a **Signatures** panel below its fields, in the same editor:

| What it shows | Notes |
|---|---|
| How many have signed | On the heading, with the count of stale ones if any. On a checklist this counts **signed items** — one row per member per item — not the underlying records |
| Each member and the date | The date is stamped by the server, not the member's device |
| **verified by** | On a checklist: who confirmed that member's item. It sits on the same row as the signature, because it is a fact about it rather than a separate piece of work |
| **before the last edit** | A signature taken before the current wording. Editing a document makes existing signatures stale, which is the point: a signature that appears to approve text nobody read is the one way this feature misleads |
| **remove signature** | The only way a signature ever disappears. It is recorded in the system log, and it puts the member back on the outstanding list |
| **remove verification** | Removes one verifier's confirmation and leaves the signature it confirmed in place, waiting to be verified again |

The panel is **paged**, ten rows at a time, and the pager only appears when there is more than one page. A checklist fills up quickly — every member times every item is a row — and this is what keeps the panel from pushing the document's own fields off the screen.

On a checklist, **each item appears once per member**. A signature and a verification are two separate records, and this panel used to draw them as two lines, so every verified item looked as though it had been done twice with "Verified by…" underneath. The item and the person are now the row, with the verification shown on it. The two remain separately removable, which is why the buttons name which one they remove.

> [!WARNING]
> Editing a document does not require anyone to sign again — it marks the signatures they already gave as older than the current text. Whether that matters is a judgment for you, which is why it is reported rather than enforced.

## Assessments

A document of type **Assessment** is an ordinary document with one extra thing under it: a **score** for each member.

Every member the assessment is shared with sees the document, exactly like any other, and under it they see **their own score** — or a line saying none has been recorded yet. That is all a member can do with it. There is no input on that half of the panel at all, and the screen says so in words rather than leaving you to work out why.

**Nobody enters their own score.** Not a member, and not an officer either — the security rules refuse a score whose subject is the person writing it, so an assessor cannot grade themselves even with the permission in hand. If somebody who runs the test also takes it, somebody else records the result.

To record scores, a role needs **Add assessment scores** (a member-level permission, like *Verify checklists* — it opens the Documents module, not an Administration tab).

The member a score belongs to is chosen with the **View as** dropdown at the top right — the same one that switches whose paperwork you are reading. There is no second dropdown on the assessment itself, so there is only ever one answer to "whose records am I looking at".

- On **Myself** you see your own score, read-only. You can never change it, including your own.
- On another member you see **their** score. If you also hold *Add assessment scores*, the boxes to add or replace it appear underneath.

The **score is free text, not a number** — "Pass", "4:52", "12/15" and "Needs retest" all work in the same field, because assessments in a fire station measure different things and a number would force each one to invent a scale. The **date taken** is required alongside it, and saving **replaces** the previous score: there is one current score per member per assessment, not a history.

> [!IMPORTANT]
> Entering a score is deliberately separate from *Manage documents*. Somebody who runs the agility test every month can be given *Add assessment scores* and record results without also being able to rewrite the test's wording or delete the document.

## Checklist items

A document of type **Checklist** is signed one item at a time. A checklist is **always** open to signing — the **Members must sign this** box is ticked and locked, because the lines are what gets signed, and there is no separate signature for the checklist itself. Choosing *Checklist* as the type turns it on; the server enforces it too, so a checklist cannot be stored in a state where its own items refuse to be ticked.

Set the **Type** to *Checklist* and the **Checklist items** card appears below the fields in the same editor — **before the document is saved as well as after**, so you can write the whole thing in one sitting:

| Field | What it does |
|---|---|
| **Item** | The line the member ticks. Required |
| **Section** | Groups items under a heading in both the member's view and the verification panel. Items with no section are shown last, under *Items* |
| **Order** | Position within the list; lower first, with the label breaking ties. **Left blank**, the item goes after the last one, so items keep the order you typed them in. A number you type — **including 0** — is used exactly as typed, and is never rounded up or renumbered |

Add each line with **Add item**, and use **edit** on a row to change it.

The list shows each item's order as `#0`, `#1` and so on, so you can see what a save actually stored. Those numbers are spaced ten apart by default, which is what leaves room to drop an item between two others later without renumbering anything; **0** is a real position at the top of the list, not an empty box.

> [!NOTE]
> **On a new checklist, items are held until you save it.** They are marked *not saved* so you can see the difference, and they are written the moment the checklist is created — you do not have to save, reopen and start again. A checklist that arrives with nine items instead of ten tells you so rather than pretending. Once the document exists, every change to an item is stored immediately.

> [!NOTE]
> **Every document opens as itself.** **New document** starts with an empty title, no text and **no items at all**, even straight after you have saved another checklist — the lines you just wrote belong to the checklist that was saved, and opening it again is how you get back to them. The same is true of the count beside *Checklist items*: it counts the items of the document you are looking at.

> [!IMPORTANT]
> Editing an item **keeps its signatures attached to it** — a signature points at the item's identity, not at its wording, so fixing a typo does not throw away somebody's work. Changing any item does mark signatures taken earlier as **before the last edit**, exactly as editing a document's text does.
> An item that has been signed **cannot be removed**. The app refuses and tells you how many signatures it has. That is deliberate: a signature must never outlive the thing it was about.

Members tick the items they have done and save them in one go, so a forty-line checklist is still one press. Signing the document itself is separate from signing its items — a checklist that needs both shows both.

## Verifying

Verifying is somebody confirming work the member reported doing, and it is a permission of its own: **Verify checklists**. Give it to the officers who check a new member's truck checklist — they do not need **Manage documents**, and they do not need to be administrators.

There are two ways to do it, and they answer different questions:

| Where | What it is good at |
|---|---|
| The **Verification** card on a checklist in the member-facing **Documents** module | An officer who is already reading the checklist |
| **Verify checklists** at the bottom of this tab | *Who is waiting on me?* Pick the checklist, then the member |

The second one is the one to use for a backlog. It lists the station's checklists, and for the one you pick it lists every member with something outstanding — *3 to verify, 8 of 12 signed* — busiest first. Expanding a member shows their signed items with **Verify** on each, and **Verify all 3** for the rest. Confirming several at once asks first, because a verification is a record that a check was made.

A role with *Verify checklists* opens this tab for that panel alone: it sees no editor, no folder list and no signatures report. That is why the permission is a member permission — a verifier has nothing to edit here.

### The record, once it is done

Under each member's outstanding items there is a **N already verified — show** line. It opens the item-by-item record: what was confirmed, **who confirmed it and when** ("Verified by Jane Doe on Wed, Jul 1 2026 · 2:04 PM"). If two officers confirmed the same line, it says so with the count rather than picking one, because both confirmations are on the record.

That is where you answer "who checked the truck checklist in March", and it works for any member, whether or not anything is still outstanding. The same detail appears to the member on their own line — printed on a desktop, and behind a tap on the word **Verified** on a phone, where the name and date would otherwise crowd out the item.

**If the panel says nothing is waiting, it now tells you which of the four reasons it is** — because the most common one looks exactly like a bug:

| What it says | What is actually going on |
|---|---|
| *This checklist has no items yet* | There is nothing to sign or confirm. Add the lines under **Checklist items** |
| *Nobody has signed any items on this checklist yet* | The member has ticked but not pressed **Save signatures** — nothing is recorded until they do |
| *The only signed items are yours* | You signed them yourself, and **nobody can verify their own checklist** — that rule is what makes a verification mean something. Ask another verifier to check yours, or wait for a member's items to arrive |
| *Everything signed has been verified* | Nothing outstanding — this is the good one |

The checklist picker says how many items each checklist has, so a checklist with none is visible before you select it.

| Rule | Why |
|---|---|
| Only items the member has **signed** can be verified | There is nothing to confirm about work nobody claimed |
| **Nobody can verify their own checklist** | Self-verification is one person agreeing with themselves, which is the opposite of what a verification is for. Your own checklist never appears in the panel |
| A second verifier may confirm the same item | Two officers checking one line is two confirmations, not an error; the row records each of them |
| Every verification is stamped by the server | Who confirmed it and when come from the session, never from the device |

The **Signatures** panel on the document is also the place to see verification *history* — a member's item shows **Verified** with the verifier's name once it has been confirmed.

## Who can read a checklist

Checklists follow the same rules as any other document: *Visible to members*, a minimum rank, the two dates, and *Members must sign this*. The signatures are always a member's own — nobody can read another member's checklist in the Documents module. The signature report and the verification panels are the only places where one person's records are visible to another, and both are behind a permission.
