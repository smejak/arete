import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import katex from 'katex'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placeFloating, type Placed } from '../../lib/position'
import { cx } from '../../lib/util'

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode })
  } catch {
    return latex
  }
}

// ---------------------------------------------------------------------------
// Source editor popover — Obsidian-style: type, see it render live
// ---------------------------------------------------------------------------

function MathEditor({
  value,
  anchor,
  block,
  onSave,
  onCancel,
}: {
  value: string
  anchor: DOMRect
  block: boolean
  onSave: (latex: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const focusedRef = useRef(false)
  const [pos, setPos] = useState<Placed | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(placeFloating(anchor, { width: el.offsetWidth, height: el.offsetHeight }, { gap: 8 }))
  }, [anchor, draft])

  // autoFocus fires while the popover is still visibility:hidden and silently
  // fails — focus once it is actually positioned.
  useEffect(() => {
    if (pos && !focusedRef.current) {
      focusedRef.current = true
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [pos])

  const preview = useMemo(() => renderKatex(draft.trim() || '\\ldots', block), [draft, block])

  return createPortal(
    <div
      ref={ref}
      className="popover math-editor"
      style={pos ? { top: pos.top, left: pos.left, transformOrigin: pos.origin } : { top: 0, left: 0, visibility: 'hidden' }}
    >
      <div className="math-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      <textarea
        ref={inputRef}
        className="math-input"
        rows={block ? 3 : 1}
        value={draft}
        spellCheck={false}
        placeholder={block ? '\\sum_{i=1}^n i = \\frac{n(n+1)}{2}' : 'E = mc^2'}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSave(draft.trim())
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="math-hint">
        <kbd className="kbd">↵</kbd> save · <kbd className="kbd">esc</kbd> cancel · KaTeX
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Node views
// ---------------------------------------------------------------------------

function useMathView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const latex = (node.attrs.latex as string) ?? ''
  // A math node born empty (from / menu or $$ rule) opens its editor at once.
  const [editing, setEditing] = useState(latex === '')
  const innerRef = useRef<HTMLSpanElement | null>(null)
  // The anchor element only exists after the first paint — tick once so the
  // auto-opened editor can position itself.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  // TipTap's focus() defers to rAF and can drop immediate keystrokes —
  // return focus to the editor synchronously instead.
  const refocus = () => {
    const { view } = editor
    const after = typeof getPos === 'function' ? getPos() + node.nodeSize : view.state.selection.to
    const pos = Math.min(after, view.state.doc.content.size)
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos), 1)))
    view.focus()
  }

  const save = (value: string) => {
    setEditing(false)
    if (!value) {
      deleteNode()
      editor.view.focus()
      return
    }
    if (value !== latex) updateAttributes({ latex: value })
    refocus()
  }

  const cancel = () => {
    setEditing(false)
    if (!latex) {
      deleteNode()
      editor.view.focus()
      return
    }
    refocus()
  }

  const showEditor = editing && ready && innerRef.current !== null
  return { latex, setEditing, innerRef, showEditor, save, cancel }
}

function MathInlineView(props: NodeViewProps) {
  const { latex, setEditing, innerRef, showEditor, save, cancel } = useMathView(props)
  const html = useMemo(() => renderKatex(latex, false), [latex])
  return (
    <NodeViewWrapper
      as="span"
      className={cx('math-inline', props.selected && 'is-selected')}
      contentEditable={false}
    >
      <span
        ref={innerRef}
        title="Click to edit equation"
        onClick={() => props.editor.isEditable && setEditing(true)}
      >
        {latex ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="math-empty">equation</span>
        )}
      </span>
      {showEditor && (
        <MathEditor
          value={latex}
          anchor={innerRef.current!.getBoundingClientRect()}
          block={false}
          onSave={save}
          onCancel={cancel}
        />
      )}
    </NodeViewWrapper>
  )
}

function MathBlockView(props: NodeViewProps) {
  const { latex, setEditing, innerRef, showEditor, save, cancel } = useMathView(props)
  const html = useMemo(() => renderKatex(latex, true), [latex])
  return (
    <NodeViewWrapper
      className={cx('math-block', props.selected && 'is-selected')}
      contentEditable={false}
    >
      <span
        ref={innerRef}
        className="math-block-inner"
        onClick={() => props.editor.isEditable && setEditing(true)}
      >
        {latex ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="math-empty">Empty equation — click to edit</span>
        )}
      </span>
      {showEditor && (
        <MathEditor
          value={latex}
          anchor={innerRef.current!.getBoundingClientRect()}
          block
          onSave={save}
          onCancel={cancel}
        />
      )}
    </NodeViewWrapper>
  )
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const MathInline = Node.create({
  name: 'mathInline',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return { latex: { default: '' } }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="math-inline"]',
        getAttrs: el => ({ latex: (el as HTMLElement).dataset.latex ?? '' }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline', 'data-latex': node.attrs.latex }),
    ]
  },

  renderText({ node }) {
    return `$${node.attrs.latex}$`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView)
  },

  addInputRules() {
    return [
      // "$E=mc^2$" renders the moment the closing $ is typed.
      new InputRule({
        find: /(?:^|[^$\w])\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1].trim()
          if (!latex) return
          const start = range.from + match[0].indexOf('$')
          state.tr.replaceWith(start, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { latex: { default: '' } }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="math-block"]',
        getAttrs: el => ({ latex: (el as HTMLElement).dataset.latex ?? '' }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'math-block', 'data-latex': node.attrs.latex }),
    ]
  },

  renderText({ node }) {
    return `$$\n${node.attrs.latex}\n$$`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView)
  },

  addInputRules() {
    // Leave a text cursor after the new atom — the default node selection
    // would let the very next keystroke replace the block.
    const selectAfter = (tr: Transaction, from: number) => {
      const after = Math.min(from + 1, tr.doc.content.size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1))
    }
    return [
      // "$$x^2$$ " → rendered block; "$$ " alone → empty block, editor open.
      new InputRule({
        find: /^\$\$([^$\n]*)\$\$\s$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceRangeWith(range.from, range.to, this.type.create({ latex: match[1].trim() }))
          selectAfter(state.tr, range.from)
        },
      }),
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          state.tr.replaceRangeWith(range.from, range.to, this.type.create({ latex: '' }))
          selectAfter(state.tr, range.from)
        },
      }),
    ]
  },
})
