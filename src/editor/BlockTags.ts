import { Extension } from '@tiptap/core'
import { TAGGABLE } from '../lib/tags'

/**
 * `tags` and `blockId` on every block that can carry them.
 *
 * A global attribute rather than a wrapper node: the tags belong to the
 * paragraph, not to a container around it, so nothing about the document's
 * shape changes and every existing command still works on a tagged block.
 *
 * `blockId` is minted lazily — only once a block joins an ordered group, where
 * "third in the sequence" has to survive the words being rewritten. Tagging
 * alone does not earn one, so an untagged vault stays exactly as it was on
 * disk and a merely-tagged block costs one readable comment.
 */
export const BlockTags = Extension.create({
  name: 'blockTags',

  addGlobalAttributes() {
    return [
      {
        types: [...TAGGABLE],
        attributes: {
          tags: {
            default: null,
            rendered: false,
            parseHTML: el => {
              const raw = (el as HTMLElement).getAttribute('data-tags')
              return raw ? raw.split(',').filter(Boolean) : null
            },
          },
          blockId: {
            default: null,
            rendered: false,
            parseHTML: el => (el as HTMLElement).getAttribute('data-block-id'),
          },
        },
      },
    ]
  },
})
