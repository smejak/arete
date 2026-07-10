import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  Bold,
  Code,
  Copy,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Lightbulb,
  List,
  ListOrdered,
  ListTodo,
  Smile,
  Sparkles,
  SquareCode,
  Strikethrough,
  TextQuote,
  Trash2,
  Type,
  Underline,
} from 'lucide-react'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { buildExtensions } from '../editor/extensions'
import { BlockHandle } from '../editor/BlockHandle'
import { COVERS, randomCover } from '../lib/covers'
import { randomEmoji } from '../lib/emoji'
import { cx } from '../lib/util'
import { recordPageVersion } from '../lib/history'
import { applyCardRefMark, flashCardRefs, removeCardRefMarks } from '../lib/refs'
import { EmojiPicker } from './EmojiPicker'
import { CoverPicker } from './CoverPicker'
import { SlashMenu, useSuggestionMenu } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import { Menu, Popover } from './Popover'
import { CardComposer, parseTags, type CardDraft } from './CardComposer'
import type { SlashItem } from '../editor/SlashCommand'
import type { MentionEntry } from '../editor/MentionCommand'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/** Subpage blocks owned by this doc (created via /page). */
function scanOwnedPages(doc: PMNode): Set<string> {
  const owned = new Set<string>()
  doc.descendants(node => {
    if (node.type.name === 'pageLink' && node.attrs.owner && node.attrs.pageId) {
      owned.add(node.attrs.pageId as string)
    }
  })
  return owned
}

const TURN_INTO: { title: string; icon: typeof Bold; run: (e: Editor) => void }[] = [
  { title: 'Text', icon: Type, run: e => e.chain().focus().clearNodes().run() },
  { title: 'Heading 1', icon: Heading1, run: e => e.chain().focus().clearNodes().setNode('heading', { level: 1 }).run() },
  { title: 'Heading 2', icon: Heading2, run: e => e.chain().focus().clearNodes().setNode('heading', { level: 2 }).run() },
  { title: 'Heading 3', icon: Heading3, run: e => e.chain().focus().clearNodes().setNode('heading', { level: 3 }).run() },
  { title: 'Bulleted list', icon: List, run: e => e.chain().focus().clearNodes().toggleBulletList().run() },
  { title: 'Numbered list', icon: ListOrdered, run: e => e.chain().focus().clearNodes().toggleOrderedList().run() },
  { title: 'To-do list', icon: ListTodo, run: e => e.chain().focus().clearNodes().toggleTaskList().run() },
  { title: 'Quote', icon: TextQuote, run: e => e.chain().focus().clearNodes().toggleBlockquote().run() },
  { title: 'Callout', icon: Lightbulb, run: e => e.chain().focus().clearNodes().wrapIn('callout').run() },
  { title: 'Code block', icon: SquareCode, run: e => e.chain().focus().clearNodes().toggleCodeBlock().run() },
]

const FORMATS: {
  name: string
  title: string
  icon: typeof Bold
  run: (editor: Editor) => void
}[] = [
  { name: 'bold', title: 'Bold (⌘B)', icon: Bold, run: e => e.chain().focus().toggleBold().run() },
  { name: 'italic', title: 'Italic (⌘I)', icon: Italic, run: e => e.chain().focus().toggleItalic().run() },
  { name: 'underline', title: 'Underline (⌘U)', icon: Underline, run: e => e.chain().focus().toggleUnderline().run() },
  { name: 'strike', title: 'Strikethrough (⌘⇧S)', icon: Strikethrough, run: e => e.chain().focus().toggleStrike().run() },
  { name: 'code', title: 'Code (⌘E)', icon: Code, run: e => e.chain().focus().toggleCode().run() },
  { name: 'highlight', title: 'Alpenglow highlight', icon: Highlighter, run: e => e.chain().focus().toggleHighlight().run() },
]

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

interface SelMenuState {
  at: { x: number; y: number }
  from: number
  to: number
  text: string
}

interface ComposerState {
  cardId: string
  refs: { refId: string; snapshot: string }[]
  top: number
  pageRight: number
}

