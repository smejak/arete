import type { JSONContent } from '@tiptap/core'
import type { Page } from './types'

// Tiny builders for TipTap JSON so the seed reads like an outline.
const t = (text: string, ...marks: string[]): JSONContent =>
  marks.length ? { type: 'text', text, marks: marks.map(m => ({ type: m })) } : { type: 'text', text }
const code = (text: string) => t(text, 'code')
const bold = (text: string) => t(text, 'bold')
const italic = (text: string) => t(text, 'italic')
const hl = (text: string) => t(text, 'highlight')
const p = (...content: JSONContent[]): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
const h = (level: number, text: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
})
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [p(...content)] })
const ul = (...items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items })
const task = (checked: boolean, ...content: JSONContent[]): JSONContent => ({
  type: 'taskItem',
  attrs: { checked },
  content: [p(...content)],
})
const tasks = (...items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items })
const quote = (...content: JSONContent[]): JSONContent => ({ type: 'blockquote', content })
const hr: JSONContent = { type: 'horizontalRule' }
const callout = (emoji: string, ...content: JSONContent[]): JSONContent => ({
  type: 'callout',
  attrs: { emoji },
  content,
})
const codeblock = (text: string): JSONContent => ({ type: 'codeBlock', content: [t(text)] })
const pageLink = (pageId: string): JSONContent => ({ type: 'pageLink', attrs: { pageId } })
const mention = (pageId: string): JSONContent => ({ type: 'pageMention', attrs: { pageId } })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

