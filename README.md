# Arete

Spaced repetition software can be a powerful tool for creating a context in which to think.

I have found spaced repetition works best when it is closely tied to what I'm working on.

Arete is a workspace that combines note-taking with spaced repetition.

## Getting started

1. **Download the app.** It's free, all your files are local, and no data ever
   leaves your computer.
   [Download the latest `.dmg`](https://github.com/smejak/arete/releases/latest/download/Arete.dmg),
   or browse all [releases](https://github.com/smejak/arete/releases).
   *(The beta is unsigned — on first launch, right-click the app and choose
   Open. Apple Silicon macOS. Arete also runs fully local in Chrome and Edge.)*
2. **Create a new folder, or port over your existing notes.** Arete notes are
   plain `.md` files — pick any folder and it becomes your vault. Coming from
   Notion? Export as Markdown & CSV, unzip, and open that folder.
3. **Start using Arete.** To create a card, highlight a piece of text in your
   notes and right-click.

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
from — open a card's **Refs** to jump back to the exact passages it came from.

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
  components/   UI — editor page, review, cards, insights, sidebar, tabs
  editor/       TipTap extensions (slash menu, @mentions, math, card refs, block handle)
  store/        Zustand state (pages, cards + FSRS logs, clock)
  lib/          srs (FSRS wrapper), vault + markdown (folder sync), history, share
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
