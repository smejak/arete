import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { useStore } from '../store/store'
import { colorOf, kindOf, newBlockId, normalizeTag, tagUsage, TAGGABLE, type TagKind } from '../lib/tags'
import { cx } from '../lib/util'

/**
 * The tags on one block, inside its handle menu.
 *
 * Typing offers what the vault already uses before it offers to invent
 * something — a vocabulary is only useful if the same idea keeps landing on
 * the same word, and the fastest way to get there is to make reuse the
 * shortest path.
 */
export function BlockTagRow({
  editor,
  pos,
  onOpenGroup,
}: {
  editor: Editor
  pos: number
  onOpenGroup: (tag: string) => void
}) {
  const pages = useStore(s => s.pages)
  const registry = useStore(s => s.tagRegistry)
  const setTagKind = useStore(s => s.setTagKind)
  const [draft, setDraft] = useState('')
  /** What a NEW tag would be. Always on screen, because it decides something
   * permanent and a control that appears mid-typing is one you meet too late. */
  const [newKind, setNewKind] = useState<TagKind>('category')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const node = editor.state.doc.nodeAt(pos)
  const tags: string[] = useMemo(() => (node?.attrs.tags as string[] | undefined) ?? [], [node])

  const usage = useMemo(() => tagUsage(pages), [pages])
  // Everything on focus, narrowing as you type. The list floats out of the
  // field rather than sitting in the menu: a vault with a hundred tags must
  // not make the handle menu a hundred rows tall.
  const suggestions = useMemo(() => {
    const q = normalizeTag(draft)
    return [...usage.entries()]
      .filter(([name]) => !tags.includes(name) && (!q || name.includes(q)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, n }))
  }, [usage, draft, tags])

  if (!node || !TAGGABLE.has(node.type.name)) return null

  const write = (next: string[]) => {
    const at = editor.state.doc.nodeAt(pos)
    if (!at) return
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...at.attrs,
        tags: next.length ? next : null,
        // The id is minted here rather than when a block first joins an
        // ordered group. Ordering needs it, every tag can become a group, and
        // the marker line the tag already writes makes the id cost eight more
        // characters — cheaper than a second concept for "taggable but not yet
        // orderable". It is still lazy: untagged blocks never get one.
        blockId: next.length ? ((at.attrs.blockId as string | null) ?? newBlockId()) : null,
      }),
    )
  }

  const add = (raw: string, kind?: TagKind) => {
    const name = normalizeTag(raw)
    if (!name || tags.includes(name)) return
    // The kind is settled here and never again: a tag that changed sides
    // later would quietly change what every reference to it may do.
    if (kind) setTagKind(name, kind)
    write([...tags, name])
    setDraft('')
    inputRef.current?.focus()
  }

  const exact = normalizeTag(draft)
  const canCreate = exact && !usage.has(exact) && !tags.includes(exact)

  return (
    <div className="btag-row">
      <div className="menu-note">Tags</div>
      {tags.length > 0 && (
        <div className="btag-chips">
          {tags.map(name => (
            <span key={name} className={cx('db-chip', 'dbo-' + colorOf(registry, name))}>
              <button
                type="button"
                className="btag-open"
                title="Open this group"
                onClick={() => onOpenGroup(name)}
              >
                {name}
              </button>
              <button
                type="button"
                className="db-chip-x"
                title="Remove"
                onClick={() => write(tags.filter(t => t !== name))}
              >
                <X size={11} strokeWidth={2.4} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="btag-field">
      <input
        ref={inputRef}
        className="btag-input"
        value={draft}
        placeholder="Add a tag…"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            // The kind is already chosen above, so Enter can always commit —
            // an existing tag keeps its own kind and ignores the selector.
            add(draft, usage.has(normalizeTag(draft)) ? undefined : newKind)
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            write(tags.slice(0, -1))
          }
        }}
      />
      {focused && (suggestions.length > 0 || canCreate) && (
        // mousedown, not click: the field must keep focus long enough for the
        // choice to land, or blur closes the list out from under the pointer.
        <div className="btag-suggest" onMouseDown={e => e.preventDefault()}>
          {canCreate && (
            <button type="button" className="btag-sugg" onClick={() => add(exact, newKind)}>
              <span className="btag-new">Create</span>
              <span className="db-chip dbo-default">{exact}</span>
              <span className="btag-count">{newKind}</span>
            </button>
          )}
          {suggestions.map(s => (
            <button key={s.name} type="button" className="btag-sugg" onClick={() => add(s.name)}>
              <span className={cx('db-chip', 'dbo-' + colorOf(registry, s.name))}>{s.name}</span>
              {kindOf(registry, s.name) === 'group' && <span className="btag-is-group">group</span>}
              <span className="btag-count">{s.n}</span>
            </button>
          ))}
        </div>
      )}
      </div>

      <div className="btag-kindrow">
        <span className="btag-kindrow-label">New tag</span>
        <span className="btag-create-kinds">
          <button
            type="button"
            className={cx('btag-kind', newKind === 'category' && 'is-on')}
            title="A category finds one block among many"
            onClick={() => setNewKind('category')}
          >
            Category
          </button>
          <button
            type="button"
            className={cx('btag-kind', newKind === 'group' && 'is-on')}
            title="A group is referenced and pasted whole, in order"
            onClick={() => setNewKind('group')}
          >
            Group
          </button>
        </span>
      </div>

    </div>
  )
}
