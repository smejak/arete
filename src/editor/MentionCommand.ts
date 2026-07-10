import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import type { Page } from '../store/types'
import { useStore } from '../store/store'

export type MentionEntry =
  | { id: string; type: 'page'; page: Page }
  | { id: string; type: 'create'; title: string }

export function filterMentionPages(query: string): MentionEntry[] {
  // Spaces are allowed while mentioning, so a runaway query (the user just
  // kept writing their sentence) must dismiss the menu rather than chase it.
  if (query.length > 48 || query.trim().split(/\s+/).length > 5) return []

  const pages = Object.values(useStore.getState().pages)
  const q = query.toLowerCase().trim()

  let matches: Page[]
  if (!q) {
    matches = [...pages].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 7)
  } else {
    matches = pages
      .map(p => {
        const title = (p.title || 'Untitled').toLowerCase()
        let s = 0
        if (title.startsWith(q)) s = 3
        else if (title.split(/\s+/).some(w => w.startsWith(q))) s = 2
        else if (title.includes(q)) s = 1
        return { p, s }
      })
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || b.p.updatedAt - a.p.updatedAt)
      .map(x => x.p)
      .slice(0, 7)
  }

  const entries: MentionEntry[] = matches.map(p => ({ id: p.id, type: 'page', page: p }))
  const title = query.trim()
  if (title && !matches.some(p => (p.title || 'Untitled').toLowerCase() === q)) {
    entries.push({ id: '__create__', type: 'create', title })
  }
  return entries
}

/**
 * Notion-style @ mentions: type `@` mid-sentence to reference a page inline,
 * or create one on the spot. Emails ("name@host") don't trigger it — the
 * suggestion plugin only fires after whitespace or at the start of a line.
 */
export const MentionCommand = Extension.create<{
  suggestion: Partial<SuggestionOptions<MentionEntry>>
}>({
  name: 'mentionCommand',

  addOptions() {
    return { suggestion: {} }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<MentionEntry>({
        editor: this.editor,
        char: '@',
        allowSpaces: true, // page titles have spaces — "@field notes" must keep matching
        startOfLine: false,
        pluginKey: new PluginKey('mentionSuggestion'),
        command: ({ editor, range, props }) => {
          let pageId: string
          if (props.type === 'create') {
            const store = useStore.getState()
            pageId = store.createPage({
              parentId: store.activePageId,
              title: props.title,
              navigate: false,
            })
          } else {
            pageId = props.page.id
          }
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'pageMention', attrs: { pageId } },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        items: ({ query }) => filterMentionPages(query),
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        ...this.options.suggestion,
      }),
    ]
  },
})
