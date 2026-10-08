# Forms

*Reports → Forms* defines **printable PDFs filled from the app's own data**. Instead of typing the same training details onto a state sheet a second time, a form is set up once here and then generated already filled in.

> [!IMPORTANT]
> Requires the **Configure forms** permission.

> [!NOTE]
> The blank PDFs are **files in the app itself**, not uploads: they live in `public/forms/` and are registered in `src/utils/formCatalog.js`. That is deliberate — it keeps the blanks working with no network, which is what a station laptop needs. Adding a new one is a file plus a line, done by whoever maintains the app rather than from this screen.

## A form is three things

| Part | What it is | Example |
|---|---|---|
| **The blank** | The PDF to fill — choose it under **The blank PDF** | a state training record |
| **The data source** | Where the values come from | *A member's training, totalled by category* |
| **The map** | Which box on the PDF gets which value | `Hazmat Hours` ← `totals.is_hazmat` |

**You never type a PDF field's name.** Choosing a blank reads the fields *off the PDF* and lists them under **Where each value goes**; each row is one box on the sheet. Fill in the value for the boxes this form needs and leave the rest empty.

## The value box

Each value is a short path, not code, so a definition can be edited freely and can only ever name data that is already there:

The screen **lists every path the chosen data source offers**, grouped into the member, the station, the period and the totals — including **one entry per training category your station uses**, so a category you add later appears there by itself. The box autocompletes from that same list, so you can pick a path rather than recall it. The list is not a suggestion: every path on it is checked to read real data, so it cannot offer you something the form would print blank.

| Value | Reads |
|---|---|
| `member.name` | The member's name |
| `total` | Every training hour counted once |
| `totals.is_hazmat` | The member's Hazmat hours |
| `totals.is_ems` | The member's EMS hours |
| `today` | Today's date |
| `literal:Not applicable` | That exact text, always |

The **type** beside each value tells the PDF what kind of box it is — text, a checkbox (the value is *true* or false), a radio group, or a dropdown — and it must match the box on the blank. A value pointed at a box the blank does not have is reported when the form is generated rather than losing the whole sheet.

## Who can generate it

Under **Who can generate this form?**, choose **Everyone**, or tick the **roles** and **ranks** it is shared with. This is an *audience*, not a permission: it says who the form is *for*. The role still has to be able to reach the screen a form is run from.

## Turning one off, and deleting one

Leave **Enabled** ticked to offer the form. Untick it to keep the definition without offering it to anybody — it stays in this list, marked **Disabled**, so its settings are not lost.

**Delete** removes the definition. Sheets already generated and handed out are unaffected — a filled PDF is a document of its own once it has been made.
