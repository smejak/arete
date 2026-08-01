# Arete

Spaced repetition software can be a powerful tool for creating a context in which to think.

I have found spaced repetition works best when it is closely tied to what I'm working on.

Arete is a workspace that combines note-taking with spaced repetition.

## Getting started

1. **Download the app.** It's free, all your files are local, and no data ever
   leaves your computer.
   [Download `Arete-v0.0.6.dmg`](https://github.com/smejak/arete/releases/download/v0.0.6/Arete-v0.0.6.dmg),
   or browse all [releases](https://github.com/smejak/arete/releases).
   *(The beta is unsigned — on first launch, right-click the app and choose
   Open. Apple Silicon macOS. Arete also runs fully local in Chrome and Edge.)*
2. **Create a new folder, or port over your existing notes.** Arete notes are
   plain `.md` files — pick any folder and it becomes your vault. Coming from
   Notion? Export as Markdown & CSV, unzip, and open that folder.
3. **Start using Arete.** To create a card, highlight a piece of text in your
   notes and right-click.

## Writing

There is no preview pane and no edit mode. Markdown becomes form as you type
it: `#` for a heading, `-` for a bullet, `[]` for a to-do, `>` for a toggle,
`"` for a quote, `---` for a divider. Type `/` on any line for everything else,
and `@` to mention another page mid-sentence.

Beyond the usual blocks:

- **Databases** — a table whose rows are pages, with typed columns (select,
  date, checkbox, number, URL…), sorting and filtering. Full-page or inline.
- **Math** — KaTeX inline (`$…$`) and as display blocks.
- **Footnotes** — Tufte-style, numbered automatically, living in the margin
  beside the paragraph they belong to.
- **Progress rings** — up to four dials in a block; click, drag or type to move
  one along. For tracking a course, a reading list, a project.
- **Audio** — record straight into a page or a card, or drop in a file. Plays
  inline with a scrubber and adjustable speed.
- **Images** — click one to open it full screen, then pinch or scroll to zoom
  and drag to pan.
- **HTML embeds** — drop in an `.html` file and it runs in a sandboxed frame,
  useful for interactive diagrams and simulations.
- **Covers, page icons, three typefaces**, and a text-size control.

Pages nest, open in tabs, and keep their own history — any page can be rolled
back to an earlier version from the ⋯ menu.

## Spaced repetition

Arete uses open-source spaced repetition software
([FSRS](https://github.com/open-spaced-repetition/ts-fsrs)) as well as two new
features for different card types. I wanted to make flash cards as versatile as
notes. Arete ships three card types:

- **Classic spaced repetition cards.**
- **Routine cards** — cards appear regularly at specified times and intervals.
  Useful for reminders, habits, or just denser card exposure.
- **Temporary cards** — cards stay in the deck only until a date you set, then
  archive themselves; the review frequency is adjustable too. Use these for
  time-bound tasks like talks, short-term projects, or preparing for a meeting.

Cards automatically keep references to the pages and text they were created
from — open a card's **Refs** to jump back to the exact passages it came from,
with the sentence lit up where you left it. Card fronts and backs are full
Arete editors, so a card can hold math, an image, an embed or a recording.

Review everything or one page's deck. **Cards** lists every card you have with
search and filters, and lets you select several at once to archive or delete
them together. **Insights** charts what you have been doing: reviews over time,
recall, and where your cards come from.

## Finding and reusing text

Every text block in the vault is addressable.

- **`/` → Reference a block** points at a paragraph anywhere in the vault.
  Following it opens that page, scrolls to the paragraph and lights it. The
  reference stores the words rather than an id, so nothing is written into the
  paragraph you pointed at — and if that text is later rewritten, the reference
  says so instead of pretending.
- **`/` → Copy a block here** pastes a copy of one instead.
- **The block palette** finds them two ways: by **keywords**, with your words
  lit inside each candidate, or by **tags** (press `#`).

### Tags, categories and groups

Tags are one vocabulary for the whole vault, added from any block's handle.
When you make one you choose what it is, and that does not change afterwards:

- A **category** is for finding — many blocks may carry it, and choosing one
  drills into its blocks so you can take a single block.
- A **group** is for reading together — a small chosen set with an order.
  Referencing or copying a group takes the whole thing.

A group opens in a window in front of the page — not a page of its own, but
assembled from whatever currently carries the tag. Blocks from different pages
sit together, each beside where it came from, and dragging sets the order the
group reads in. **Manage tags…** in any block's handle menu lists the whole
vocabulary, with colours, usage counts, and rename or remove across the vault.

## Sharing

- **Copy page as markdown** — the button beside the theme toggle puts the
  page's markdown on the clipboard. **Expand references** in the ⋯ menu swaps
  each block reference for the text it points at, for pasting somewhere that
  has no vault to resolve them against.
- **Interactive HTML** — one self-contained file that *is* Arete: the sidebar,
  the page tree, light and dark, and a working Review and Cards view over the
  deck that ships with it. Readable in any browser, with nothing installed.
  Reviews there advance the session but are not saved — a file has nowhere to
  write them.
- **Markdown vault (.zip)** — plain markdown plus the cards from those pages.
  Unzipped, it opens directly in Arete as a vault.

## Your files

A vault is an ordinary folder. Every page is a `.md` file with YAML
frontmatter, folders carry the hierarchy, and `[[wikilinks]]` carry references,
so the folder stays readable in Obsidian or any editor. Media lives in
`media/`. Cards, review logs, page history and vault settings live in a hidden
`.arete/` folder beside your notes.

Nothing is written that a page does not need: a block only gains a marker line
once you tag it, and an untagged vault is the markdown you would have written
by hand.

## Contributing

Arete is open source under the [MIT License](LICENSE) and welcomes code
contributions.

It's a [Tauri](https://tauri.app) desktop app wrapping a React + TypeScript web
app: [TipTap](https://tiptap.dev) (ProseMirror) for the live-markdown editor,
[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) for scheduling,
[KaTeX](https://katex.org) for math, and [Zustand](https://github.com/pmndrs/zustand)
for state. Notes live on disk as plain markdown; cards, review history, and
analytics live in a hidden `.arete/` folder beside them.

### Run it locally

You'll need [Node.js](https://nodejs.org) 18+. For the desktop build you'll
also need the [Rust toolchain](https://rustup.rs) (1.88+) and, on macOS, the
Xcode Command Line Tools (`xcode-select --install`).

```sh
npm install
npm run dev          # web app → http://localhost:5173
npm run tauri:dev    # native desktop window (needs Rust)
```

```sh
npm run build        # typecheck (tsc) + production web build
npm run tauri:build  # build the desktop app → src-tauri/target/release/bundle/
```

### Where things live

```
src/
  components/   UI — editor page, review, cards, insights, sidebar, tabs,
                block palette, group window, tag manager
  editor/       TipTap extensions (slash menu, @mentions, math, card refs,
                block handle, block tags, block/group references)
  store/        Zustand state (pages, cards + FSRS logs, tag registry, clock)
  lib/          srs (FSRS wrapper), vault + markdown (folder sync), blocks,
                tags, history, share, export-html, copy
  styles/       CSS design tokens and component styles
src-tauri/      Tauri (Rust) shell: window, native file dialogs, filesystem
```

### Sending a change

1. Fork the repo and create a branch (`git checkout -b my-change`).
2. Make your change. Please keep `npm run build` green — it typechecks the
   whole project.
3. Open a pull request describing what changed and why. Small, focused PRs are
   easiest to review.

Found a bug or have an idea? Open an issue — that's a contribution too.

## License

MIT
