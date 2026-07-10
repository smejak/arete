import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export interface BlockHandleOptions {
  /** Called when the handle is clicked: top-level block pos + handle rect. */
  onMenu: (pos: number, rect: DOMRect) => void
}

const HANDLE_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<circle cx="9" cy="5.5" r="1.6"/><circle cx="15" cy="5.5" r="1.6"/>' +
  '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
  '<circle cx="9" cy="18.5" r="1.6"/><circle cx="15" cy="18.5" r="1.6"/></svg>'

/** Resolve mouse coords to the position of the top-level block under them. */
function topBlockPos(view: EditorView, clientX: number, clientY: number): number | null {
  const editorRect = view.dom.getBoundingClientRect()
  // Clamp X into the content so hovering the left margin still hits the row.
  const x = Math.min(Math.max(clientX, editorRect.left + 2), editorRect.right - 2)
  const found = view.posAtCoords({ left: x, top: clientY })
  if (!found) return null
  if (found.inside >= 0) {
    const $inside = view.state.doc.resolve(found.inside)
    return $inside.depth === 0 ? found.inside : $inside.before(1)
  }
  const $pos = view.state.doc.resolve(found.pos)
  return $pos.depth >= 1 ? $pos.before(1) : null
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
    return [
      new Plugin({
        key: new PluginKey('blockHandle'),
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
            currentPos = pos
            handle.style.display = 'grid'
            handle.style.top = `${rect.top - shellRect.top + 2}px`
            handle.style.left = `${rect.left - shellRect.left - 30}px`
          }

          const onMove = (event: MouseEvent) => {
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
            const selection = NodeSelection.create(doc, currentPos)
            view.dispatch(view.state.tr.setSelection(selection))
            // Hand ProseMirror the slice so the drop moves (not copies) it.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(view as any).dragging = { slice: selection.content(), move: true }
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'copyMove'
              event.dataTransfer.setData('text/plain', selection.node.textContent || ' ')
              const dom = view.nodeDOM(currentPos)
              if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 12)
            }
          }

          // Listen on view.dom — it survives TipTap-React's re-parent.
          view.dom.addEventListener('mousemove', onMove)
          view.dom.addEventListener('mouseleave', onLeave)
          view.dom.addEventListener('keydown', onKey)
          handle.addEventListener('mouseenter', cancelHide)
          handle.addEventListener('mouseleave', scheduleHide)
          handle.addEventListener('click', onClick)
          handle.addEventListener('dragstart', onDragStart)
          handle.addEventListener('dragend', hide)

          return {
            update: () => {
              // Doc changed under the handle — reposition or hide.
              if (currentPos !== null && currentPos < view.state.doc.content.size) show(currentPos)
              else if (currentPos !== null) hide()
            },
            destroy: () => {
              view.dom.removeEventListener('mousemove', onMove)
              view.dom.removeEventListener('mouseleave', onLeave)
              view.dom.removeEventListener('keydown', onKey)
              handle.remove()
            },
          }
        },
      }),
    ]
  },
})
