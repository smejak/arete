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
import { TrailingNode } from './TrailingNode'
import { SlashCommand, type SlashItem } from './SlashCommand'
import { MentionCommand, type MentionEntry } from './MentionCommand'

export function buildExtensions(opts: {
  slash: Partial<SuggestionOptions<SlashItem>>
  mention: Partial<SuggestionOptions<MentionEntry>>
}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: 'var(--accent)', width: 2.5 },
    }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
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
    TrailingNode,
    SlashCommand.configure({ suggestion: opts.slash }),
    MentionCommand.configure({ suggestion: opts.mention }),
  ]
}
