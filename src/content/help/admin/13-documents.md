The station's own documents: procedures, policies and checklists, written and organized here and read by members in the **Documents** module.

> [!IMPORTANT]
> Access to this area requires the **Manage documents** role permission, which itself requires **View documents**. A role with **Verify checklists** also opens this tab, but sees only the verification view at the bottom of it — never the editor.

Unlike the Help guides — which are files in the app's repository, written by whoever maintains it — these are written **from this screen**, by your own administrators, and stored in the station's spreadsheet. Adding one needs no code change and no new deployment.

## Writing a document

| Field | What it does |
|---|---|
| **Title** | What members see in the list. Required |
| **Folder** | Groups documents in the list. Type a new name to make a new folder |
| **Type** | *Document* for reading, *Checklist* for something signed item by item, or *Link* for an address kept elsewhere |
| **Order** | Position within its folder; lower first, with the title breaking ties |
| **Minimum rank** | Who may see it. *Everyone*, or a rank and above |
| **Effective Date** | The first date members may see it. Blank means it is live now |
| **End Date** | The last date members may see it. After that it is **retired** — see below |
| **Visible to members** | Untick for a draft — it stays out of every member's list, including yours |
| **Members must sign this** | How the document appears as needing a signature |

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

The document list marks what state each one is in — **· draft**, **· scheduled** (not started yet) and **· retired** — because those are exactly the documents whose behaviour is not obvious from the row. Retired documents are only visible here; a member never sees one, and cannot sign one even from a page they opened before it retired.

## The toolbar

Write mode is a rich editor: the document appears as it will be read, and formatting is applied to whatever is selected, exactly as in a word processor.

| Button | What it does to the selected text or the line the cursor is in |
|---|---|
| **B**, *I*, Highlight, `</>` | Bold, italic, a yellow highlight, or inline code |
| Link | Asks for an address, then wraps the selection in it |
| ¶ Normal text | Takes a heading, list, quote or callout back to ordinary text |
| H1 / H2 / H3 | Makes it a heading, in the three sizes the guides use |
| Bulleted / Numbered list | Turns the line into a list, or the other kind of list |
| Quote | A quote block — the grey bar with a line down the side |
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

## Publishing and deleting

New documents are **visible to members straight away**, so untick *Visible to members* before you start writing something you would rather nobody read yet.

> [!CAUTION]
> A document that has been signed **cannot be deleted** — the app refuses and tells you how many signatures it has. Unpublish it instead. A signature is a record that somebody read a procedure, and deleting the procedure would leave that record pointing at nothing.
>
> **Deleting is for mistakes; an end date is for superseding.** If a procedure is simply being replaced, give it an **End Date** rather than deleting or unpublishing it: the new one takes over the list, and the old one stays here with the record of who signed it and when.

## Signatures

Tick **Members must sign this** and the document appears in each member's list as **to sign**, until they sign it. Signed documents show **Signed** with the date beside the title.

Selecting a document shows a **Signatures** panel underneath the editor:

| What it shows | Notes |
|---|---|
| How many have signed | On the heading, with the count of stale ones if any |
| Each member and the date | The date is stamped by the server, not the member's device |
| **before the last edit** | A signature taken before the current wording. Editing a document makes existing signatures stale, which is the point: a signature that appears to approve text nobody read is the one way this feature misleads |
| **remove** | The only way a signature ever disappears. It is recorded in the system log, and it puts the member back on the outstanding list |

The **Signatures** panel also names the checklist item each signature is about, so a member who signed eleven of twelve lines is a list of eleven rather than a wall of ids.

> [!WARNING]
> Editing a document does not require anyone to sign again — it marks the signatures they already gave as older than the current text. Whether that matters is a judgment for you, which is why it is reported rather than enforced.

## Checklist items

A document of type **Checklist** is signed one item at a time. Set the **Type** to *Checklist* and the **Checklist items** card appears under the editor — **before the document is saved as well as after**, so you can write the whole thing in one sitting:

| Field | What it does |
|---|---|
| **Item** | The line the member ticks. Required |
| **Section** | Groups items under a heading in both the member's view and the verification panel. Items with no section are shown last, under *Items* |
| **Order** | Position within the list; lower first, with the label breaking ties. Left blank, items keep the order you typed them in |

Add each line with **Add item**, and use **edit** on a row to change it.

> [!NOTE]
> **On a new checklist, items are held until you save it.** They are marked *not saved* so you can see the difference, and they are written the moment the checklist is created — you do not have to save, reopen and start again. A checklist that arrives with nine items instead of ten tells you so rather than pretending. Once the document exists, every change to an item is stored immediately.

> [!IMPORTANT]
> Editing an item **keeps its signatures attached to it** — a signature points at the item's identity, not at its wording, so fixing a typo does not throw away somebody's work. Changing any item does mark signatures taken earlier as **before the last edit**, exactly as editing a document's text does.
>
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

| Rule | Why |
|---|---|
| Only items the member has **signed** can be verified | There is nothing to confirm about work nobody claimed |
| **Nobody can verify their own checklist** | Self-verification is one person agreeing with themselves, which is the opposite of what a verification is for. Your own checklist never appears in the panel |
| A second verifier may confirm the same item | Two officers checking one line is two confirmations, not an error; the row records each of them |
| Every verification is stamped by the server | Who confirmed it and when come from the session, never from the device |

The **Signatures** panel on the document is also the place to see verification *history* — a member's item shows **Verified** with the verifier's name once it has been confirmed.

## Who can read a checklist

Checklists follow the same rules as any other document: *Visible to members*, a minimum rank, the two dates, and *Members must sign this*. The signatures are always a member's own — nobody can read another member's checklist in the Documents module. The signature report and the verification panels are the only places where one person's records are visible to another, and both are behind a permission.

