import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { Image as ImageIcon, Smile } from 'lucide-react'
import { useStore } from '../store/store'
import { buildExtensions } from '../editor/extensions'
import { COVERS, randomCover } from '../lib/covers'
import { randomEmoji } from '../lib/emoji'
import { cx } from '../lib/util'
import { EmojiPicker } from './EmojiPicker'
import { CoverPicker } from './CoverPicker'
import { SlashMenu, useSuggestionMenu } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import type { SlashItem } from '../editor/SlashCommand'
import type { MentionEntry } from '../editor/MentionCommand'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Focus the editor body synchronously. TipTap's own focus() defers the DOM
 * focus to requestAnimationFrame, which loses keystrokes that arrive in the
 * same frame (e.g. pressing Enter in the title and typing straight on).
 */
function focusEditorAt(editor: Editor, where: 'start' | 'end') {
  const { state, view } = editor
  const selection = where === 'start' ? Selection.atStart(state.doc) : Selection.atEnd(state.doc)
  view.dispatch(state.tr.setSelection(selection).scrollIntoView())
  view.focus()
}

export function PageView({ pageId }: { pageId: string }) {
  const page = useStore(s => s.pages[pageId])
  const updateTitle = useStore(s => s.updateTitle)
  const setIcon = useStore(s => s.setIcon)
  const setCover = useStore(s => s.setCover)
  const pendingFocusId = useStore(s => s.pendingFocusId)
  const clearPendingFocus = useStore(s => s.clearPendingFocus)

  const [title, setTitle] = useState(page?.title ?? '')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null)
  const [coverPicker, setCoverPicker] = useState<DOMRect | null>(null)

  const [slashView, slashSuggestion] = useSuggestionMenu<SlashItem>()
  const [mentionView, mentionSuggestion] = useSuggestionMenu<MentionEntry>()
  const initialContent = useRef(page?.content ?? EMPTY_DOC).current
  const extensions = useMemo(
    () => buildExtensions({ slash: slashSuggestion, mention: mentionSuggestion }),
    [slashSuggestion, mentionSuggestion],
  )

  const jsonRef = useRef<JSONContent | null>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)

  const editor = useEditor({
    extensions,
    content: initialContent,
    autofocus: false,
    onUpdate: ({ editor }) => {
      jsonRef.current = editor.getJSON()
      dirtyRef.current = true
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        if (dirtyRef.current && jsonRef.current) {
          dirtyRef.current = false
          useStore.getState().updateContent(pageId, jsonRef.current)
        }
      }, 400)
    },
  })

  // Flush any unsaved edits when navigating away.
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      if (dirtyRef.current && jsonRef.current) {
        dirtyRef.current = false
        useStore.getState().updateContent(pageId, jsonRef.current)
      }
    },
    [pageId],
  )

  // Auto-grow the title as it wraps.
  useLayoutEffect(() => {
    const el = titleRef.current
    if (el) {
      el.style.height = '0px'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [title])

  // Newly created (or renamed) pages drop the caret straight into the title.
  useEffect(() => {
    if (pendingFocusId === pageId && titleRef.current) {
      const el = titleRef.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      clearPendingFocus()
    }
  }, [pendingFocusId, pageId, clearPendingFocus])

  if (!page) return null
  const cover = page.cover ? COVERS[page.cover] : null

  const onTitleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (editor) focusEditorAt(editor, 'start')
    } else if (e.key === 'ArrowDown') {
      const el = e.currentTarget
      if (el.selectionStart === el.value.length) {
        e.preventDefault()
        if (editor) focusEditorAt(editor, 'start')
      }
    }
  }

  // Clicking the space under the last block keeps writing, like Notion.
  const onTailDown = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!editor) return
    const last = editor.state.doc.lastChild
    const lastIsEmptyParagraph = last?.type.name === 'paragraph' && last.content.size === 0
    if (!lastIsEmptyParagraph) {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' })
    }
    focusEditorAt(editor, 'end')
  }

  return (
    <div className="page-scroll">
      {cover && (
        <div className="page-cover" style={{ background: cover.css }}>
          <button
            type="button"
            className="cover-change"
            onClick={e => setCoverPicker(e.currentTarget.getBoundingClientRect())}
          >
            Change cover
          </button>
        </div>
      )}

      <div className={cx('page', 'font-' + page.font, cover && 'has-cover')}>
        <div className="page-head">
          {page.icon && (
            <button
              type="button"
              className="page-icon"
              title="Change icon"
              onClick={e => setIconPicker(e.currentTarget.getBoundingClientRect())}
            >
              {page.icon}
            </button>
          )}
          <div className="page-controls">
            {!page.icon && (
              <button
                type="button"
                className="ghost-control"
                onClick={() => setIcon(page.id, randomEmoji())}
              >
                <Smile size={14} strokeWidth={1.8} />
                Add icon
              </button>
            )}
            {!page.cover && (
              <button
                type="button"
                className="ghost-control"
                onClick={() => setCover(page.id, randomCover())}
              >
                <ImageIcon size={14} strokeWidth={1.8} />
                Add cover
              </button>
            )}
          </div>
          <textarea
            ref={titleRef}
            className="page-title"
            rows={1}
            value={title}
            placeholder="Untitled"
            spellCheck={false}
            onChange={e => {
              setTitle(e.target.value)
              updateTitle(page.id, e.target.value)
            }}
            onKeyDown={onTitleKey}
          />
        </div>

        <EditorContent editor={editor} />
        <div className="editor-tail" onMouseDown={onTailDown} />
      </div>

      {slashView && <SlashMenu view={slashView} />}
      {mentionView && <MentionMenu view={mentionView} />}

      {iconPicker && (
        <EmojiPicker
          anchor={iconPicker}
          allowRemove
          onClose={() => setIconPicker(null)}
          onPick={emoji => {
            setIcon(page.id, emoji)
            setIconPicker(null)
          }}
        />
      )}
      {coverPicker && (
        <CoverPicker
          anchor={coverPicker}
          align="end"
          onClose={() => setCoverPicker(null)}
          onPick={key => {
            setCover(page.id, key)
            setCoverPicker(null)
          }}
        />
      )}
    </div>
  )
}
