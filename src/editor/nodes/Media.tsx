import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileCode2, ImageOff, Maximize2, X } from 'lucide-react'
import { isHtmlName, saveMedia, useMediaURL } from '../../lib/media'
import { cx } from '../../lib/util'

// ---------------------------------------------------------------------------
// Shared expand modal (html embeds; images use the lightbox below)
// ---------------------------------------------------------------------------

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])
}

// ---------------------------------------------------------------------------
// Image block
// ---------------------------------------------------------------------------

function ImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const url = useMediaURL(node.attrs.mediaId as string)
  const [lightbox, setLightbox] = useState(false)
  useEscape(lightbox, () => setLightbox(false))

  const startResize = (e: React.PointerEvent, dir: 1 | -1) => {
    e.preventDefault()
    e.stopPropagation()
    const wrap = (e.currentTarget as HTMLElement).closest('.image-block')
    const img = wrap?.querySelector('img')
    if (!img) return
    const startW = img.getBoundingClientRect().width
    const startX = e.clientX
    let final = startW
    const move = (ev: PointerEvent) => {
      final = Math.max(80, Math.round(startW + (ev.clientX - startX) * dir * 2))
      img.style.width = final + 'px'
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      updateAttributes({ width: final })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  const width = node.attrs.width as number | null

  return (
    <NodeViewWrapper
      className={cx('image-block', selected && 'is-selected')}
      data-type="image-embed"
    >
      <div className="image-shell" contentEditable={false}>
        {url ? (
          <img
            src={url}
            alt={node.attrs.name as string}
            style={width ? { width } : undefined}
            draggable={false}
          />
        ) : (
          <span className="media-missing">
            <ImageOff size={15} strokeWidth={1.7} />
            {(node.attrs.name as string) || 'Missing image'}
          </span>
        )}
        {url && editor.isEditable && (
          <>
            <span className="image-handle is-left" onPointerDown={e => startResize(e, -1)} />
            <span className="image-handle is-right" onPointerDown={e => startResize(e, 1)} />
            <button
              type="button"
              className="media-expand"
              title="Expand"
              onClick={e => {
                e.stopPropagation()
                setLightbox(true)
              }}
            >
              <Maximize2 size={13} strokeWidth={1.9} />
            </button>
          </>
        )}
      </div>
      {lightbox &&
        url &&
        createPortal(
          <div className="media-lightbox" onClick={() => setLightbox(false)}>
            <img src={url} alt={node.attrs.name as string} />
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}

export const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: { default: null },
      name: { default: '' },
      width: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="image-embed"]',
        getAttrs: el => ({
          mediaId: (el as HTMLElement).dataset.mediaId ?? null,
          name: (el as HTMLElement).dataset.name ?? '',
          width: Number((el as HTMLElement).dataset.width) || null,
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'image-embed',
        'data-media-id': node.attrs.mediaId,
        'data-name': node.attrs.name,
        'data-width': node.attrs.width ?? undefined,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})

// ---------------------------------------------------------------------------
// HTML embed block
// ---------------------------------------------------------------------------

function HtmlView({ node, selected }: NodeViewProps) {
  const url = useMediaURL(node.attrs.mediaId as string)
  const [expanded, setExpanded] = useState(false)
  useEscape(expanded, () => setExpanded(false))
  const name = (node.attrs.name as string) || 'embed.html'
  const height = (node.attrs.height as number) || 420

  return (
    <NodeViewWrapper
      className={cx('html-block', selected && 'is-selected')}
      data-type="html-embed"
    >
      <div contentEditable={false}>
        <div className="html-head">
          <FileCode2 size={13} strokeWidth={1.7} />
          <span className="html-name">{name}</span>
          <button
            type="button"
            className="icon-btn sm"
            title="Expand"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={13} strokeWidth={1.8} />
          </button>
        </div>
        <div className="html-frame" style={{ height }}>
          {url ? (
            <iframe src={url} title={name} sandbox="allow-scripts" />
          ) : (
            <span className="media-missing">
              <FileCode2 size={15} strokeWidth={1.7} />
              Missing file
            </span>
          )}
        </div>
      </div>
      {expanded &&
        url &&
        createPortal(
          <div className="media-modal-root">
            <div className="media-backdrop" onClick={() => setExpanded(false)} />
            <div className="media-modal">
              <div className="html-head">
                <FileCode2 size={13} strokeWidth={1.7} />
                <span className="html-name">{name}</span>
                <button
                  type="button"
                  className="icon-btn sm"
                  title="Close (esc)"
                  onClick={() => setExpanded(false)}
                >
                  <X size={14} strokeWidth={1.8} />
                </button>
              </div>
              <iframe src={url} title={name} sandbox="allow-scripts" />
            </div>
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  )
}

export const HtmlBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: { default: null },
      name: { default: '' },
      height: { default: 420 },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="html-embed"]',
        getAttrs: el => ({
          mediaId: (el as HTMLElement).dataset.mediaId ?? null,
          name: (el as HTMLElement).dataset.name ?? '',
          height: Number((el as HTMLElement).dataset.height) || 420,
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'html-embed',
        'data-media-id': node.attrs.mediaId,
        'data-name': node.attrs.name,
        'data-height': node.attrs.height,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(HtmlView, {
      // Interactive island — keep ProseMirror off everything except drags.
      stopEvent: ({ event }) => !event.type.startsWith('drag') && event.type !== 'drop',
    })
  },
})

// ---------------------------------------------------------------------------
// Paste / drop images and .html files straight into the page
// ---------------------------------------------------------------------------

export const MediaPaste = Extension.create({
  name: 'mediaPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    const acceptable = (f: File) => f.type.startsWith('image/') || isHtmlName(f.name)
    const insertFiles = (files: File[], pos?: number) => {
      files.forEach((file, i) => {
        void saveMedia(file, file.name).then(rec => {
          const node = {
            type: isHtmlName(rec.name) ? 'htmlBlock' : 'imageBlock',
            attrs: { mediaId: rec.id, name: rec.name },
          }
          const at = pos !== undefined ? pos + i : editor.state.selection.from
          editor.chain().insertContentAt(Math.min(at, editor.state.doc.content.size), node).run()
        })
      })
    }

    return [
      new Plugin({
        key: new PluginKey('mediaPaste'),
        props: {
          handlePaste(_view, event) {
            const files = [...(event.clipboardData?.files ?? [])].filter(acceptable)
            if (!files.length) return false
            event.preventDefault()
            insertFiles(files)
            return true
          },
          handleDrop(view, event) {
            const files = [...(event.dataTransfer?.files ?? [])].filter(acceptable)
            if (!files.length) return false
            event.preventDefault()
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            insertFiles(files, pos)
            return true
          },
        },
      }),
    ]
  },
})

/** Programmatic file picker (never resolves if the user cancels — harmless). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}