export function PageView({ pageId }: { pageId: string }) {
  const page = useStore(s => s.pages[pageId])
  const updateTitle = useStore(s => s.updateTitle)
  const setIcon = useStore(s => s.setIcon)
  const setCover = useStore(s => s.setCover)
  const pendingFocusId = useStore(s => s.pendingFocusId)
  const clearPendingFocus = useStore(s => s.clearPendingFocus)
  const flash = useStore(s => s.flash)
  const clearFlash = useStore(s => s.clearFlash)

  const [title, setTitle] = useState(page?.title ?? '')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageElRef = useRef<HTMLDivElement>(null)
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null)
  const [coverPicker, setCoverPicker] = useState<DOMRect | null>(null)

  const [selMenu, setSelMenu] = useState<SelMenuState | null>(null)
  const [blockMenu, setBlockMenu] = useState<{ pos: number; at: DOMRect } | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [capturing, setCapturing] = useState(false)
  const composerRef = useRef<ComposerState | null>(null)
  composerRef.current = composer
  const createdRef = useRef(false)

  const [slashView, slashSuggestion] = useSuggestionMenu<SlashItem>()
  const [mentionView, mentionSuggestion] = useSuggestionMenu<MentionEntry>()
  const initialContent = useRef(page?.content ?? EMPTY_DOC).current
  const extensions = useMemo(
    () => [
      ...buildExtensions({ slash: slashSuggestion, mention: mentionSuggestion }),
      BlockHandle.configure({ onMenu: (pos, rect) => setBlockMenu({ pos, at: rect }) }),
    ],
    [slashSuggestion, mentionSuggestion],
  )

  const jsonRef = useRef<JSONContent | null>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)
  const histTimerRef = useRef<number | undefined>(undefined)
  const ownedRef = useRef<Set<string>>(new Set())
  const pendingOwnedDeleteRef = useRef<Map<string, number>>(new Map())

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
      // History versions mint on idle — a burst of typing coalesces into one.
      window.clearTimeout(histTimerRef.current)
      histTimerRef.current = window.setTimeout(() => {
        const p = useStore.getState().pages[pageId]
        if (p) recordPageVersion(p, 'idle')
      }, 5000)
      // Deleting an owning subpage block deletes the subpage itself, after a
      // short grace period so cut→paste and undo survive.
      const owned = scanOwnedPages(editor.state.doc)
      ownedRef.current.forEach(id => {
        if (!owned.has(id) && !pendingOwnedDeleteRef.current.has(id)) {
          const timer = window.setTimeout(() => {
            pendingOwnedDeleteRef.current.delete(id)
            const st = useStore.getState()
            if (st.pages[id] && st.pages[id].parentId === pageId) st.deletePage(id)
          }, 2500)
          pendingOwnedDeleteRef.current.set(id, timer)
        }
      })
      owned.forEach(id => {
        const timer = pendingOwnedDeleteRef.current.get(id)
        if (timer !== undefined) {
          window.clearTimeout(timer)
          pendingOwnedDeleteRef.current.delete(id)
        }
      })
      ownedRef.current = owned
    },
  })

  // Baseline set of owned subpage blocks, once the editor exists.
  useEffect(() => {
    if (editor) ownedRef.current = scanOwnedPages(editor.state.doc)
  }, [editor])

  // Navigating away with deletions still pending: apply them now.
  useEffect(
    () => () => {
      pendingOwnedDeleteRef.current.forEach((timer, id) => {
        window.clearTimeout(timer)
        const st = useStore.getState()
        if (st.pages[id] && st.pages[id].parentId === pageId) st.deletePage(id)
      })
      pendingOwnedDeleteRef.current.clear()
    },
    [pageId],
  )

  const flushContent = () => {
    window.clearTimeout(timerRef.current)
    if (dirtyRef.current && jsonRef.current) {
      dirtyRef.current = false
      useStore.getState().updateContent(pageId, jsonRef.current)
    }
  }

  // Flush unsaved edits + mint a history version when navigating away.
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      window.clearTimeout(histTimerRef.current)
      if (dirtyRef.current && jsonRef.current) {
        dirtyRef.current = false
        useStore.getState().updateContent(pageId, jsonRef.current)
      }
      const p = useStore.getState().pages[pageId]
      if (p) recordPageVersion(p, 'switch')
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

  // Arriving from a card's "Refs" link: flash every highlight for 5s. The
  // editor paints asynchronously after mount, so poll briefly until the
  // marked spans exist.
  useEffect(() => {
    if (!flash || flash.pageId !== pageId || !editor) return
    let tries = 0
    let timer: number
    const attempt = () => {
      const container = scrollRef.current
      const found = container ? flashCardRefs(container, flash.cardId) : false
      if (!found && tries++ < 25) {
        timer = window.setTimeout(attempt, 120)
      } else {
        clearFlash()
      }
    }
    timer = window.setTimeout(attempt, 60)
    return () => window.clearTimeout(timer)
  }, [flash, pageId, editor, clearFlash])

  // "Add another highlight": capture the next selection in the page.
  useEffect(() => {
    if (!capturing || !editor) return
    const dom = editor.view.dom
    let done = false // one capture per arming — double-click fires two mouseups
    const onUp = () => {
      window.setTimeout(() => {
        if (done) return
        const c = composerRef.current
        if (!c) return
        const { from, to } = editor.state.selection
        if (from === to) return
        const text = editor.state.doc.textBetween(from, to, '\n').trim()
        if (!text) return
        done = true
        const refId = crypto.randomUUID()
        applyCardRefMark(editor, from, to, c.cardId, refId)
        navigator.clipboard?.writeText(text).catch(() => {})
        setComposer(prev => prev && { ...prev, refs: [...prev.refs, { refId, snapshot: text }] })
        setCapturing(false)
      }, 0)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCapturing(false)
    }
    dom.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      dom.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [capturing, editor])

  // Abandoned composer (navigated away mid-compose): strip its orphan marks.
  useEffect(
    () => () => {
      const c = composerRef.current
      if (c && !createdRef.current && editor && !editor.isDestroyed) {
        removeCardRefMarks(editor, c.cardId)
      }
    },
    [editor],
  )

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

  // Right-click on selected text → card actions.
  const onEditorContextMenu = (e: React.MouseEvent) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const text = editor.state.doc.textBetween(from, to, '\n').trim()
    if (!text) return
    e.preventDefault()
    setSelMenu({ at: { x: e.clientX, y: e.clientY }, from, to, text })
  }

  const startCard = () => {
    if (!editor || !selMenu) return
    const cardId = crypto.randomUUID()
    const refId = crypto.randomUUID()
    applyCardRefMark(editor, selMenu.from, selMenu.to, cardId, refId)
    navigator.clipboard?.writeText(selMenu.text).catch(() => {})
    const coords = editor.view.coordsAtPos(Math.min(selMenu.to, editor.state.doc.content.size))
    const rect = pageElRef.current?.getBoundingClientRect()
    createdRef.current = false
    setComposer({
      cardId,
      refs: [{ refId, snapshot: selMenu.text }],
      top: coords.top,
      pageRight: rect?.right ?? window.innerWidth - 400,
    })
    setSelMenu(null)
  }

  const addSelectionToCard = () => {
    if (!editor || !selMenu || !composer) return
    const refId = crypto.randomUUID()
    applyCardRefMark(editor, selMenu.from, selMenu.to, composer.cardId, refId)
    navigator.clipboard?.writeText(selMenu.text).catch(() => {})
    setComposer(c => c && { ...c, refs: [...c.refs, { refId, snapshot: selMenu.text }] })
    setSelMenu(null)
    setCapturing(false)
  }

  // ----- block handle menu ops -----

  const blockMenuNode = blockMenu && editor ? editor.state.doc.nodeAt(blockMenu.pos) : null

  const turnBlockInto = (run: (e: Editor) => void) => {
    if (!editor || !blockMenu) return
    editor
      .chain()
      .focus()
      .setTextSelection(Math.min(blockMenu.pos + 1, editor.state.doc.content.size))
      .run()
    run(editor)
    setBlockMenu(null)
  }

  const duplicateBlock = () => {
    if (!editor || !blockMenu) return
    const node = editor.state.doc.nodeAt(blockMenu.pos)
    if (node) {
      editor.view.dispatch(editor.state.tr.insert(blockMenu.pos + node.nodeSize, node))
    }
    setBlockMenu(null)
  }

  const deleteBlock = () => {
    if (!editor || !blockMenu) return
    const node = editor.state.doc.nodeAt(blockMenu.pos)
    if (node) {
      editor.view.dispatch(editor.state.tr.delete(blockMenu.pos, blockMenu.pos + node.nodeSize))
      editor.view.focus()
    }
    setBlockMenu(null)
  }

  const cardFromBlock = () => {
    if (!editor || !blockMenu) return
    const node = editor.state.doc.nodeAt(blockMenu.pos)
    if (!node) return
    const text = node.isAtom
      ? node.type.name === 'mathBlock'
        ? `$$${node.attrs.latex}$$`
        : node.textContent
      : node.textBetween(0, node.content.size, '\n')
    const snapshot = (text || '').trim()
    if (!snapshot) {
      setBlockMenu(null)
      return
    }
    const cardId = crypto.randomUUID()
    const refId = crypto.randomUUID()
    if (!node.isAtom) {
      applyCardRefMark(editor, blockMenu.pos + 1, blockMenu.pos + node.nodeSize - 1, cardId, refId)
    }
    navigator.clipboard?.writeText(snapshot).catch(() => {})
    const dom = editor.view.nodeDOM(blockMenu.pos)
    const top = dom instanceof HTMLElement ? dom.getBoundingClientRect().top : blockMenu.at.top
    const rect = pageElRef.current?.getBoundingClientRect()
    createdRef.current = false
    setComposer({
      cardId,
      refs: [{ refId, snapshot }],
      top,
      pageRight: rect?.right ?? window.innerWidth - 400,
    })
    setBlockMenu(null)
  }

  const cancelComposer = () => {
    if (editor && composer) removeCardRefMarks(editor, composer.cardId)
    setComposer(null)
    setCapturing(false)
  }

  const createCard = (draft: CardDraft) => {
    if (!composer) return
    flushContent() // marks must be in the stored doc before refs resolve
    const now = Date.now()
    useSrsStore.getState().createCard({
      id: composer.cardId,
      front: draft.front.trim(),
      back: draft.back.trim(),
      tags: parseTags(draft.tagsText),
      pageId,
      refs: composer.refs.map(r => ({
        refId: r.refId,
        pageId,
        snapshot: r.snapshot,
        createdAt: now,
      })),
      type: draft.type,
      routine: draft.type === 'routine' ? draft.routine : undefined,
      temp: draft.type === 'temp' ? draft.temp : undefined,
    })
    createdRef.current = true
    setComposer(null)
    setCapturing(false)
  }

  return (
    <div className="page-scroll" ref={scrollRef}>
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

      <div className={cx('page', 'font-' + page.font, cover && 'has-cover')} ref={pageElRef}>
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

        <div className="editor-shell" onContextMenu={onEditorContextMenu}>
          <EditorContent editor={editor} />
        </div>
        <div className="editor-tail" onMouseDown={onTailDown} />
      </div>

      {slashView && <SlashMenu view={slashView} />}
      {mentionView && <MentionMenu view={mentionView} />}

      {blockMenu && (
        <Popover anchor={blockMenu.at} onClose={() => setBlockMenu(null)}>
          {blockMenuNode && !blockMenuNode.isAtom && (
            <>
              <div className="menu-note">Turn into</div>
              <div className="turn-grid">
                {TURN_INTO.map(t => (
                  <button
                    key={t.title}
                    type="button"
                    className="turn-btn"
                    title={t.title}
                    onClick={() => turnBlockInto(t.run)}
                  >
                    <t.icon size={15} strokeWidth={1.8} />
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
            </>
          )}
          <Menu
            entries={[
              {
                icon: Sparkles,
                label: 'New card from block',
                onSelect: cardFromBlock,
              },
              { icon: Copy, label: 'Duplicate', onSelect: duplicateBlock },
              { kind: 'sep' },
              { icon: Trash2, label: 'Delete', danger: true, onSelect: deleteBlock },
            ]}
          />
        </Popover>
      )}

      {selMenu && (
        <Popover anchor={selMenu.at} onClose={() => setSelMenu(null)}>
          <div className="fmt-row">
            {FORMATS.map(f => (
              <button
                key={f.name}
                type="button"
                className={cx('fmt-btn', editor?.isActive(f.name) && 'is-active')}
                title={f.title}
                onMouseDown={e => e.preventDefault()}
                onClick={() => editor && f.run(editor)}
              >
                <f.icon size={15} strokeWidth={1.9} />
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <Menu
            entries={[
              composer
                ? {
                    icon: Highlighter,
                    label: 'Add highlight to card',
                    onSelect: addSelectionToCard,
                  }
                : { icon: Sparkles, label: 'New card', onSelect: startCard },
              {
                icon: Copy,
                label: 'Copy',
                onSelect: () => {
                  navigator.clipboard?.writeText(selMenu.text).catch(() => {})
                  setSelMenu(null)
                },
              },
            ]}
          />
        </Popover>
      )}

      {composer && (
        <CardComposer
          refs={composer.refs}
          anchorTop={composer.top}
          pageRight={composer.pageRight}
          capturing={capturing}
          onAddHighlight={() => setCapturing(true)}
          onCancel={cancelComposer}
          onCreate={createCard}
        />
      )}

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
