import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getMarkRange } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Check, Copy, Globe, Trash2 } from 'lucide-react'
import { openExternal } from '../lib/links'
import { cx } from '../lib/util'

interface HoverLink {
  href: string
  from: number
  to: number
  rect: DOMRect
}

/**
 * Notion-style link chrome: hovering linked text floats a pill with the URL,
 * copy, and Edit; Edit opens a small panel with the URL, the link title, and
 * Remove link. Clicking the text itself opens the URL outside the app.
 */
export function LinkMenu({ editor }: { editor: Editor | null }) {
  const [hover, setHover] = useState<HoverLink | null>(null)
  const [editing, setEditing] = useState<HoverLink | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [copied, setCopied] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const pillRef = useRef<HTMLDivElement>(null)

  // Track pointer over links inside the editor (and clicks to open them).
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const linkAt = (a: HTMLAnchorElement): HoverLink | null => {
      try {
        const pos = editor.view.posAtDOM(a, 0)
        const $pos = editor.state.doc.resolve(pos + 1)
        const range = getMarkRange($pos, editor.state.schema.marks.link)
        if (!range) return null
        const href = a.getAttribute('href') ?? ''
        return { href, from: range.from, to: range.to, rect: a.getBoundingClientRect() }
      } catch {
        return null
      }
    }

    const onOver = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a || !dom.contains(a)) return
      const link = linkAt(a as HTMLAnchorElement)
      if (!link) return
      window.clearTimeout(hideTimer.current)
      setHover(prev =>
        prev && prev.from === link.from && prev.href === link.href ? prev : link,
      )
    }

    const onOut = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      hideTimer.current = window.setTimeout(() => setHover(null), 300)
    }

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a || !dom.contains(a)) return
      const href = a.getAttribute('href')
      if (!href) return
      e.preventDefault()
      openExternal(href)
    }

    dom.addEventListener('mouseover', onOver)
    dom.addEventListener('mouseout', onOut)
    dom.addEventListener('click', onClick)
    return () => {
      dom.removeEventListener('mouseover', onOver)
      dom.removeEventListener('mouseout', onOut)
      dom.removeEventListener('click', onClick)
    }
  }, [editor])

  if (!editor) return null

  const openEditor = (link: HoverLink) => {
    setEditing(link)
    setUrl(link.href)
    setTitle(editor.state.doc.textBetween(link.from, link.to, ' '))
    setHover(null)
  }

  const close = () => {
    setEditing(null)
    setHover(null)
  }

  const apply = () => {
    if (!editing) return
    const clean = url.trim()
    const text = title.trim() || clean
    if (!clean) {
      remove()
      return
    }
    editor
      .chain()
      .command(({ state, tr }) => {
        const mark = state.schema.marks.link.create({ href: clean })
        tr.replaceWith(editing.from, editing.to, state.schema.text(text, [mark]))
        return true
      })
      .run()
    close()
  }

  const remove = () => {
    if (!editing) return
    editor
      .chain()
      .setTextSelection(editing.from + 1)
      .extendMarkRange('link')
      .unsetLink()
      .setTextSelection(editing.from)
      .run()
    close()
  }

  const copy = (href: string) => {
    void navigator.clipboard?.writeText(href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const shortHref = (href: string) =>
    href.length > 42 ? href.slice(0, 40) + '…' : href

  const pillStyle = (rect: DOMRect): React.CSSProperties => ({
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
    top: rect.bottom + 6,
  })

  return createPortal(
    <>
      {hover && !editing && (
        <div
          ref={pillRef}
          className="link-pill"
          style={pillStyle(hover.rect)}
          onMouseEnter={() => window.clearTimeout(hideTimer.current)}
          onMouseLeave={() => {
            hideTimer.current = window.setTimeout(() => setHover(null), 250)
          }}
        >
          <Globe size={13} strokeWidth={1.7} className="link-pill-globe" />
          <button
            type="button"
            className="link-pill-href"
            title={hover.href}
            onClick={() => openExternal(hover.href)}
          >
            {shortHref(hover.href)}
          </button>
          <button
            type="button"
            className="icon-btn sm"
            title="Copy link"
            onClick={() => copy(hover.href)}
          >
            {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.7} />}
          </button>
          <button type="button" className="link-pill-edit" onClick={() => openEditor(hover)}>
            Edit
          </button>
        </div>
      )}

      {editing && (
        <>
          <div className="link-edit-catcher" onMouseDown={close} />
          <div className="link-edit" style={pillStyle(editing.rect)}>
            <label className="link-edit-label">Page or URL</label>
            <input
              className="link-edit-input"
              value={url}
              autoFocus
              spellCheck={false}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') apply()
                if (e.key === 'Escape') close()
              }}
            />
            <label className="link-edit-label">Link title</label>
            <input
              className="link-edit-input"
              value={title}
              spellCheck={false}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') apply()
                if (e.key === 'Escape') close()
              }}
            />
            <div className="link-edit-actions">
              <button type="button" className={cx('menu-item', 'is-danger')} onClick={remove}>
                <Trash2 size={14} strokeWidth={1.7} />
                <span className="menu-label">Remove link</span>
              </button>
              <button type="button" className="btn btn-primary" onClick={apply}>
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </>,
    document.body,
  )
}
