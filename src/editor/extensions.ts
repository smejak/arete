import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Typography from '@tiptap/extension-typography'
import type { Extensions } from '@tiptap/core'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { Callout } from './nodes/Callout'
import { PageLink } from './nodes/PageLink'
import { PageMention } from './nodes/PageMention'
import { MathBlock, MathInline } from './nodes/Math'
import { CardRefMark } from './marks/CardRef'
import { TrailingNode } from './TrailingNode'
import { SlashCommand, type SlashItem } from './SlashCommand'
import { MentionCommand, type MentionEntry } from './MentionCommand'

/** Compact schema for flashcard fronts/backs: the same live-markdown feel as
 * pages (marks, lists, code, KaTeX) without page-level machinery. */
export function buildCardExtensions(placeholder: string): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'paragraph' ? placeholder : ''),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Highlight,
    Underline,
    Typography.configure({ emDash: false }),
    MathInline,
    MathBlock,
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
      dropcursor: { color: 'var(--accent)', width: 2.5 },
    }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ editor, node, pos }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        // Containers (blockquote, list items, callouts) also receive the
        // is-empty decoration; only their inner paragraph should carry text —
        // and a short label, so it never overflows tight flex layouts.
        if (node.type.name !== 'paragraph') return ''
        const parentName = editor.state.doc.resolve(pos).parent.type.name
        if (parentName === 'listItem') return 'List item'
        if (parentName === 'taskItem') return 'To-do'
        if (parentName === 'blockquote') return 'Quote'
        if (parentName === 'callout') return 'Note'
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
    PageLink,
    PageMention,
    MathInline,
    MathBlock,
    CardRefMark,
    TrailingNode,
    ...(opts.slash ? [SlashCommand.configure({ suggestion: opts.slash })] : []),
    ...(opts.mention ? [MentionCommand.configure({ suggestion: opts.mention })] : []),
  ]
}
