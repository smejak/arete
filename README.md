# Arete

A local, single-user Notion-style workspace. Everything lives in your browser's
localStorage — no accounts, no sync, no server. The name reads two ways: *aretē*
(Greek: excellence as a practice) and *arête* (the sharp ridge a mountain draws
against the sky). The design follows the second reading: cold alpine light,
spruce ink, and one warm gesture — text selection and `==highlights==` glow
like alpenglow.

## Run it

```sh
npm install
npm run dev      # → http://localhost:5173
```

`npm run build` typechecks and produces a static bundle in `dist/`.

## What it does

- **Live markdown** — formatting applies as you type, no preview pane:
  `#`/`##`/`###` + space for headings, `**bold**`, `*italic*`, `~~strike~~`,
  `` `code` ``, `==highlight==`, `-` bullets, `1.` numbered, `[]` to-dos,
  `>` quotes, `---` dividers, ``` for code blocks, smart quotes and
  autolinked URLs.
- **Slash menu** — type `/` on any line: headings, lists, to-dos, quote,
  divider, callout, code block, **new subpage**, **link to page**.
- **@ mentions** — type `@` mid-sentence to reference any page inline; the
  chip navigates on click and follows renames. No match? The menu offers to
  create the page on the spot (as a subpage of the current one).
- **Pages that nest** — infinitely, in a collapsible sidebar tree. Hover a row
  for expand/actions; drag rows to reorder, drag onto a row to nest inside it.
  Right-click (or `⋯`) for rename, favorite, duplicate (deep, with subpages),
  and delete (with confirm).
- **Search palette** — `⌘K` fuzzy-searches titles and content, shows recents,
  and doubles as the "link to page" picker.
- **Page dressing** — emoji icons, eight alpine gradient covers, and a per-page
  typeface: Default (Schibsted Grotesk), Serif (Literata), Mono (IBM Plex Mono).
- **Light & dark** — alpine morning / night at altitude; follows your system on
  first run, toggle in the top bar.

## Keys

| Key | Action |
| --- | --- |
| `⌘K` | Search and jump (or pick a page to link) |
| `⌘\` | Toggle sidebar |
| `/` | Block menu in the editor |
| `@` | Mention a page inline (or create one) |
| `Enter` in title | Drop into the first line of the page |
| `⌘B / ⌘I / ⌘U / ⌘⇧S` | Inline styles |

## Where your data lives

One localStorage key: `arete` (pages, tree order, favorites, theme). Delete
that key to reset to the seeded welcome workspace. Export/import and file
persistence would be the natural next step.

## Stack

Vite · React 18 · TypeScript · TipTap 2 (ProseMirror) for the editor —
custom extensions for the slash menu (Suggestion plugin), callout and
page-link nodes, and a trailing-paragraph guarantee · zustand (persist) for
state · Lucide icons · self-hosted fonts via Fontsource.
