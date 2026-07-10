import type { JSONContent } from '@tiptap/core'

export type FontKey = 'sans' | 'serif' | 'mono'

export interface Page {
  id: string
  title: string
  /** Emoji icon, or null for the default document glyph. */
  icon: string | null
  /** Key into COVERS, or null for no cover. */
  cover: string | null
  parentId: string | null
  /** Position among siblings; normalized to 0..n on every reorder. */
  order: number
  font: FontKey
  content: JSONContent | null
  createdAt: number
  updatedAt: number
}
