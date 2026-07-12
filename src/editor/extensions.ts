import StarterKit from '@tiptap/starter-kit'
import Blockquote from '@tiptap/extension-blockquote'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Typography from '@tiptap/extension-typography'
import { Extension, wrappingInputRule, type Extensions } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { Callout } from './nodes/Callout'
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

/** `>` belongs to toggles now (like Notion), so quotes wrap on `"` instead —
 * matching both the straight quote and the curly one Typography makes of it. */
const QuoteBlock = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“]\s$/, type: this.type })]
  },
})

/** Backspace on an empty paragraph that sits right after a list removes the
 * paragraph and lands at the end of the list — instead of ProseMirror's
 * default join, which re-wraps the line into a bullet you then have to
 * delete a second time. */
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
          if (!['bulletList', 'orderedList', 'taskList'].includes(prev.type.name)) return false
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
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    QuoteBlock,
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node, editor, pos }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        if (node.type.name !== 'paragraph') return ''
        const $pos = editor.state.doc.resolve(pos)
        const parentName = $pos.parent.type.name
        if (parentName !== 'doc') return ''
        return placeholder
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Highlight,
    Underline,
    Typography.configure({ emDash: false }),
    Callout,
    Toggle,
    ImageBlock,
    HtmlBlock,
    MediaPaste,
    MathInline,
    MathBlock,
    ListEscape,
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
      dropcursor: { color: 'var(--accent)', width: 2.5 },
    }),
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
    TaskList,
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
    DatabaseBlock,
    ImageBlock,
    HtmlBlock,
    MediaPaste,
    PageLink,
    PageMention,
    MathInline,
    MathBlock,
    CardRefMark,
    TrailingNode,
    ListEscape,
    BlockSelect,
    ...(opts.slash ? [SlashCommand.configure({ suggestion: opts.slash })] : []),
    ...(opts.mention ? [MentionCommand.configure({ suggestion: opts.mention })] : []),
  ]
}