export function buildSeed(): {
  pages: Record<string, Page>
  activePageId: string
  expanded: Record<string, boolean>
} {
  const welcomeId = crypto.randomUUID()
  const cheatsheetId = crypto.randomUUID()
  const sidebarId = crypto.randomUUID()
  const notesId = crypto.randomUUID()
  const julyId = crypto.randomUUID()
  const now = Date.now()

  const make = (
    id: string,
    partial: Partial<Page> & Pick<Page, 'title'>,
  ): Page => ({
    id,
    icon: null,
    cover: null,
    parentId: null,
    order: 0,
    font: 'sans',
    content: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  })

  const welcome = make(welcomeId, {
    title: 'Welcome to Arete',
    icon: '🏔️',
    cover: 'alpenglow',
    content: doc(
      p(
        t(
          'A quiet home for your thinking. Every page lives on this machine — no accounts, no sync, no noise. Markdown becomes form the moment you type it.',
        ),
      ),
      callout(
        '🧭',
        p(
          t('Four moves to learn: type '),
          code('/'),
          t(' on any line for blocks, '),
          code('@'),
          t(' to mention another page, '),
          code('⌘K'),
          t(' to jump anywhere, and '),
          code('⌘\\'),
          t(' to tuck the sidebar away.'),
        ),
      ),
      h(2, 'Formatting, as you type'),
      p(t('There is no preview pane and no edit mode. Try any of these on the empty line at the bottom:')),
      ul(
        li(code('# '), t(' for a heading — '), code('## '), t(' and '), code('### '), t(' step down')),
        li(
          code('**bold**'),
          t(', '),
          code('*italic*'),
          t(', '),
          code('~~strike~~'),
          t(', '),
          code('`code`'),
          t(', '),
          code('==highlight=='),
        ),
        li(code('- '), t(' for bullets, '), code('1. '), t(' for numbers, '), code('[] '), t(' for to-dos')),
        li(code('> '), t(' for a toggle, '), code('" '), t(' for a quote, '), code('---'), t(' for a divider')),
      ),
      h(2, 'Leave a trail'),
      tasks(
        task(true, t('Skim this page')),
        task(false, t('Type '), code('/'), t(' below and insert something')),
        task(false, t('Make a word '), hl('glow'), t(' with '), code('==double equals==')),
        task(false, t('Create a subpage with '), code('/page')),
      ),
      quote(
        p(t('We are what we repeatedly do. Excellence, then, is not an act but a habit.')),
        p(italic('Will Durant, distilling Aristotle')),
      ),
      hr,
      h(2, 'Two short pages to get your bearings'),
      pageLink(cheatsheetId),
      pageLink(sidebarId),
      p(),
    ),
  })

  const cheatsheet = make(cheatsheetId, {
    title: 'Markdown cheatsheet',
    icon: '✏️',
    parentId: welcomeId,
    order: 0,
    content: doc(
      h(2, 'Inline'),
      ul(
        li(code('**text**'), t('  →  '), bold('bold')),
        li(code('*text*'), t('  →  '), italic('italic')),
        li(code('~~text~~'), t('  →  '), t('strike', 'strike')),
        li(code('`text`'), t('  →  '), code('code')),
        li(code('==text=='), t('  →  '), hl('alpenglow')),
      ),
      h(2, 'Blocks'),
      ul(
        li(code('#'), t(' '), code('##'), t(' '), code('###'), t('  — headings, then a space')),
        li(code('- '), t(' bullets · '), code('1. '), t(' numbered · '), code('[] '), t(' to-dos')),
        li(code('> '), t(' toggle · '), code('" '), t(' quote · '), code('---'), t(' divider · '), code('```'), t(' code block')),
        li(code('/'), t('  opens the block menu — callouts, dividers, new pages, and more')),
        li(code('@'), t('  mentions another page, right in the middle of a sentence')),
      ),
      h(2, 'Keys'),
      ul(
        li(code('⌘K'), t('  search and jump between pages')),
        li(code('⌘\\'), t('  show or hide the sidebar')),
        li(code('⌘B'), t(' '), code('⌘I'), t(' '), code('⌘U'), t('  style selected text')),
      ),
      codeblock(
        '// the shortest way over the mountain\nconst arete = (peaks: number[]) =>\n  peaks.reduce((line, peak) => Math.max(line, peak), 0)',
      ),
      p(),
    ),
  })

  const sidebarPage = make(sidebarId, {
    title: 'How pages nest',
    icon: '🗂️',
    parentId: welcomeId,
    order: 1,
    content: doc(
      p(t('Pages hold pages. Shape the tree however your thinking runs:')),
      ul(
        li(t('Hover a page in the sidebar and press '), bold('+'), t(' to tuck a new page inside it.')),
        li(t('Drag a page onto another to nest it — or between rows to reorder.')),
        li(t('Click '), bold('⋯'), t(' to rename, favorite, duplicate, or delete a page.')),
        li(t('Favorites pin a page above the tree, wherever it lives.')),
      ),
      callout(
        '🏔️',
        p(
          t('This page lives inside '),
          mention(welcomeId),
          t(' — the breadcrumb up top always shows the path back. Mentions like that one are made by typing '),
          code('@'),
          t('.'),
        ),
      ),
      p(),
    ),
  })

  const notes = make(notesId, {
    title: 'Field notes',
    icon: '🌲',
    order: 1,
    font: 'serif',
    content: doc(
      p(
        t(
          'Loose thoughts, kept close. This page is set in the serif face — switch any page between Default, Serif, and Mono from the ',
        ),
        bold('⋯'),
        t(' menu, top right.'),
      ),
      p(),
    ),
  })

  const july = make(julyId, {
    title: 'July 2026',
    icon: '☀️',
    parentId: notesId,
    order: 0,
    font: 'serif',
    content: doc(
      h(3, 'Wednesday, July 9'),
      ul(li(t('Moved the workspace into Arete — everything local, everything fast.'))),
      tasks(task(false, t('Sketch tomorrow’s outline'))),
      p(),
    ),
  })

  return {
    pages: {
      [welcomeId]: welcome,
      [cheatsheetId]: cheatsheet,
      [sidebarId]: sidebarPage,
      [notesId]: notes,
      [julyId]: july,
    },
    activePageId: welcomeId,
    expanded: { ['main:' + welcomeId]: true },
  }
}
