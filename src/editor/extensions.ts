import StarterKit from '@tiptap/starter-kit'
import Blockquote from '@tiptap/extension-blockquote'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Typography from '@tiptap/extension-typography'
import { Extension, wrappingInputRule, type Extensions } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { Callout } from './nodes/Callout'
import { Footnote } from './nodes/Footnote'
import { Toggle } from './nodes/Toggle'
import { DatabaseBlock } from './nodes/DatabaseBlock'
import { HtmlBlock, ImageBlock, MediaPaste } from './nodes/Media'
import { BlockSelect } from './BlockSelect'
import { PageLink } from './nodes/PageLink'
import { PageMention } from './nodes/PageMention'
import { MathBlock, MathInline } from './nodes/Math'
import { CardRefMark } from './marks/CardRef'
import { TrailingNode } from './TrailingNode'
import { CARD_SLASH_EXCLUDE, filterSlashItems, SlashCommand, type SlashItem } from './SlashCommand'
import { MentionCommand, type MentionEntry } from './MentionCommand'
import { ListIndent } from './ListIndent'

/** Lists may nest DIRECTLY inside lists (no parent bullet required), so any
 * bullet can be Tab-indented — including the first one — and an indented
 * run survives without a bullet above it. ListIndent supplies the keys. */
const NestingBulletList = BulletList.extend({
  content: '(listItem | bulletList | orderedList | taskList)+',
})
const NestingOrderedList = OrderedList.extend({
  content: '(listItem | bulletList | orderedList | taskList)+',
})
const NestingTaskList = TaskList.extend({
  content: '(taskItem | bulletList | orderedList | taskList)+',
})

/** `>` belongs to toggles now (like Notion), so quotes wrap on `"` instead —
 * matching both the straight quote and the curly one Typography makes of it. */
const QuoteBlock = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“]\s$/, type: this.type })]
  },
})

/** Backspace on an empty paragraph that sits right after any structured
 * block (list, toggle, callout, image, …) removes the paragraph and lands at
 * the end of that block — instead of ProseMirror's defaults, which re-wrap
 * the line into a bullet after lists, or silently node-select the block so
 * the SECOND press deletes it (Jakub hit this with collapsed toggles).
 * Plain textblocks (paragraphs, headings, code) keep the native join. */
const ListEscape = Extension.create({
  name: 'listEscape',
  addKeyboardShortcuts() {
    return {
      Backspace: () =>
        this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection
          if (!empty || $from.parentOffset !== 0 || $from.depth !== 1) return false
          const para = $from.parent
          if (para.type.name !== 'paragraph' || para.content.size !== 0) return false
          const idx = $from.index(0)
          if (idx === 0) return false
          const prev = state.doc.child(idx - 1)
          if (prev.isTextblock) return false
          if (dispatch) {
            const pos = $from.before(1)
            tr.delete(pos, pos + para.nodeSize)
            tr.setSelection(Selection.near(tr.doc.resolve(pos), -1)).scrollIntoView()
          }
          return true
        }),
    }
  },
})

const ITEM_TYPES = ['listItem', 'taskItem']

/** Enter at the very start of the LAST item of a top-level list, when nothing
 * but empty trailing paragraphs sit beneath it, lifts that item out into a
 * plain paragraph instead of splitting — so the closing line of a list can be
 * turned back into ordinary text (otherwise there's no clean way to). The
 * default split (a fresh empty bullet above) still runs everywhere else,
 * including the SAME caret position on a middle item, which must keep splitting.
 * Priority beats StarterKit's `Enter: splitListItem`; returning false elsewhere
 * falls straight back to it. */
const ListExitOnEnter = Extension.create({
  name: 'listExitOnEnter',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parentOffset !== 0) return false
        // Nearest enclosing list item; require it be TOP-LEVEL, i.e.
        // doc > list > item > paragraph, so the item sits at depth 2.
        let d = 0
        for (let i = $from.depth; i > 0; i--) {
          if (ITEM_TYPES.includes($from.node(i).type.name)) {
            d = i
            break
          }
        }
        if (d !== 2 || $from.depth !== d + 1 || $from.index(d) !== 0) return false
        // Only the list's LAST item delists — a middle item still splits.
        const list = $from.node(d - 1)
        if ($from.index(d - 1) !== list.childCount - 1) return false
        // Nothing but empty paragraphs (e.g. the trailing node) may follow the
        // list; real content beneath means a normal split is wanted instead.
        for (let i = $from.index(0) + 1; i < state.doc.childCount; i++) {
          const after = state.doc.child(i)
          if (after.type.name !== 'paragraph' || after.content.size > 0) return false
        }
        return this.editor.commands.liftListItem($from.node(d).type.name)
      },
    }
  },
})

