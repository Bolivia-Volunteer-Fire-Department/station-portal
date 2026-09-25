#!/usr/bin/env python3
"""Reflow the help guides onto one line per paragraph and per list item.

The guides are written without hard wrapping, and `npm run verify:help` enforces that. This is the
tool for when it fails: it joins the wrapped lines back up and reports what it changed.

    npm run fix:guides

Why the rule exists at all - a hard wrap is not cosmetic here, because the markdown parser is
line-based:

  * a wrapped list item ends its list at the break, so the rest of the sentence renders as a stray
    paragraph outside the list;
  * a wrapped emphasis span leaves an unpaired `*` at each end, so `*Sign trainings*` renders with
    literal asterisks instead of italics.

Left alone: fenced code blocks (byte for byte), table rows, headings, horizontal rules, blank lines,
and GitHub alert markers - an alert's marker stays on its own line with its body reflowed beneath it.
"""
import re
import sys

BULLET = re.compile(r"^(\s*)([-*+])\s+(.*)$")
NUMBERED = re.compile(r"^(\s*)(\d+[.)])\s+(.*)$")
HEADING = re.compile(r"^#{1,6}\s")
FENCE = re.compile(r"^```")
RULE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
QUOTE = re.compile(r"^\s*>\s?(.*)$")
TABLE = re.compile(r"^\s*\|")
ALERT = re.compile(r"^\[!([A-Za-z]+)\]\s*(.*)$")


def starts_block(line):
    return bool(
        BULLET.match(line)
        or NUMBERED.match(line)
        or HEADING.match(line)
        or TABLE.match(line)
        or RULE.match(line)
        or FENCE.match(line)
        or QUOTE.match(line)
    )


def join_lines(lines):
    """Join a run of body lines into paragraphs: blank lines separate, everything else continues."""
    paragraphs = []
    current = []
    for line in lines:
        stripped = line.strip()
        if stripped == "":
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        current.append(stripped)
    if current:
        paragraphs.append(" ".join(current))
    return paragraphs


def reflow_quote(quoted_lines):
    """A quote or alert as `>` lines, with its paragraphs joined and its marker left alone."""
    out = []
    marker = ALERT.match(quoted_lines[0].strip()) if quoted_lines else None

    if marker:
        # Writing the marker on its own line is the form GitHub documents, so keep it there even when
        # the source had body text sharing that line.
        out.append("> [!%s]" % marker[1].upper())
        body = quoted_lines[1:]
        if marker[2].strip() != "":
            body.insert(0, marker[2])
    else:
        body = quoted_lines

    for paragraph in join_lines(body):
        out.append("> " + paragraph)
    return out


def reflow(text):
    lines = text.replace("\r\n", "\n").split("\n")
    out = []
    i = 0
    total = len(lines)

    while i < total:
        line = lines[i]

        if line.strip() == "":
            out.append("")
            i += 1
            continue

        # Fenced code: copied byte for byte, including the closing fence.
        if FENCE.match(line):
            out.append(line)
            i += 1
            while i < total and not FENCE.match(lines[i]):
                out.append(lines[i])
                i += 1
            if i < total:
                out.append(lines[i])
                i += 1
            continue

        # Lines that are already one-per-line by definition.
        if HEADING.match(line) or TABLE.match(line) or RULE.match(line):
            out.append(line.rstrip())
            i += 1
            continue

        match = BULLET.match(line) or NUMBERED.match(line)
        if match:
            indent, marker, first = match.group(1), match.group(2), match.group(3)
            parts = [first.strip()]
            i += 1
            while i < total and lines[i].strip() != "" and not starts_block(lines[i]):
                parts.append(lines[i].strip())
                i += 1
            out.append(indent + marker + " " + " ".join(parts))
            continue

        if QUOTE.match(line):
            quoted = []
            while i < total and QUOTE.match(lines[i]):
                quoted.append(QUOTE.match(lines[i]).group(1))
                i += 1
            out.extend(reflow_quote(quoted))
            continue

        parts = [line.strip()]
        i += 1
        while i < total and lines[i].strip() != "" and not starts_block(lines[i]):
            parts.append(lines[i].strip())
            i += 1
        out.append(" ".join(parts))

    return "\n".join(out)


def tidy(text):
    """One blank line between blocks, and exactly one trailing newline.

    Outside fenced code blocks only - a blank line inside a fence is part of the sample. Markdown
    treats any run of blank lines as one break, so this cannot change what renders.
    """
    out = []
    in_fence = False
    for line in text.split("\n"):
        if line.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if not in_fence and line.strip() == "" and out and out[-1].strip() == "":
            continue
        out.append(line)

    while out and out[-1].strip() == "":
        out.pop()
    return "\n".join(out) + "\n"


def main(paths):
    if not paths:
        print("usage: reflow-guides.py <guide.md> [more.md ...]")
        return 1

    changed = 0
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            original = handle.read()
        # Tidy first, then reflow - so the output is stable in one pass whatever shape the file is in.
        fixed = reflow(tidy(original))
        if fixed != original:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(fixed)
            changed += 1
            print("reflowed " + path)

    print("reflowed %d of %d file(s)" % (changed, len(paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
