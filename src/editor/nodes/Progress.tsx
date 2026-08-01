import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import {
  barFraction,
  barLabel,
  clampValue,
  COUNT_CEILING,
  emptyBar,
  labelChars,
  labelFontSize,
  PROGRESS_DEFAULT_MAX,
  PROGRESS_DEFAULT_SIZE,
  PROGRESS_MAX_BARS,
  ringGeometry,
  sanitizeBars,
  sanitizeSize,
  steppedValue,
  type ProgressBar,
  type ProgressKind,
} from '../../lib/progress'
import { cx } from '../../lib/util'

/**
 * A row of up to four progress rings, clicked to move them along.
 *
 * Values live in the node's attributes, so every change is an ordinary
 * ProseMirror transaction — undo, page history and the vault sync all pick
 * them up with no extra plumbing. Continuous gestures (dragging a percent
 * ring, resizing the row) render from local state and commit ONE transaction
 * on pointerup, the way the image block handles resizing: a transaction per
 * pointermove would bury the undo stack and thrash the folder sync.
 */

/** 2px of travel per percent — a full sweep is a comfortable 200px drag. */
const DRAG_PX_PER_PERCENT = 2
/** Horizontal travel is damped: rings are small, and the row grows fast. */
const RESIZE_DAMPING = 0.75
/** Movement under this reads as a click, not a drag. */
const DRAG_SLOP = 3

