# Certification Setup

*People → Certification Setup* defines the certifications the station tracks. Nothing can be recorded against a certification until it exists here.

> [!IMPORTANT]
> Requires the **Set up certifications** permission.

## What each certification decides

| Field | What it controls |
|---|---|
| **Name** | What members and administrators see, on the records and in the sign-in warning |
| **Icon** | The badge beside it — and beside members' names, when that is switched on below |
| **Warn this many days before it expires** | How close to the end date a member is told. **Blank means never warned** |
| **Sort order** | Where it appears in the lists; lower first |
| **This certification can be renewed** | Whether it has an end date at all |
| **Display icon next to user name** | Whether it shows as a badge beside the member's name |

## "Blank means do not warn" is not the same as zero

The warning is what a member sees when they sign in, and it is the reason to fill this in for the licences that matter — a paramedic card, an EVOC, a medical certification.

> [!NOTE]
> A certification with a blank window is still tracked, still dated, and still shows its status on the records page. The blank says "we do not need to nag anybody about this one", which is a different decision from "this one cannot expire".

An expired certification is mentioned too, until it is renewed — the alternative is a licence that lapses and is never spoken of again.

## Not renewable means no end date

Leaving **This certification can be renewed** unticked is for a one-off achievement: a course you completed once, an award, a certificate with no renewal cycle.

The end date is then disabled on the Certifications tab, and the server clears it, so a date cannot be attached to something that does not expire — even by editing the sheet.

## Icons, including numbers

Pick from the list, or type a **number or roman numeral** (`1`, `2`, `III`) into the same box. Nothing in the icon set is a digit, so those are drawn as text in the same slot — which is what a station needs for levels like *Instructor 1* or *Level III*.

The set includes the rank and badge icons the rest of the app uses, plus emergency-services ones: a medical cross, a stethoscope, a syringe, a fire extinguisher, a hazmat mark, an ID card and more.

> [!WARNING]
> Ticking **Display icon next to user name** puts that icon beside the member's name *wherever it appears* in the app — and only while the certification is current. Two small glyphs beside a name do not explain themselves: hover them to see which certifications they stand for.
