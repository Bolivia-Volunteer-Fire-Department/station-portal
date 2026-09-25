This tab is the administrator documentation: this set of guides. It is deliberately open to anyone who can reach Administration, and needs **no permission of its own** — documentation is not a privilege, and gating it would hide it from the people most likely to need it.

## Reading a guide

Pick a guide from the list. Each one covers a single tab, so you can jump straight to the screen you are on rather than reading the whole set.

Guides are **bundled with the app**, so they work offline, need no server round trip, and behave the same on GitHub Pages as they do locally.

## Members have their own set

Members see a separate **Help** module in the sidebar, covering their own modules — clocking in, their schedule, availability and preferences. Those guides live in a different folder, and the two sets never mix: a member opening Help cannot see the administrator guides, and this tab never lists the member ones.

If a member asks something about a screen you can see and they cannot, the answer is usually in their set already — point them at **Help** in their sidebar before writing anything new.

## Looking after these guides

They are markdown files in the repository, not content in the database:

| Set | Folder |
|---|---|
| Administrator guides (this tab) | `src/content/help/admin/` |
| Member guides | `src/content/help/member/` |

Adding a guide is adding a file — no registration step, no build configuration. The first `# heading` becomes the title shown in the list, and a numeric filename prefix (`01-`, `02-`) sets the order. A guide with no heading falls back to a readable version of its filename.

**The number is the order the thing appears in the app.** These guides are numbered to match the Administration navigation — People, Scheduling, Timeclock, Training, System — with the overview first. Insert a guide where it belongs and renumber what follows, so the list keeps reading like the menu; the test suite fails if the numbering has a gap or a duplicate.

Supported formatting: headings, paragraphs, bold and italic, inline and fenced code, links, bullet and numbered lists, block quotes, `---` dividers, tables, and **alerts**.

**Alerts** are GitHub's, and the marker goes on its own line:

```text
> [!WARNING]
> Closing the tab with unsaved ticks loses them.
```

The five types are `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION`. Each renders as a coloured callout with its own icon and the type name, so the meaning survives for someone who cannot see the colour. The body is markdown like anywhere else — paragraphs, lists, emphasis and code all work inside one, and a blank `>` line separates paragraphs.

A marker that is not one of the five (`[!DANGER]`) is left as an ordinary quote, so a typo shows up as visible `[!DANGER]` text rather than being quietly styled as something it is not. `verify:help` fails on an unsupported type, so it will not reach a reader either.

Emphasis deliberately leaves `snake_case`, `2 * 3 * 4` and `* spaced like this *` alone, since column names appear in these guides constantly.

Which type to use:

| Type | For |
|---|---|
| **Note** | Context or an explanation |
| **Tip** | Helpful advice |
| **Important** | A behaviour or consequence the reader needs to know |
| **Warning** | Risk of losing work |
| **Caution** | Risk to the member or the station (security) |

**One line per paragraph, and one line per list item — do not hard-wrap.** A long line is fine; it wraps on screen by itself. Breaking a line by hand is not cosmetic here, because it changes what renders:

- a wrapped **list item** ends its list at the break, so the rest of the sentence appears as a stray paragraph outside the list;
- a wrapped **emphasis span** leaves an unpaired `*` at each end, so `*Sign trainings*` shows the asterisks instead of italicising.

Wrap in your editor rather than in the file, and the test suite will tell you if a stray break creeps in.

> [!NOTE]
> **An empty file still appears in the list**, with a note that it has no content yet. That is intentional — it means a guide you have started shows up where you expect it rather than vanishing — but it also means a leftover placeholder is visible rather than silently ignored.
