import { Extension, type Editor, type Range } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  ListTodo,
  List,
  ListOrdered,
  TextQuote,
  Minus,
  Lightbulb,
  Sigma,
  Radical,
  SquareCode,
  FilePlus2,
  Link as LinkIcon,
  type LucideIcon,
} from 'lucide-react'
import { pagePick, useStore } from '../store/store'

export interface SlashItem {
  id: string
  title: string
  description: string
  icon: LucideIcon
  keywords: string[]
  section: 'Blocks' | 'Pages'
  run: (editor: Editor, range: Range) => void
}

/**
 * Delete the trigger text, then insert a block node. If the caret sits in an
 * empty top-level paragraph, the paragraph itself is replaced (no stray empty
 * line above the inserted block). Optionally place the caret `selectOffset`
 * positions into the inserted content.
 */
export function insertBlock(
  editor: Editor,
  range: Range,
  content: JSONContent,
  selectOffset?: number,
) {
  editor.chain().focus().deleteRange(range).run()
  const sel = editor.state.selection
  const { $from } = sel
  const replaceParagraph =
    $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
  const from = replaceParagraph ? $from.before() : sel.from
  const to = replaceParagraph ? $from.after() : sel.from
  editor.chain().insertContentAt({ from, to }, content).run()
  if (selectOffset != null) {
    editor.chain().setTextSelection(from + selectOffset).focus().run()
  }
}

const ITEMS: SlashItem[] = [
  {
    id: 'text',
    title: 'Text',
    description: 'Plain paragraph',
    icon: Type,
    keywords: ['paragraph', 'plain', 'p'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large section heading',
    icon: Heading1,
    keywords: ['h1', 'title', '#'],
    section: 'Blocks',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: Heading2,
    keywords: ['h2', 'subtitle', '##'],
    section: 'Blocks',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small section heading',
    icon: Heading3,
    keywords: ['h3', '###'],
    section: 'Blocks',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    description: 'Track tasks with checkboxes',
    icon: ListTodo,
    keywords: ['task', 'checkbox', 'check', 'todo'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    description: 'Simple list with bullets',
    icon: List,
    keywords: ['unordered', 'ul', 'bullet', '-'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    description: 'List with numbering',
    icon: ListOrdered,
    keywords: ['ordered', 'ol', 'numbers', '1.'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Set a line apart',
    icon: TextQuote,
    keywords: ['blockquote', 'citation', '>'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'callout',
    title: 'Callout',
    description: 'Emphasized block with an emoji',
    icon: Lightbulb,
    keywords: ['hint', 'aside', 'note', 'info'],
    section: 'Blocks',
    run: (editor, range) =>
      insertBlock(
        editor,
        range,
        { type: 'callout', attrs: { emoji: '💡' }, content: [{ type: 'paragraph' }] },
        2,
      ),
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'A quiet ridgeline between sections',
    icon: Minus,
    keywords: ['hr', 'rule', 'separator', 'line', '---'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Monospaced, verbatim',
    icon: SquareCode,
    keywords: ['snippet', 'pre', '```'],
    section: 'Blocks',
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'math-block',
    title: 'Equation',
    description: 'Display LaTeX, KaTeX-rendered',
    icon: Sigma,
    keywords: ['latex', 'math', 'katex', '$$', 'formula'],
    section: 'Blocks',
    run: (editor, range) => insertBlock(editor, range, { type: 'mathBlock', attrs: { latex: '' } }),
  },
  {
    id: 'math-inline',
    title: 'Inline equation',
    description: 'Math that flows with text',
    icon: Radical,
    keywords: ['latex', 'math', '$', 'inline'],
    section: 'Blocks',
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'mathInline', attrs: { latex: '' } }).run(),
  },
  {
    id: 'page',
    title: 'New subpage',
    description: 'Create a page inside this one',
    icon: FilePlus2,
    keywords: ['subpage', 'child', 'nest', 'new'],
    section: 'Pages',
    run: (editor, range) => {
      const store = useStore.getState()
      const id = store.createPage({ parentId: store.activePageId, navigate: false })
      insertBlock(editor, range, { type: 'pageLink', attrs: { pageId: id, owner: true } })
      // Navigate after the transaction settles so the editor unmounts cleanly.
      requestAnimationFrame(() => useStore.getState().openPage(id, { focusTitle: true }))
    },
  },
  {
    id: 'link-page',
    title: 'Link to page',
    description: 'Point at an existing page',
    icon: LinkIcon,
    keywords: ['mention', 'reference', 'existing'],
    section: 'Pages',
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run()
      pagePick.current = pageId => {
        const sel = editor.state.selection
        insertBlock(editor, { from: sel.from, to: sel.to }, { type: 'pageLink', attrs: { pageId } })
      }
      useStore.getState().setSearchOpen(true)
    },
  },
]

export function filterSlashItems(query: string): SlashItem[] {
  // Spaces are allowed ("/code block"), so hide once the query stops looking
  // like a block name and starts looking like a sentence.
  if (query.length > 24 || query.trim().split(/\s+/).length > 3) return []

  const q = query.toLowerCase().trim()
  if (!q) return ITEMS
  const score = (item: SlashItem): number => {
    const title = item.title.toLowerCase()
    if (title.startsWith(q)) return 4
    if (item.keywords.some(k => k.startsWith(q))) return 3
    if (title.includes(q)) return 2
    if (item.keywords.some(k => k.includes(q)) || item.description.toLowerCase().includes(q)) return 1
    return 0
  }
  const matched = ITEMS.map(item => ({ item, s: score(item) }))
    .filter(m => m.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(m => m.item)
  // Keep sections contiguous so the menu labels stay clean.
  return [...matched.filter(i => i.section === 'Blocks'), ...matched.filter(i => i.section === 'Pages')]
}

export const SlashCommand = Extension.create<{
  suggestion: Partial<SuggestionOptions<SlashItem>>
}>({
  name: 'slashCommand',

  addOptions() {
    return { suggestion: {} }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: true,
        startOfLine: false,
        // Each suggestion plugin needs its own key — the mention plugin
        // would otherwise collide with this one.
        pluginKey: new PluginKey('slashSuggestion'),
        command: ({ editor, range, props }) => props.run(editor, range),
        items: ({ query }) => filterSlashItems(query),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return !$from.parent.type.spec.code
        },
        ...this.options.suggestion,
      }),
    ]
  },
})