/** Card fronts/backs are full Arete editors — every block a page can hold
 * (callouts, toggles, images, HTML embeds, KaTeX, slash menu) except the
 * page-coupled machinery: databases, subpages, mentions, card refs. */
export function buildCardExtensions(
  placeholder: string,
  opts: { slash?: Partial<SuggestionOptions<SlashItem>> } = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      bulletList: false,
      orderedList: false,
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    NestingBulletList,
    NestingOrderedList,
    QuoteBlock,
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node, editor, pos }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        if (node.type.name !== 'paragraph') return ''
        const $pos = editor.state.doc.resolve(pos)
        const parentName = $pos.parent.type.name
        if (parentName !== 'doc') return ''
        // Only the first top-level line carries the field's prompt. Empty lines
        // below it stay blank, so the (long) placeholder can't reappear while
        // you're mid-write and overflow the box.
        if (pos !== 0) return ''
        return placeholder
      },
    }),
    NestingTaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Highlight,
    Underline,
    Typography.configure({ emDash: false }),
    Callout,
    Toggle,
    // Simple (markdown) tables — not resizable: colwidths have no home in the
    // GFM round-trip, so any dragged width would silently vanish on reload.
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ImageBlock,
    HtmlBlock,
    MediaPaste,
    MathInline,
    MathBlock,
    // Schema-complete so `^[…]` in card markdown parses (rendered as an
    // inert numbered sup — the margin presentation belongs to pages).
    Footnote,
    ListEscape,
    ListExitOnEnter,
    ListIndent,
    ...(opts.slash
      ? [SlashCommand.configure({ suggestion: { items: ({ query }) => filterSlashItems(query, CARD_SLASH_EXCLUDE), ...opts.slash } })]
      : []),
  ]
}

/** Suggestion configs are optional so read-only surfaces (history previews)
 * can reuse the exact same schema without menu plumbing. */
export function buildExtensions(
  opts: {
    slash?: Partial<SuggestionOptions<SlashItem>>
    mention?: Partial<SuggestionOptions<MentionEntry>>
  } = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      bulletList: false,
      orderedList: false,
      dropcursor: { color: 'var(--accent)', width: 2.5 },
    }),
    NestingBulletList,
    NestingOrderedList,
    QuoteBlock,
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ editor, node, pos }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        // Containers (blockquote, list items, callouts) also receive the
        // is-empty decoration; only their inner paragraph should carry text —
        // and a short label, so it never overflows tight flex layouts.
        if (node.type.name !== 'paragraph') return ''
        const $pos = editor.state.doc.resolve(pos)
        const parentName = $pos.parent.type.name
        if (parentName === 'listItem') return 'List item'
        if (parentName === 'taskItem') return 'To-do'
        if (parentName === 'blockquote') return 'Quote'
        if (parentName === 'callout') return 'Note'
        if (parentName === 'toggle') return $pos.index() === 0 ? 'Toggle' : ''
        return 'Write, or press "/" for blocks…'
      },
    }),
    NestingTaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer' },
    }),
    Highlight,
    Underline,
    // Smart quotes and ellipses stay; the dash rules are disabled so a plain
    // `---` still becomes a divider.
    Typography.configure({ emDash: false }),
    Callout,
    Toggle,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    DatabaseBlock,
    ImageBlock,
    HtmlBlock,
    MediaPaste,
    PageLink,
    PageMention,
    MathInline,
    MathBlock,
    Footnote,
    CardRefMark,
    TrailingNode,
    ListEscape,
    ListExitOnEnter,
    ListIndent,
    BlockSelect,
    ...(opts.slash ? [SlashCommand.configure({ suggestion: opts.slash })] : []),
    ...(opts.mention ? [MentionCommand.configure({ suggestion: opts.mention })] : []),
  ]
}