function Ring({
  bar,
  size,
  editable,
  marked,
  onSelect,
  onValue,
  onTitle,
}: {
  bar: ProgressBar
  size: number
  editable: boolean
  marked: boolean
  onSelect: () => void
  onValue: (value: number) => void
  onTitle: (title: string) => void
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const { stroke, r, center, circumference } = ringGeometry(size)
  const shown = drag ?? bar.value
  const fraction = barFraction({ ...bar, value: shown })
  const label = barLabel({ ...bar, value: shown })
  const done = fraction >= 1
  // The hit area is the hole in the middle, inset so it never covers the ring
  // itself — dragging the row's resize handles stays reachable.
  const hit = Math.max(24, size - stroke * 2 - 8)

  const dragRef = useRef<number | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || e.button !== 0) return
    e.preventDefault() // no text selection while dragging
    onSelect()
    const startY = e.clientY
    const start = bar.value
    dragRef.current = null

    const move = (ev: PointerEvent) => {
      if (bar.kind !== 'percent') return // counts step by click only
      const dy = startY - ev.clientY
      if (dragRef.current === null && Math.abs(dy) < DRAG_SLOP) return
      const next = clampValue(start + dy / DRAG_PX_PER_PERCENT, bar.max)
      dragRef.current = next
      setDrag(next)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      const dragged = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (dragged !== null) {
        if (dragged !== bar.value) onValue(dragged)
      } else {
        // ⌥-click steps back down; a plain click stops at the top.
        onValue(steppedValue(bar, ev.altKey ? -1 : 1))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  return (
    <div className={cx('pr-cell', marked && 'is-marked')}>
      <div className="pr-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="pr-track" cx={center} cy={center} r={r} strokeWidth={stroke} />
          <circle
            className={cx('pr-fill', done && 'is-done', drag !== null && 'is-dragging')}
            cx={center}
            cy={center}
            r={r}
            strokeWidth={stroke}
            // A full ring is drawn undashed — butt caps meeting at twelve
            // o'clock otherwise leave a hairline seam across the finish.
            strokeDasharray={done ? undefined : circumference}
            strokeDashoffset={done ? undefined : circumference * (1 - fraction)}
            transform={`rotate(-90 ${center} ${center})`}
          />
        </svg>
        <button
          type="button"
          className={cx('pr-hit', bar.kind === 'percent' && 'is-scrub')}
          style={{ width: hit, height: hit, fontSize: labelFontSize(size, labelChars(bar)) }}
          disabled={!editable}
          onPointerDown={onPointerDown}
          // Arrow keys step the focused ring, and the browser's key repeat
          // carries a held key a long way — the fast path to a big number
          // alongside typing it into the settings row.
          onKeyDown={e => {
            if (!editable) return
            const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
            if (!dir) return
            e.preventDefault()
            const step = bar.kind === 'percent' ? (e.shiftKey ? 1 : 5) : e.shiftKey ? 10 : 1
            onValue(clampValue(bar.value + dir * step, bar.max))
          }}
          title={
            editable
              ? bar.kind === 'percent'
                ? 'Click to add 5% · drag up or down to set · ⌥-click to subtract · ↑↓ to step (⇧ for 1)'
                : 'Click to add one · ⌥-click to subtract · ↑↓ to step (⇧ for 10) · type an exact number in settings'
              : undefined
          }
        >
          <span className={cx('pr-label', done && 'is-done')}>{label}</span>
        </button>
      </div>
      {editable ? (
        // The wrapper's ::after mirrors the text and sizes the grid cell the
        // textarea stretches into — an auto-growing caption with no measuring,
        // which matters because node views first render detached, where every
        // measurement reads zero.
        <div className="pr-cap" data-value={bar.title}>
          <textarea
            className="pr-title"
            value={bar.title}
            placeholder="Untitled"
            spellCheck={false}
            rows={1}
            // A caption is one line of text however many rows it wraps onto:
            // Enter commits it, and pasted newlines collapse to spaces.
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            onChange={e => onTitle(e.target.value.replace(/\s*\n+\s*/g, ' '))}
            onFocus={onSelect}
          />
        </div>
      ) : (
        bar.title && <div className="pr-title is-static">{bar.title}</div>
      )}
    </div>
  )
}

function ProgressView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const bars = sanitizeBars(node.attrs.bars)
  const size = sanitizeSize(node.attrs.size)
  const editable = editor.isEditable

  // A block nobody has named or moved yet is still being set up: it opens with
  // its settings showing and its title focused, so /progress lands you straight
  // in the configuration rather than on a mute, unlabelled ring.
  const pristine = bars.length === 1 && !bars[0].title && bars[0].value === 0
  const [open, setOpen] = useState(pristine)
  const [active, setActive] = useState(0)
  const [dragSize, setDragSize] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pristine || !editable) return
    // A React node view first renders into a DETACHED element, and focus() on
    // an unattached input silently does nothing — so wait for it to land in
    // the document, then claim the caret. A timer rather than rAF: frames are
    // suspended while the window is occluded, and this must still work when
    // the block is inserted in a background window.
    let timer = 0
    let tries = 0
    const claim = () => {
      const el = shellRef.current?.querySelector<HTMLTextAreaElement>('.pr-title')
      if (el?.isConnected) {
        el.focus()
        return
      }
      if (tries++ < 10) timer = window.setTimeout(claim, 16)
    }
    timer = window.setTimeout(claim, 0)
    return () => window.clearTimeout(timer)
    // Only ever on mount: refocusing later would fight the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const idx = Math.min(active, bars.length - 1)
  const current = bars[idx]
  const shownSize = dragSize ?? size
  const configOpen = editable && (open || selected)

  const write = (next: ProgressBar[]) => updateAttributes({ bars: next })
  const patch = (i: number, p: Partial<ProgressBar>) =>
    write(bars.map((b, j) => (j === i ? { ...b, ...p } : b)))

  const setKind = (kind: ProgressKind) => {
    if (current.kind === kind) return
    // Keep the ring looking the same across the switch: 60% becomes 6/10.
    const max = kind === 'percent' ? 100 : PROGRESS_DEFAULT_MAX
    patch(idx, { kind, max, value: clampValue(barFraction(current) * max, max) })
  }

  const addRing = () => {
    if (bars.length >= PROGRESS_MAX_BARS) return
    write([...bars, emptyBar(current.kind)])
    setActive(bars.length)
  }

  const removeRing = () => {
    if (bars.length <= 1) return
    write(bars.filter((_, j) => j !== idx))
    setActive(0)
  }

  const startResize = (e: React.PointerEvent, dir: 1 | -1) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    let next = size
    const move = (ev: PointerEvent) => {
      next = sanitizeSize(size + (ev.clientX - startX) * dir * RESIZE_DAMPING)
      setDragSize(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      setDragSize(null)
      if (next !== size) updateAttributes({ size: next })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  return (
    <NodeViewWrapper className={cx('progress-block', selected && 'is-selected')} data-type="progress">
      <div
        ref={shellRef}
        className="progress-shell"
        contentEditable={false}
        // Settings close when the caret leaves the block — an inline toolbar
        // that outlives its use reads as page furniture.
        onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setOpen(false)
        }}
      >
        <div
          className="progress-row"
          style={{ '--pr-size': `${shownSize}px` } as React.CSSProperties}
        >
          {bars.map((bar, i) => (
            <Ring
              key={i}
              bar={bar}
              size={shownSize}
              editable={editable}
              marked={configOpen && bars.length > 1 && i === idx}
              onSelect={() => setActive(i)}
              onValue={value => patch(i, { value })}
              onTitle={title => patch(i, { title })}
            />
          ))}
        </div>

        {editable && (
          <>
            <span className="progress-handle is-left" onPointerDown={e => startResize(e, -1)} />
            <span className="progress-handle is-right" onPointerDown={e => startResize(e, 1)} />
            <button
              type="button"
              className={cx('progress-cog', configOpen && 'is-on')}
              title={configOpen ? 'Hide settings' : 'Settings'}
              onClick={() => setOpen(v => !v)}
            >
              <SlidersHorizontal size={13} strokeWidth={1.8} />
            </button>
          </>
        )}

        {configOpen && (
          <div className="progress-config">
            {bars.length > 1 && (
              <span className="pc-scope" title="The ring these settings apply to">
                {current.title || `Ring ${idx + 1}`}
              </span>
            )}
            <div className="pc-seg">
              <button
                type="button"
                className={cx(current.kind === 'percent' && 'is-on')}
                onClick={() => setKind('percent')}
              >
                Percent
              </button>
              <button
                type="button"
                className={cx(current.kind === 'count' && 'is-on')}
                onClick={() => setKind('count')}
              >
                Count
              </button>
            </div>
            {/* Type the number in: a ring counting to 365 is not something
                anyone should have to click their way through. */}
            <label className="pc-val">
              <NumberField
                value={current.value}
                min={0}
                max={current.max}
                commit="change"
                onCommit={value => patch(idx, { value })}
              />
              {current.kind === 'percent' ? (
                <span>%</span>
              ) : (
                <>
                  <span>of</span>
                  <NumberField
                    value={current.max}
                    min={1}
                    max={COUNT_CEILING}
                    // On blur, not per keystroke: typing "365" would otherwise
                    // pass through a max of 3 and clamp the value down to it.
                    commit="blur"
                    onCommit={max => patch(idx, { max, value: Math.min(current.value, max) })}
                  />
                </>
              )}
            </label>
            {bars.length < PROGRESS_MAX_BARS && (
              <button type="button" className="pc-btn" onClick={addRing}>
                <Plus size={12.5} strokeWidth={2} /> Add ring
              </button>
            )}
            {bars.length > 1 && (
              <button type="button" className="pc-btn is-danger" onClick={removeRing}>
                <Trash2 size={12.5} strokeWidth={1.9} /> Remove
              </button>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

/**
 * A number field that tolerates being mid-edit. The model value is only the
 * displayed one while the field is idle: as soon as you type, a local draft
 * takes over, so the box can be emptied and retyped instead of snapping back
 * to the old number on the first backspace.
 */
function NumberField({
  value,
  min,
  max,
  commit,
  onCommit,
}: {
  value: number
  min: number
  max: number
  commit: 'change' | 'blur'
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const parse = (raw: string): number | null => {
    const n = Math.round(Number(raw))
    if (!raw.trim() || !Number.isFinite(n)) return null
    return Math.min(max, Math.max(min, n))
  }
  const flush = () => {
    const n = draft === null ? null : parse(draft)
    if (n !== null && n !== value) onCommit(n)
    setDraft(null)
  }
  return (
    <input
      className="pc-num"
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={e => {
        setDraft(e.target.value)
        if (commit === 'change') {
          const n = parse(e.target.value)
          if (n !== null && n !== value) onCommit(n)
        }
      }}
      onBlur={flush}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export const ProgressBlock = Node.create({
  name: 'progressBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      bars: {
        default: null,
        parseHTML: el => {
          try {
            return sanitizeBars(JSON.parse(el.getAttribute('data-bars') ?? '[]'))
          } catch {
            return sanitizeBars(null)
          }
        },
        renderHTML: attrs => ({ 'data-bars': JSON.stringify(sanitizeBars(attrs.bars)) }),
      },
      size: {
        default: PROGRESS_DEFAULT_SIZE,
        parseHTML: el => sanitizeSize(el.getAttribute('data-size')),
        renderHTML: attrs => ({ 'data-size': sanitizeSize(attrs.size) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="progress"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'progress' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ProgressView, {
      // Interactive island — ProseMirror must keep its hands off the clicks and
      // the inputs, but block dragging still needs the drag events.
      stopEvent: ({ event }) => !event.type.startsWith('drag') && event.type !== 'drop',
    })
  },
})
