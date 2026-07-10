import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * Invisible mark tying a span of text to a flashcard (and one highlight
 * "ref" within it). Multiple cards may reference overlapping text, so the
 * mark excludes nothing and stacks. Rendering is styled only while flashing.
 */
export const CardRefMark = Mark.create({
  name: 'cardref',
  excludes: '',
  inclusive: false,

  addAttributes() {
    return {
      cardId: { default: null },
      refId: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-card]',
        getAttrs: el => ({
          cardId: (el as HTMLElement).dataset.card ?? null,
          refId: (el as HTMLElement).dataset.ref ?? null,
        }),
      },
    ]
  },

  renderHTML({ mark, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-card': mark.attrs.cardId,
        'data-ref': mark.attrs.refId,
        class: 'cardref',
      }),
      0,
    ]
  },
})
