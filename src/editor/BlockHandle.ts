import { Extension } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { dropPoint } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'

export interface BlockHandleOptions {
  /** Called when the handle is clicked: top-level block pos + handle rect. */
  onMenu: (pos: number, rect: DOMRect) => void
}

const HANDLE_SVG =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<circle cx="9" cy="4.5" r="1.7"/><circle cx="15" cy="4.5" r="1.7"/>' +
  '<circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/>' +
  '<circle cx="9" cy="19.5" r="1.7"/><circle cx="15" cy="19.5" r="1.7"/></svg>'

const isListType = (name: string) =>
  name === 'bulletList' || name === 'orderedList' || name === 'taskList'

/** Inside lists, each item is its own block: walk down from a list node to
 * the item whose row contains `y`, recursing through nested lists. Driven by
 * geometry (not the hovered element) so the margin and the text of the same
 * row always resolve to the same item — the handle stays put. */
function descendIntoLists(view: EditorView, pos: number, y: number): number {
  let node = view.state.doc.nodeAt(pos)
  while (node && isListType(node.type.name)) {
    // Find the direct child (list item) whose rect spans y.
    let childPos = pos + 1
    let hitPos: number | null = null
    let hitNode: typeof node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      const dom = view.nodeDOM(childPos)
      if (dom instanceof HTMLElement) {
        const r = dom.getBoundingClientRect()
        if (y >= r.top && y <= r.bottom) {
          hitPos = childPos
          hitNode = child
          break
        }
      }
      childPos += child.nodeSize
    }
    if (hitPos === null || !hitNode) return pos
    // A list nested DIRECTLY in this list (an indented bullet with no parent
    // bullet) — keep descending into it.
    if (isListType(hitNode.type.name)) {
      pos = hitPos
      node = hitNode
      continue
    }
    // If y sits over a nested list inside the item, keep descending;
    // otherwise the item itself is the block.
    let inner = hitPos + 1
    let nested: number | null = null
    for (let i = 0; i < hitNode.childCount; i++) {
      const c = hitNode.child(i)
      if (isListType(c.type.name)) {
        const dom = view.nodeDOM(inner)
        if (dom instanceof HTMLElement) {
          const r = dom.getBoundingClientRect()
          if (y >= r.top && y <= r.bottom) {
            nested = inner
            break
          }
        }
      }
      inner += c.nodeSize
    }
    if (nested === null) return hitPos
    pos = nested
    node = view.state.doc.nodeAt(pos)
  }
  return pos
}

/** Blocks living inside a toggle body or callout get their own handles, the
 * way Notion does it — hovering the toggle's summary row (or a callout's
 * chrome / sole child) still targets the container itself. */
function descendIntoContainers(view: EditorView, pos: number, y: number): number {
  for (;;) {
    const node = view.state.doc.nodeAt(pos)
    if (!node) return pos
    if (isListType(node.type.name)) return descendIntoLists(view, pos, y)
    if (node.type.name !== 'toggle' && node.type.name !== 'callout') return pos
    const isToggle = node.type.name === 'toggle'
    // The sole child of a callout stays glued to it — dragging it out would
    // leave an empty callout, which the schema forbids.
    if (!isToggle && node.childCount < 2) return pos
    let childPos = pos + 1
    let hit: number | null = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      const dom = view.nodeDOM(childPos)
      if (dom instanceof HTMLElement && dom.offsetParent !== null) {
        const r = dom.getBoundingClientRect()
        if (y >= r.top && y <= r.bottom) {
          // The summary row IS the toggle — only body children stand alone.
          if (!(isToggle && i === 0)) hit = childPos
          break
        }
      }
      childPos += child.nodeSize
    }
    if (hit === null) return pos
    pos = hit
  }
}

/** Resolve mouse coords to the block under them: the top-level block, except
 * inside lists, toggle bodies, and callouts, where each inner block gets its
 * own handle. */
