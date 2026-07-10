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

## Desktop app (Tauri)

```sh
npm run tauri:dev     # native window against the dev server
npm run tauri:build   # → src-tauri/target/release/bundle/dmg/Arete_*.dmg
```

Requires Rust ≥ 1.88 (`rustup`) and Xcode command line tools. The desktop
build uses the native folder picker and filesystem for vaults (WKWebView has
no File System Access API), through the same `FolderFS` adapter as the web
app — `src/lib/fs-adapter.ts` is the only file that knows the difference.
The bundle is unsigned/ad-hoc signed: on first launch, right-click the app →
Open (or `xattr -d com.apple.quarantine /Applications/Arete.app`).

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
- **LaTeX** — `$E=mc^2$` renders inline the moment you close the `$`;
  `$$` opens a display equation with a live KaTeX preview editor (also
  `/equation`). Click any equation to edit its source, Obsidian-style.
- **Text formatting on right-click** — select text and right-click for
  bold / italic / underline / strikethrough / code / alpenglow, plus
  New card and Copy.
- **Tabs & history** — browser-style tabs above the topbar (middle-click or ×
  to close, ⌘-click a sidebar page or "Open in new tab" to spawn one), with
  per-tab back/forward buttons (⌥⌘← / ⌥⌘→).
- **Subpage blocks own their pages** — deleting a `/page` block from a
  document deletes the subpage itself (with a grace period so cut/paste and
  undo survive). Plain links and mentions never delete anything.
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

## The Anki backbone

- **Highlight → card** — select text, right-click, *New card*. The selection is
  marked as a reference (it moves with your edits), copied to your clipboard
  for pasting, and a composer opens beside the text. *Add another highlight*
  ties multiple, separate passages to the same card. Cancel removes the marks.
- **Card types** — *Spaced* (pure FSRS), *Routine* (every N days/weeks/months —
  anytime, at fixed times of day, or N sessions spaced hours apart; only
  correct answers advance the schedule), *Temporary* (N correct per day until a
  date, then it archives itself — built for talk prep and deadlines).
- **Review** — from the sidebar, with a live due-count badge. Space reveals,
  1–4 rate (Anki-style). Every card's *Refs* panel shows the exact live text it
  came from; *Open* jumps to the page and flashes every highlight for five
  seconds.
- **Cards** — browse, search, and filter everything (deck = source page, type,
  tag, active/archived); edit fronts, backs, tags, and schedules; archive or
  hard-delete; add standalone cards not tied to any text. Archived cards are
  kept forever and keep their memory estimate.
- **Insights** — a dashboard of stat tiles (due, streak, retention, fading
  archived knowledge), a GitHub-style practice heatmap, most-practiced pages,
  toughest cards, answer speed, and time-of-day patterns — all computed from
  the append-only review log. FSRS retrievability is the "how well do I know
  this right now" number, and it keeps decaying after cards are archived, so
  crammed knowledge visibly fades.
- **History** — every page mints immutable, dated versions when you pause
  typing, when cards are created or edited, every five minutes, and when you
  leave the page (unchanged content mints nothing). Browse and restore from
  the ⋯ menu; cards keep their own version history in the editor; the whole
  knowledge base has a timeline under Insights.

## Keys

| Key | Action |
| --- | --- |
| `⌘K` | Search and jump (or pick a page to link) |
| `⌘\` | Toggle sidebar |
| `/` | Block menu in the editor |
| `@` | Mention a page inline (or create one) |
| `Enter` in title | Drop into the first line of the page |
| `⌘B / ⌘I / ⌘U / ⌘⇧S` | Inline styles |
| `Space`, `1–4` | Reveal / rate during review |

## Where your data lives

By default in localStorage, split so hot paths stay small: `arete` (pages,
tree, favorites, theme), `arete-srs` (cards + review log), and `arete.hist.*`
(version history + the knowledge-base event feed). One caveat: state is
per-browser-tab-write — keep one Arete tab open at a time, or the last tab to
write wins.

**Or in a folder vault** (Obsidian-style): the drive button in the sidebar
footer connects a folder of your choosing. Every page becomes a plain
markdown file (frontmatter for icon/cover/font, folders for hierarchy,
`[[wikilinks]]` for references, `![[…]]` for owned subpages); cards, review
logs, and history live in a hidden `.arete/` subfolder. Everything mirrors to
disk as you work, and external edits to the markdown are read back on launch.
Data never leaves the machine. Built on the File System Access API
(Chrome/Edge today; the identical layer backs a future desktop build).

**Import from Notion**: export your Notion workspace (Markdown & CSV),
unzip it, then Vault → “Import from Notion…” and pick the folder. Pages
arrive under a “Notion import” page with hierarchy and links intact;
databases become simple lists.

## Stack

Vite · React 18 · TypeScript · TipTap 2 (ProseMirror) for the editor —
custom extensions for the slash menu (Suggestion plugin), @ mentions, callout,
page-link and card-reference marks, and a trailing-paragraph guarantee ·
ts-fsrs (FSRS v5) for memory modeling · zustand (persist) for state · Lucide
icons · self-hosted fonts via Fontsource.
