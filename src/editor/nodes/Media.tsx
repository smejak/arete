import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { FileCode2, ImageOff, Maximize2, X } from 'lucide-react'
import { isAudioName, probeDuration } from '../../lib/audio'
import { isHtmlName, saveMedia, useMediaText, useMediaURL, withBaseTarget } from '../../lib/media'
import { useZoomPan } from '../../lib/use-zoom-pan'
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
// Image viewer — the picture, full screen, under your fingers
// ---------------------------------------------------------------------------

function ImageViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const { transform, swipe, interacting, zoomed, handlers } = useZoomPan({
    containerRef: container,
    contentRef: img,
    onDismiss: onClose,
  })
  useEscape(true, onClose)

  // The pull-down fades the backdrop as it goes, so the gesture reads as
  // "putting it back" rather than "dragging something off the screen".
  const progress = Math.min(1, swipe / 220)

  return createPortal(
    <div
      ref={container}
      className={cx('media-viewer', zoomed && 'is-zoomed', interacting && 'is-pinching')}
      style={{ '--viewer-dim': String(1 - progress * 0.7) } as React.CSSProperties}
      {...handlers}
    >
      <button type="button" className="media-viewer-close" onClick={onClose} title="Close (esc)">
        <X size={18} strokeWidth={2} />
      </button>
      <img
        ref={img}
        src={url}
        alt={name}
        draggable={false}
        style={{
          transform: `translate(${transform.x}px, ${transform.y + swipe}px) scale(${transform.scale})`,
          opacity: 1 - progress * 0.35,
        }}
      />
    </div>,
    document.body,
  )
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
            // Read-only, the picture IS the button. The expand affordance only
            // appears on hover, which a phone does not have, and a card image
            // shrunk to fit a phone column is the one that most needs opening.
            // The stop is not optional: on iOS this sits inside a review card
            // whose own tap reveals the answer.
            onClick={
              editor.isEditable
                ? undefined
                : e => {
                    e.stopPropagation()
                    setLightbox(true)
                  }
            }
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
      {lightbox && url && (
        <ImageViewer
          url={url}
          name={(node.attrs.name as string) || ''}
          onClose={() => setLightbox(false)}
        />
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

// No `allow-same-origin` (the frame stays a null origin, walled off from the
// app, its Tauri IPC, and the vault) and no popups: an embedded flashcard HTML
// file has no reason to open windows, and `allow-popups-to-escape-sandbox`
// would let one navigate to an un-sandboxed page (phishing). Scripts stay
// enabled for interactive embeds; on iOS the app CSP blocks their network egress.
const EMBED_SANDBOX = 'allow-scripts'

function HtmlView({ node, selected }: NodeViewProps) {
  const rawText = useMediaText(node.attrs.mediaId as string)
  const doc = rawText === null ? null : withBaseTarget(rawText)
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
          {doc !== null ? (
            <iframe srcDoc={doc} title={name} sandbox={EMBED_SANDBOX} />
          ) : (
            <span className="media-missing">
              <FileCode2 size={15} strokeWidth={1.7} />
              Missing file
            </span>
          )}
        </div>
      </div>
      {expanded &&
        doc !== null &&
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
              <iframe srcDoc={doc} title={name} sandbox={EMBED_SANDBOX} />
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
    const acceptable = (f: File) =>
      f.type.startsWith('image/') || f.type.startsWith('audio/') || isHtmlName(f.name) || isAudioName(f.name)
    const insertFiles = (files: File[], pos?: number) => {
      files.forEach((file, i) => {
        void saveMedia(file, file.name).then(async rec => {
          const audio = isAudioName(rec.name) || rec.type.startsWith('audio/')
          const node = {
            type: isHtmlName(rec.name) ? 'htmlBlock' : audio ? 'audioBlock' : 'imageBlock',
            attrs: {
              mediaId: rec.id,
              name: rec.name,
              ...(audio ? { duration: await probeDuration(rec.blob) } : {}),
            },
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