function topBlockPos(view: EditorView, clientX: number, clientY: number): number | null {
  const editorRect = view.dom.getBoundingClientRect()
  // Clamp X into the content so hovering the left margin still hits the row.
  const x = Math.min(Math.max(clientX, editorRect.left + 2), editorRect.right - 2)
  const found = view.posAtCoords({ left: x, top: clientY })
  if (!found) return null
  let top: number
  if (found.inside >= 0) {
    const $inside = view.state.doc.resolve(found.inside)
    top = $inside.depth === 0 ? found.inside : $inside.before(1)
  } else {
    const $pos = view.state.doc.resolve(found.pos)
    if ($pos.depth < 1) return null
    top = $pos.before(1)
  }
  return descendIntoContainers(view, top, clientY)
}

/**
 * Notion's six-dot block handle: appears beside the hovered top-level block;
 * drag to move the block (ProseMirror handles the drop via the dropcursor),
 * click to open the block menu (rendered by the host component via onMenu).
 *
 * TipTap-React builds the EditorView on a detached element and only later
 * moves `view.dom` into the live wrapper, so we listen on `view.dom` itself
 * (event listeners survive the re-parent) and resolve the positioned shell
 * lazily on first use, once the editor is actually mounted.
 */
export const BlockHandle = Extension.create<BlockHandleOptions>({
  name: 'blockHandle',

  addOptions() {
    return { onMenu: () => {} }
  },

  addProseMirrorPlugins() {
    const options = this.options
    /** Set while a handle-drag of a MULTI-block selection is in flight:
     * the exact top-level range being moved. */
    let multiDrag: { from: number; to: number } | null = null
    return [
      new Plugin({
        key: new PluginKey('blockHandle'),
        props: {
          // Handle-initiated multi-block moves ourselves: ProseMirror's
          // default move-drop deletes the (partial) text selection, which
          // merges the boundary blocks into an empty remnant paragraph.
          // Deleting the exact block range keeps the move clean.
          handleDrop(view, event, slice, moved) {
            if (!multiDrag || !moved) {
              multiDrag = null
              return false
            }
            const range = multiDrag
            multiDrag = null
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            if (!coords) return false
            const state = view.state
            const target = dropPoint(state.doc, coords.pos, slice) ?? coords.pos
            // Dropping the range onto itself is a no-op, not a duplication.
            if (target >= range.from && target <= range.to) {
              event.preventDefault()
              return true
            }
            event.preventDefault()
            const tr = state.tr.delete(range.from, range.to)
            const mapped = tr.mapping.map(target)
            tr.replaceRange(mapped, mapped, slice)
            view.dispatch(tr.scrollIntoView())
            return true
          },
          handleDOMEvents: {
            dragend: () => {
              multiDrag = null
              return false
            },
          },
        },
        view: view => {
          let shell: HTMLElement | null = null
          let currentPos: number | null = null
          let hideTimer: number | null = null

          const handle = document.createElement('button')
          handle.type = 'button'
          handle.className = 'block-handle'
          handle.title = 'Drag to move · click for actions'
          handle.draggable = true
          handle.innerHTML = HANDLE_SVG
          handle.style.display = 'none'

          /** Attach the handle to the nearest positioned ancestor, once the
           * editor is live in the DOM. Returns false until then. */
          const ensureShell = (): boolean => {
            if (shell && shell.isConnected) return true
            const found =
              (view.dom.closest('.editor-shell') as HTMLElement | null) ??
              (view.dom.parentElement as HTMLElement | null)
            if (!found) return false
            shell = found
            shell.appendChild(handle)
            return true
          }

          const hide = () => {
            currentPos = null
            handle.style.display = 'none'
          }

          const scheduleHide = () => {
            if (hideTimer) window.clearTimeout(hideTimer)
            hideTimer = window.setTimeout(hide, 350)
          }

          const cancelHide = () => {
            if (hideTimer) window.clearTimeout(hideTimer)
            hideTimer = null
          }

          const show = (pos: number) => {
            if (!ensureShell() || !shell) return
            const dom = view.nodeDOM(pos)
            if (!(dom instanceof HTMLElement)) return hide()
            const shellRect = shell.getBoundingClientRect()
            const rect = dom.getBoundingClientRect()
            // List items sit past their marker — park the handle left of the
            // bullet/number instead of on top of it.
            const type = view.state.doc.nodeAt(pos)?.type.name
            const offset = type === 'listItem' || type === 'taskItem' ? 56 : 30
            // Center on the block's FIRST TEXT LINE, not its box: the first
            // <p> inside (list items, toggles, callouts) is where the line
            // actually lives, and its padding-top shifts the line down —
            // ignoring that left the dots floating slightly high.
            const lineEl = (dom.querySelector('p') as HTMLElement | null) ?? dom
            const cs = window.getComputedStyle(lineEl)
            let line = parseFloat(cs.lineHeight)
            if (!Number.isFinite(line) || line <= 0) line = rect.height
            line = Math.min(line, rect.height)
            const padTop = parseFloat(cs.paddingTop) || 0
            const lineTop = lineEl.getBoundingClientRect().top + padTop
            const h = Math.max(24, Math.min(34, Math.round(line)))
            currentPos = pos
            handle.style.display = 'grid'
            handle.style.height = `${h}px`
            handle.style.top = `${lineTop + line / 2 - h / 2 - shellRect.top}px`
            handle.style.left = `${rect.left - shellRect.left - offset}px`
          }

          const onMove = (event: MouseEvent) => {
            // The listener sits on the page scroller (the only element whose
            // box covers the gutter) — react only near the editor column:
            // its rows, plus the handle gutter to their left. The title above
            // and the footnote margin to the right stay handle-free.
            const r = view.dom.getBoundingClientRect()
            if (
              event.clientY < r.top - 4 ||
              event.clientY > r.bottom + 4 ||
              event.clientX < r.left - 80 ||
              event.clientX > r.right + 4
            ) {
              return scheduleHide()
            }
            const pos = topBlockPos(view, event.clientX, event.clientY)
            cancelHide()
            if (pos === null) return scheduleHide()
            if (pos !== currentPos) show(pos)
          }

          const onLeave = () => scheduleHide()
          const onKey = () => hide()

          const onClick = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            if (currentPos !== null) options.onMenu(currentPos, handle.getBoundingClientRect())
          }

          const onDragStart = (event: DragEvent) => {
            if (currentPos === null) return
            const doc = view.state.doc
            if (currentPos >= doc.content.size) return
            const node = doc.nodeAt(currentPos)
            if (!node) return

            // A block inside a wider selection drags the WHOLE selection —
            // that's how several blocks move together. The selection expands
            // to full sibling blocks (top-level, or inside a toggle/callout)
            // so the move never splits a paragraph.
            const sel = view.state.selection
            let range: { from: number; to: number } | null = null
            if (!sel.empty) {
              const $f = doc.resolve(sel.from)
              const $t = doc.resolve(sel.to)
              const nr = $f.blockRange($t)
              if (nr) {
                let selStart = nr.start
                let selEnd = nr.end
                // Stripping a toggle's summary (or emptying a callout) is
                // forbidden by their schemas — promote to the container.
                const stripsSummary = nr.parent.type.name === 'toggle' && nr.startIndex === 0
                const emptiesCallout =
                  nr.parent.type.name === 'callout' &&
                  nr.startIndex === 0 &&
                  nr.endIndex === nr.parent.childCount
                if (stripsSummary || emptiesCallout) {
                  selStart = nr.$from.before(nr.depth)
                  selEnd = selStart + nr.parent.nodeSize
                }
                const blockEnd = currentPos + node.nodeSize
                const covers = selStart <= currentPos && selEnd >= blockEnd
                const wider = selStart < currentPos || selEnd > blockEnd
                if (covers && wider) range = { from: selStart, to: selEnd }
              }
            }

            if (range) {
              multiDrag = range
              const slice = doc.slice(range.from, range.to)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ;(view as any).dragging = { slice, move: true }
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'copyMove'
                event.dataTransfer.setData(
                  'text/plain',
                  doc.textBetween(range.from, range.to, '\n') || ' ',
                )
                let count = 0
                doc.nodesBetween(range.from, range.to, (_n, _p, parent) => {
                  if (parent === doc) count++
                  return false
                })
                const ghost = document.createElement('div')
                ghost.className = 'drag-ghost'
                ghost.textContent = `${count} blocks`
                document.body.appendChild(ghost)
                event.dataTransfer.setDragImage(ghost, 12, 14)
                window.setTimeout(() => ghost.remove())
              }
              return
            }

            multiDrag = null
            let dragPos = currentPos
            let dragSlice: Slice | null = null
            if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
              const $item = doc.resolve(currentPos)
              const parentList = $item.parent
              if (parentList.childCount === 1) {
                // The only bullet: dragging it means dragging its list —
                // still shipped open so it splices into other lists as a
                // bare item instead of grafting structurally.
                dragPos = $item.before()
                const listNode = doc.nodeAt(dragPos)
                if (listNode) dragSlice = new Slice(Fragment.from(listNode), 1, 1)
              } else {
                // Ship the bullet wrapped in a single-item list, open at both
                // ends: dropped inside a list it splices in as a bare item,
                // dropped anywhere else it lands as its own list.
                const wrapped = parentList.type.create(parentList.attrs, node)
                dragSlice = new Slice(Fragment.from(wrapped), 1, 1)
              }
            }
            const selection = NodeSelection.create(doc, dragPos)
            view.dispatch(view.state.tr.setSelection(selection))
            // Hand ProseMirror the slice so the drop moves (not copies) it.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(view as any).dragging = { slice: dragSlice ?? selection.content(), move: true }
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'copyMove'
              event.dataTransfer.setData('text/plain', selection.node.textContent || ' ')
              const dom = view.nodeDOM(dragPos)
              if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 12)
            }
          }

          // Hover tracking lives on the SHELL, not view.dom: the handle sits
          // in the shell's left gutter, outside the content element, so a
          // cursor travelling vertically along the handles never enters
          // view.dom — with the listener there, the handle went dark until
          // the cursor detoured over the text. The shell covers gutter,
          // handle, and content alike, so the handle now follows the row
          // under the cursor wherever it is. (view.dom is detached at plugin
          // init — TipTap re-parents it — hence the rAF bootstrap.)
          let hoverEl: HTMLElement | null = null
          const bindHover = () => {
            if (hoverEl) return
            // Never resolve hosts while view.dom is detached: its pre-mount
            // parent is a throwaway div, and binding there once left the
            // handle dead for the whole session.
            if (!view.dom.isConnected) return
            if (!ensureShell() || !shell) return
            // Hover tracking needs the SCROLLER: the shell's box stops at the
            // text column, so the gutter where the handles live never hits it
            // (verified via elementFromPoint — gutter events target
            // .page-scroll directly).
            hoverEl = (view.dom.closest('.page-scroll') as HTMLElement | null) ?? shell
            hoverEl.addEventListener('mousemove', onMove)
            hoverEl.addEventListener('mouseleave', onLeave)
          }
          let bootTries = 0
          const boot = () => {
            bindHover()
            if (!hoverEl && bootTries++ < 300) requestAnimationFrame(boot)
          }
          bindHover()
          if (!hoverEl) requestAnimationFrame(boot)

          view.dom.addEventListener('keydown', onKey)
          handle.addEventListener('mouseenter', cancelHide)
          handle.addEventListener('mouseleave', scheduleHide)
          handle.addEventListener('click', onClick)
          handle.addEventListener('dragstart', onDragStart)
          handle.addEventListener('dragend', hide)

          return {
            update: () => {
              // Any transaction is a rebind chance (covers suspended rAF —
              // occluded windows never run the boot loop).
              bindHover()
              // Doc changed under the handle — reposition or hide.
              if (currentPos !== null && currentPos < view.state.doc.content.size) show(currentPos)
              else if (currentPos !== null) hide()
            },
            destroy: () => {
              if (hoverEl) {
                hoverEl.removeEventListener('mousemove', onMove)
                hoverEl.removeEventListener('mouseleave', onLeave)
              }
              view.dom.removeEventListener('keydown', onKey)
              handle.remove()
            },
          }
        },
      }),
    ]
  },
})
