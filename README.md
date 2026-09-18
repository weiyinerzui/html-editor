# Visual HTML Editor (WYSIWYG)

A complete, dependency-free, in-browser **WYSIWYG HTML editor** — a from-scratch
recreation of the visual web-page editing experience (inspired by heyhtml.com,
re-implemented with original code, zero libraries at runtime).

Open **index.html** in any modern browser and press **Edit**. No build step,
no server, no sign-up.

## Files

| File | Purpose |
|---|---|
| `index.html` | Demo / landing page — every element on it is editable |
| `editor.css` | Editor UI styling (auto-stripped from saved output) |
| `editor.js` | The editor engine (~3,000 lines, vanilla JS) |
| `tests/` | Playwright end-to-end suites (67 checks, all passing) |

## Feature overview

**Selection & manipulation**
- Click to select (with hover highlight), 8-direction resize handles
- Drag to reorder in flow (drop indicator shows the insertion point)
- Free-drag floating elements with **snap guides** (edge/center alignment +
  gap labels in px)
- Marquee (box) multi-select — selects siblings in the container under the box,
  climbs levels when the box center lands on a leaf node
- Group / ungroup (Ctrl+G / Ctrl+Shift+G), lock / unlock (Ctrl+L),
  duplicate (Ctrl+D), copy/paste, delete
- Esc walks up the parent chain; arrow keys nudge (Shift = ×10)
- Context menu (right-click): table row/column ops, group, lock, layer order
- Element panel: font, size, weight, italic, underline, color, background,
  border-radius, opacity, link, alignment

**Text editing**
- Double-click for inline editing (full execCommand toolbar: B/I/U, headings,
  lists, quotes, links, alignment, colors)
- Paste images straight into the page, drag-and-drop image files

**Insert & templates**
- Insert panel with Flow / Floating modes: container, text, heading, table,
  image, button, divider, link, list, quote
- Table dialog (rows × columns + header row)
- Chart panel: 8 hand-rolled CSS/SVG chart templates (bar, line, donut, …)

**Documents**
- Save downloads a **clean HTML file** (all editor marks stripped,
  doctype + original head preserved)
- Open any HTML file from disk and edit it
- PDF export via html2canvas + jsPDF (CDN, lazy-loaded; falls back to a
  print stylesheet if offline)
- Page manager panel; unsaved-changes guard on exit

**Undo/redo** — full history (Ctrl+Z / Ctrl+Y), coalesced input events,
restores scroll position.

## Architecture notes

- All editor UI lives under `#hve-ui-root` and is tagged `data-hve-ui`,
  so it can never leak into saved output and never intercept content clicks.
- Runtime-only content marks use the `data-hve-` prefix; only
  group/locked/floating survive serialization.
- `window.HVE` exposes the public API: `state`, `undo()`, `redo()`,
  `saveAs()`, `toggleEditMode()`, `openFilePicker()`, `setSelection(els)`,
  `toast(msg)`, `serializeDocument()`.

## Tests

```bash
cd tests
node test-editor.mjs   # 50 checks — core interactions
node test-editor2.mjs  # 17 checks — floating drag, snap guides, marquee,
                       # tables, format brush, layer ops, undo/redo
```
(Requires `playwright` installed in the working directory.)

All **67/67** checks pass.
