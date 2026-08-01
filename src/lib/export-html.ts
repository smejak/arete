import katex from 'katex'
import type { JSONContent } from '@tiptap/core'
import type { Page, SrsCard } from '../store/types'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { childrenOf, descendantsOf, ancestorsOf, extractText } from './tree'
import { markdownToDoc, sanitizeFilename } from './markdown'
import { applySorts, cellText, evalFilter, isEmptyCell, orderedFields } from './db'
import { getMedia, withBaseTarget } from './media'
import { isAudioName } from './audio'
import { COVERS } from './covers'
import { dueAt, fmtInterval, previewIntervals, retrievability, scheduleLabel } from './srs'
import { refText } from './refs'
import { stripMd } from './util'
import {
  barFraction,
  barLabel,
  labelChars,
  labelFontSize,
  ringGeometry,
  sanitizeProgress,
  type ProgressData,
} from './progress'
import { iconText } from './icon'

// The export wears Arete's own stylesheets rather than a hand-kept copy of
// them, so a change to the app's look lands in every export that follows
// without anyone remembering to mirror it here. Only `EXPORT_CSS` below is
// export-specific, and it exists purely to stand in for the editor chrome
// these class names normally sit inside.
import baseCss from '../styles/base.css?raw'
import sidebarCss from '../styles/sidebar.css?raw'
import pageCss from '../styles/page.css?raw'
import editorCss from '../styles/editor.css?raw'
import menusCss from '../styles/menus.css?raw'
import progressCss from '../styles/progress.css?raw'
import audioCss from '../styles/audio.css?raw'
import dbCss from '../styles/db.css?raw'
import srsCss from '../styles/srs.css?raw'

/**
 * Interactive HTML export: one self-contained file that IS Arete, minus the
 * writing. Same shell (toggleable sidebar, breadcrumbs, light/dark), same
 * page column, and the same two card surfaces — Review and Cards — driven by
 * the deck that shipped with it. The one thing an export cannot do is
 * remember: ratings advance the session in front of you and are gone when the
 * tab closes, because there is nowhere in a file to write them.
 */

export interface HtmlExportOptions {
  subpages: boolean
  cards: boolean
}

/** Audio bigger than this is named in the export but not carried in it. */
const AUDIO_EXPORT_LIMIT = 8 * 1024 * 1024

/** The app's iframe sandbox, verbatim — an embed gets scripts and nothing
 * else, in an export exactly as in the editor. */
const EMBED_SANDBOX = 'allow-scripts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

// ---------------------------------------------------------------------------
// Icons — the same Lucide glyphs the app draws, as raw SVG (no React here)
// ---------------------------------------------------------------------------

const ICONS: Record<string, string> = {
  'graduation-cap':
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'panel-left-close':
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  'panel-left-open':
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  'external-link':
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  repeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  'calendar-clock':
    '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  timer:
    '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  'file-text':
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'file-code-2':
    '<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m5 12-3 3 3 3"/><path d="m9 18 3-3-3-3"/>',
  'maximize-2':
    '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'corner-down-right': '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause:
    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  'audio-lines':
    '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  'align-left': '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  'circle-chevron-down': '<circle cx="12" cy="12" r="10"/><path d="m16 10-4 4-4-4"/>',
  tags: '<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>',
  calendar:
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'square-check': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  'link-2': '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
}

function icon(name: string, size = 16, stroke = 1.7, cls = ''): string {
  return `<svg${cls ? ` class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`
}

/** The wordmark's ridge, same geometry as the sidebar's. */
const RIDGE =
  '<svg width="17" height="13" viewBox="0 0 24 18" fill="none" aria-hidden="true"><path d="M1.5 16.5 L9 4.5 L12.8 10.2 L16.5 4 L22.5 16.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="miter"/></svg>'

const FIELD_ICON: Record<string, string> = {
  title: 'type',
  text: 'align-left',
  number: 'hash',
  select: 'circle-chevron-down',
  multiSelect: 'tags',
  date: 'calendar',
  checkbox: 'square-check',
  url: 'link-2',
  email: 'mail',
  phone: 'phone',
  createdTime: 'calendar-clock',
  updatedTime: 'clock',
}

/** Page icons are emoji or "lucide:name"; the export draws the emoji and falls
 * back to the same file glyph the app uses when there is no icon. */
function pageIconHtml(iconValue: string | null | undefined, size: number): string {
  if (!iconValue) return icon('file-text', size)
  if (iconValue.startsWith('lucide:')) return icon('file-text', size)
  return esc(iconValue)
}

// ---------------------------------------------------------------------------
// Inline + block rendering — the app's own class names, so the app's own CSS
// dresses them
// ---------------------------------------------------------------------------

interface Ctx {
  pages: Record<string, Page>
  exported: Set<string>
  media: Map<string, { dataUrl?: string; text?: string; name: string }>
  hasMath: { value: boolean }
  /** Highlights only carry a card link for cards that ship with the export —
   * orphaned or excluded card marks come out as plain text. */
  cardIds: Set<string>
  /** Footnotes collected while rendering the CURRENT page, in document
   * order — reset per article; their index is the printed number. */
  fns: { id: string; md: string }[]
}

function math(latex: string, display: boolean, ctx: Ctx): string {
  ctx.hasMath.value = true
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false })
  } catch {
    return `<code>${esc(latex)}</code>`
  }
}

function inlineHtml(nodes: JSONContent[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map(n => {
      if (n.type === 'hardBreak') return '<br>'
      if (n.type === 'mathInline') {
        return `<span class="math-inline">${math((n.attrs?.latex as string) ?? '', false, ctx)}</span>`
      }
      if (n.type === 'footnote') {
        const id = (n.attrs?.id as string) ?? String(ctx.fns.length)
        ctx.fns.push({ id, md: (n.attrs?.md as string) ?? '' })
        return `<sup class="fn-ref" data-fn="${escAttr(id)}" data-n="${ctx.fns.length}"></sup>`
      }
      if (n.type === 'pageMention') {
        const pageId = (n.attrs?.pageId as string) ?? null
        const page = pageId ? ctx.pages[pageId] : undefined
        const title = page ? page.title || 'Untitled' : 'Missing page'
        const glyph = `<span class="pm-icon">${pageIconHtml(page?.icon, 13.5)}</span>`
        if (page && ctx.exported.has(page.id)) {
          return `<span class="page-mention" data-goto="${page.id}">${glyph}<span class="pm-title">${esc(title)}</span></span>`
        }
        return `<span class="page-mention is-gone">${glyph}<span class="pm-title">${esc(title)}</span></span>`
      }
      if (n.type !== 'text') return ''
      let out = esc(n.text ?? '')
      const marks = [...(n.marks ?? [])].sort(
        (a, b) => (a.type === 'cardref' ? 1 : 0) - (b.type === 'cardref' ? 1 : 0),
      )
      for (const m of marks) {
        switch (m.type) {
          case 'bold': out = `<strong>${out}</strong>`; break
          case 'italic': out = `<em>${out}</em>`; break
          case 'underline': out = `<u>${out}</u>`; break
          case 'strike': out = `<s>${out}</s>`; break
          case 'code': out = `<code>${out}</code>`; break
          case 'highlight': out = `<mark>${out}</mark>`; break
          case 'link':
            out = `<a href="${escAttr((m.attrs?.href as string) ?? '#')}" target="_blank" rel="noopener">${out}</a>`
            break
          case 'cardref': {
            const cardId = (m.attrs?.cardId as string) ?? ''
            const refId = (m.attrs?.refId as string) ?? ''
            if (ctx.cardIds.has(cardId)) {
              out = `<span class="cardref" data-card="${escAttr(cardId)}" data-ref="${escAttr(refId)}">${out}</span>`
            }
            break
          }
        }
      }
      return out
    })
    .join('')
}

function listHtml(node: JSONContent, ctx: Ctx, kind: 'ul' | 'ol' | 'task'): string {
  const items = (node.content ?? [])
    .map(item => {
      // Lists may nest directly inside lists (indented bullets without a
      // parent bullet) — render the sublist as its own indented block.
      if (item.type === 'bulletList' || item.type === 'orderedList' || item.type === 'taskList') {
        return blockHtml(item, ctx)
      }
      const inner = (item.content ?? []).map(c => blockHtml(c, ctx)).join('')
      if (kind === 'task') {
        const checked = item.attrs?.checked === true
        return `<li data-checked="${checked}"><label><input type="checkbox" disabled${checked ? ' checked' : ''}></label><div>${inner}</div></li>`
      }
      return `<li>${inner}</li>`
    })
    .join('')
  if (kind === 'task') return `<ul data-type="taskList">${items}</ul>`
  return kind === 'ul' ? `<ul>${items}</ul>` : `<ol>${items}</ol>`
}

/** A database, drawn with the grid's own markup so a table in an export sits
 * on the same rails as the table in the app. */
function dbTableHtml(dbPage: Page, ctx: Ctx): string {
  const db = dbPage.db
  const view = db?.views[0]
  if (!db || !view) return ''
  const fields = orderedFields(db, view).filter(f => !view.columnMeta[f.id]?.hidden)
  const rows = applySorts(
    db,
    view,
    childrenOf(ctx.pages, dbPage.id).filter(r => evalFilter(db, view.filter, r)),
  )
  const widthOf = (fieldId: string, type: string) =>
    view.columnMeta[fieldId]?.width ?? (type === 'title' ? 220 : 140)
  const total = fields.reduce((sum, f) => sum + widthOf(f.id, f.type), 0)

  const head = fields
    .map(
      f =>
        `<div class="dbt-th" style="width:${widthOf(f.id, f.type)}px">${icon(FIELD_ICON[f.type] ?? 'align-left', 13.5, 1.7, 'dbt-th-icon')}<span class="dbt-th-name">${esc(f.name)}</span></div>`,
    )
    .join('')

  const body = rows
    .map(row => {
      const cells = fields
        .map(f => {
          let inner: string
          if (f.type === 'checkbox') {
            const on = row.props?.[f.id] === true
            inner = `<span class="db-check${on ? ' is-checked' : ''}">${on ? icon('check', 12, 3) : ''}</span>`
          } else if (f.type === 'select' || f.type === 'multiSelect') {
            const ids =
              f.type === 'select'
                ? typeof row.props?.[f.id] === 'string'
                  ? [row.props[f.id] as string]
                  : []
                : Array.isArray(row.props?.[f.id])
                  ? (row.props![f.id] as string[])
                  : []
            inner = ids
              .map(id => {
                const o = f.config.options?.find(x => x.id === id)
                return o ? `<span class="db-chip dbo-${o.color}">${esc(o.name)}</span>` : ''
              })
              .join(' ')
          } else {
            const text = isEmptyCell(f, row) ? '' : cellText(f, row)
            inner = `<span class="dbc-text${f.type === 'title' ? ' dbc-title' : ''}">${esc(text)}</span>`
          }
          return `<div class="dbt-cellwrap" style="width:${widthOf(f.id, f.type)}px"><div class="dbt-cell${f.type === 'checkbox' ? ' is-checkbox' : ''} is-readonly">${inner}</div></div>`
        })
        .join('')
      return `<div class="dbt-row">${cells}</div>`
    })
    .join('')

  return `<div class="dbt"><div class="dbt-scroll"><div class="dbt-inner" style="width:${total + 40}px"><div class="dbt-head">${head}</div><div class="dbt-body">${body}</div></div></div></div>`
}

/** Progress rings, frozen: the same geometry the editor draws, minus the
 * dragging — an export is a reading surface. */
function progressHtml(data: ProgressData): string {
  const { stroke, r, center, circumference } = ringGeometry(data.size)
  const cells = data.bars
    .map(bar => {
      const fraction = barFraction(bar)
      const done = fraction >= 1
      const dash = done ? '' : ` stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - fraction)}"`
      const label = barLabel(bar)
      const title = bar.title ? `<div class="pr-title is-static">${esc(bar.title)}</div>` : ''
      return `<div class="pr-cell"><div class="pr-ring" style="width:${data.size}px;height:${data.size}px"><svg width="${data.size}" height="${data.size}" viewBox="0 0 ${data.size} ${data.size}" aria-hidden="true"><circle class="pr-track" cx="${center}" cy="${center}" r="${r}" stroke-width="${stroke}"></circle><circle class="pr-fill${done ? ' is-done' : ''}" cx="${center}" cy="${center}" r="${r}" stroke-width="${stroke}"${dash} transform="rotate(-90 ${center} ${center})"></circle></svg><span class="pr-hit" style="width:${Math.round(data.size * 0.72)}px;height:${Math.round(data.size * 0.72)}px;font-size:${labelFontSize(data.size, labelChars(bar))}px"><span class="pr-label${done ? ' is-done' : ''}">${esc(label)}</span></span></div>${title}</div>`
    })
    .join('')
  return `<div class="progress-block" data-type="progress"><div class="progress-shell"><div class="progress-row" style="--pr-size:${data.size}px">${cells}</div></div></div>`
}

function blockHtml(node: JSONContent, ctx: Ctx): string {
  switch (node.type) {
    case 'paragraph': {
      const inner = inlineHtml(node.content, ctx)
      return `<p>${inner || '<br>'}</p>`
    }
    case 'heading': {
      const level = Math.min(3, (node.attrs?.level as number) || 1)
      return `<h${level}>${inlineHtml(node.content, ctx)}</h${level}>`
    }
    case 'bulletList': return listHtml(node, ctx, 'ul')
    case 'orderedList': return listHtml(node, ctx, 'ol')
    case 'taskList': return listHtml(node, ctx, 'task')
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map(c => blockHtml(c, ctx)).join('')}</blockquote>`
    case 'callout': {
      const emoji = (node.attrs?.emoji as string) ?? ''
      const badge = emoji ? `<span class="callout-emoji">${esc(emoji)}</span>` : ''
      return `<div class="callout${emoji ? '' : ' no-emoji'}" data-type="callout">${badge}<div class="callout-body">${(node.content ?? []).map(c => blockHtml(c, ctx)).join('')}</div></div>`
    }
    case 'codeBlock':
      return `<pre><code>${esc((node.content ?? []).map(c => c.text ?? '').join(''))}</code></pre>`
    case 'horizontalRule': return '<hr>'
    case 'mathBlock':
      return `<div class="math-block">${math((node.attrs?.latex as string) ?? '', true, ctx)}</div>`
    case 'toggle': {
      const children = node.content ?? []
      const open = node.attrs?.open !== false
      const body = children.map(c => blockHtml(c, ctx)).join('')
      // The extra div inside .toggle-body is what TipTap's React node view
      // leaves behind; the collapse rule selects through it.
      return `<div class="toggle-block${open ? ' is-open' : ''}" data-type="toggle"><button type="button" class="toggle-arrow" data-toggle>${icon('chevron-right', 16, 2)}</button><div class="toggle-col"><div class="toggle-body"><div>${body}</div></div></div></div>`
    }
    case 'pageLink': {
      const pageId = (node.attrs?.pageId as string) ?? null
      const page = pageId ? ctx.pages[pageId] : undefined
      const title = page ? page.title || 'Untitled' : 'Missing page'
      const glyph = `<span class="plb-icon">${pageIconHtml(page?.icon, 16)}</span>`
      if (page && ctx.exported.has(page.id)) {
        return `<div class="page-link-block"><button type="button" class="plb" data-goto="${page.id}">${glyph}<span class="plb-title">${esc(title)}</span></button></div>`
      }
      return `<div class="page-link-block"><span class="plb">${glyph}<span class="plb-title plb-gone">${esc(title)}</span></span></div>`
    }
    case 'blockRef': {
      // The quote travels with the reference, so an export still reads
      // properly even when the page it points at was not included.
      const pageId = (node.attrs?.pageId as string) ?? null
      const page = pageId ? ctx.pages[pageId] : undefined
      const text = (node.attrs?.text as string) ?? ''
      const inside = page && ctx.exported.has(page.id)
      const src = `<span class="bref-src"><span class="bref-src-icon">${pageIconHtml(page?.icon, 11)}</span>${esc(page ? page.title || 'Untitled' : 'Page not in this export')}</span>`
      const body = `<span class="bref-mark">${icon('corner-down-right', 13, 1.9)}</span><span class="bref-text">${esc(text)}</span>${src}`
      return inside
        ? `<div class="block-ref"><button type="button" class="bref" data-goto="${page.id}" data-flash="${escAttr(text)}">${body}</button></div>`
        : `<div class="block-ref"><span class="bref">${body}</span></div>`
    }
    case 'imageBlock': {
      const media = ctx.media.get((node.attrs?.mediaId as string) ?? '')
      const name = (node.attrs?.name as string) || ''
      if (!media?.dataUrl) {
        return `<div class="image-block"><span class="media-missing">${icon('file-text', 15)}Missing image${name ? ': ' + esc(name) : ''}</span></div>`
      }
      const width = node.attrs?.width ? ` style="width:${Number(node.attrs.width)}px"` : ''
      return `<div class="image-block" data-type="image"><div class="image-shell"><img src="${media.dataUrl}" alt="${escAttr(name)}"${width}></div></div>`
    }
    case 'htmlBlock': {
      const media = ctx.media.get((node.attrs?.mediaId as string) ?? '')
      const name = (node.attrs?.name as string) || 'embed.html'
      const head = `<div class="html-head">${icon('file-code-2', 13)}<span class="html-name">${esc(name)}</span>${media?.text === undefined ? '' : `<button type="button" class="icon-btn sm" title="Expand" data-embed-expand>${icon('maximize-2', 13, 1.8)}</button>`}</div>`
      if (media?.text === undefined) {
        return `<div class="html-block">${head}<div class="html-frame" style="height:120px"><span class="media-missing">${icon('file-code-2', 15)}Missing file</span></div></div>`
      }
      const height = Number(node.attrs?.height) || 420
      return `<div class="html-block" data-type="html-embed"><div>${head}<div class="html-frame" style="height:${height}px"><iframe sandbox="${EMBED_SANDBOX}" title="${escAttr(name)}" srcdoc="${escAttr(withBaseTarget(media.text))}"></iframe></div></div></div>`
    }
    case 'databaseBlock': {
      const target = ctx.pages[(node.attrs?.pageId as string) ?? '']
      if (!target?.db) return '<div class="db-block"><span class="db-gone">Missing database</span></div>'
      return `<div class="db-block"><div class="db-inline"><div class="db-inline-head"><span class="db-inline-title">${esc(target.title || 'Untitled')}</span></div>${dbTableHtml(target, ctx)}</div></div>`
    }
    case 'progressBlock':
      return progressHtml(sanitizeProgress(node.attrs))
    case 'audioBlock': {
      const media = ctx.media.get((node.attrs?.mediaId as string) ?? '')
      const name = (node.attrs?.name as string) || 'Audio'
      if (!media?.dataUrl) {
        return `<div class="audio-block"><div class="audio-shell is-missing">${icon('audio-lines', 15)}<span class="audio-note">Not included: ${esc(name)}</span></div></div>`
      }
      return `<div class="audio-block" data-type="audio"><div class="audio-shell is-player" data-audio title="Play"><audio src="${media.dataUrl}" preload="metadata"></audio><div class="audio-face"><span class="audio-glyph">${icon('play', 17, 2.2)}</span><span class="audio-time">0:00</span><span class="audio-gap"></span><button type="button" class="audio-rate" title="Playback speed">1×</button></div><div class="audio-scrub" title="Seek"><div class="audio-scrub-fill"></div></div></div></div>`
    }
    case 'table': {
      const rows = node.content ?? []
      if (!rows.length) return ''
      const cellTag = (cell: JSONContent) => {
        const inner = (cell.content ?? []).map(c => blockHtml(c, ctx)).join('')
        return cell.type === 'tableHeader' ? `<th>${inner}</th>` : `<td>${inner}</td>`
      }
      const tr = (row: JSONContent) => `<tr>${(row.content ?? []).map(cellTag).join('')}</tr>`
      const hasHeader = (rows[0].content ?? []).every(c => c.type === 'tableHeader')
      const head = hasHeader ? `<thead>${tr(rows[0])}</thead>` : ''
      const body = (hasHeader ? rows.slice(1) : rows).map(tr).join('')
      return `<table>${head}<tbody>${body}</tbody></table>`
    }
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const EXPORT_MEDIA_NODES = new Set(['imageBlock', 'htmlBlock', 'audioBlock'])

function collectMediaIds(pages: Page[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (n: JSONContent | undefined) => {
    if (!n) return
    if (n.type && EXPORT_MEDIA_NODES.has(n.type) && typeof n.attrs?.mediaId === 'string') {
      out.set(n.attrs.mediaId, (n.attrs.name as string) || 'file')
    }
    n.content?.forEach(walk)
  }
  pages.forEach(p => walk(p.content ?? undefined))
  return out
}

function cardsFor(ids: Set<string>): SrsCard[] {
  return Object.values(useSrsStore.getState().cards).filter(
    c => (c.pageId && ids.has(c.pageId)) || c.refs.some(r => ids.has(r.pageId)),
  )
}

export function htmlExportCounts(rootId: string, opts: HtmlExportOptions) {
  const { pages } = useStore.getState()
  const ids = new Set([rootId, ...(opts.subpages ? descendantsOf(pages, rootId) : [])])
  return { pages: ids.size, cards: opts.cards ? cardsFor(ids).length : 0 }
}

export async function buildHtmlExport(
  rootId: string,
  opts: HtmlExportOptions,
): Promise<{ filename: string; html: string; pages: number; cards: number }> {
  const { pages } = useStore.getState()
  const root = pages[rootId]
  if (!root) throw new Error('page not found')

  const ids = [rootId, ...(opts.subpages ? descendantsOf(pages, rootId) : [])]
  const exported = new Set(ids)

  // Media → data URLs / inline text
  const media: Ctx['media'] = new Map()
  for (const [id, name] of collectMediaIds(ids.map(i => pages[i]))) {
    const rec = await getMedia(id)
    if (!rec) {
      media.set(id, { name })
      continue
    }
    if (/\.html?$/i.test(rec.name)) {
      media.set(id, { name, text: await rec.blob.text() })
    } else if (isAudioName(rec.name) && rec.blob.size > AUDIO_EXPORT_LIMIT) {
      // Base64 inflates by a third; one long recording would otherwise turn a
      // shareable page into a 40 MB download. The block says so in its place.
      media.set(id, { name })
    } else {
      const dataUrl = await new Promise<string>(resolve => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(rec.blob)
      })
      media.set(id, { name, dataUrl })
    }
  }

  const allCards: SrsCard[] = opts.cards ? cardsFor(exported) : []

  const ctx: Ctx = {
    pages,
    exported,
    media,
    hasMath: { value: false },
    cardIds: new Set(allCards.map(c => c.id)),
    fns: [],
  }
  const renderMd = (md: string): string => {
    const doc = markdownToDoc(md, () => null)
    return (doc.content.content ?? []).map(b => blockHtml(b, ctx)).join('')
  }

  // Schedules are frozen at export time: FSRS lives in the app, so the file
  // ships the answers it would have given (next-due, interval previews,
  // recall) rather than pretending to recompute them. They are shown, never
  // enforced — an export is a practice copy, not a second scheduler, and
  // gating its queue on the source vault's due dates would open most files
  // with nothing to do.
  const now = new Date()
  const dueLabel = (c: SrsCard, at: number | null): string => {
    if (c.archived || at === null) return 'archived'
    return at <= now.getTime() ? 'due now' : 'in ' + fmtInterval(at - now.getTime())
  }
  // FSRS throws on a memory state it considers impossible, and a vault can
  // carry one (hand-edited file, half-finished sync). One bad card must not
  // take the whole export down with it — the card ships without its preview.
  const previewOf = (c: SrsCard) => {
    if (c.type !== 'standard') return null
    try {
      return previewIntervals(c, now)
    } catch {
      return null
    }
  }
  const recallOf = (c: SrsCard) => {
    if (!c.fsrs?.reps) return null
    try {
      return Math.round(retrievability(c, now) * 100)
    } catch {
      return null
    }
  }
  const cardData = allCards.map(c => {
    const due = dueAt(c, now)
    return {
      id: c.id,
      front: renderMd(c.front),
      back: c.back ? renderMd(c.back) : '',
      text: stripMd(c.front) || 'Untitled card',
      backText: stripMd(c.back),
      tags: c.tags,
      type: c.type,
      archived: c.archived,
      pageId: c.pageId && exported.has(c.pageId) ? c.pageId : null,
      pages: Array.from(
        new Set([...(c.pageId ? [c.pageId] : []), ...c.refs.map(r => r.pageId)]),
      ).filter(id => exported.has(id)),
      due,
      dueLabel: dueLabel(c, due),
      schedule: scheduleLabel(c),
      intervals: previewOf(c),
      reps: c.fsrs?.reps ?? 0,
      recall: recallOf(c),
      refs: c.refs
        .filter(r => exported.has(r.pageId))
        .map(r => {
          const { text, live } = refText(pages, c, r)
          return { refId: r.refId, pageId: r.pageId, text, live }
        }),
    }
  })

  // Pages, each a full Arete page column with its own footnote margin.
  const articles = ids
    .map(id => {
      const page = pages[id]
      const head = `<div class="page-head">${page.icon ? `<div class="page-icon">${pageIconHtml(page.icon, 52)}</div>` : ''}<h1 class="page-title">${esc(page.title || 'Untitled')}</h1></div>`

      if (page.db) {
        return `<div class="page-doc" data-page="${id}" hidden><div class="db-fullpage">${head}${dbTableHtml(page, ctx)}</div></div>`
      }

      ctx.fns = [] // footnote numbering restarts on every page
      const body = (page.content?.content ?? []).map(b => blockHtml(b, ctx)).join('')
      const notes = ctx.fns.length
        ? `<div class="fn-margin">${ctx.fns
            .map(
              (f, i) =>
                `<div class="fn-note" data-fn="${escAttr(f.id)}"><div class="fn-note-head"><span class="fn-note-n">${i + 1}</span></div><div class="card-side fn-note-body"><div class="tiptap">${renderMd(f.md || '*empty footnote*')}</div></div></div>`,
            )
            .join('')}</div>`
        : ''
      const cover = page.cover ? COVERS[page.cover] : null
      return `<div class="page-doc" data-page="${id}" hidden>${cover ? `<div class="page-cover" style="background:${cover.css.replace(/\s+/g, ' ')}"></div>` : ''}<div class="page font-${page.font || 'sans'}${cover ? ' has-cover' : ''}">${head}<div class="editor-shell"><div class="tiptap ProseMirror">${body}</div></div><div class="editor-tail"></div>${notes}</div></div>`
    })
    .join('\n')

  const tree = Object.fromEntries(
    ids.map(id => [
      id,
      {
        title: pages[id].title || 'Untitled',
        icon: pageIconHtml(pages[id].icon, 15),
        parent: exported.has(pages[id].parentId ?? '') ? pages[id].parentId : null,
        children: childrenOf(pages, id).filter(c => exported.has(c.id)).map(c => c.id),
        trail: [
          ...ancestorsOf(pages, id).filter(a => exported.has(a.id)).map(a => a.id),
          id,
        ],
        text: extractText(pages[id].content).slice(0, 4000),
      },
    ]),
  )
  const roots = ids.filter(id => !tree[id].parent)

  const katexCss = ctx.hasMath.value
    ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">'
    : ''

  const data = {
    root: rootId,
    roots,
    order: ids,
    tree,
    cards: cardData,
    stamp: now.getTime(),
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(root.title || 'Untitled')}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M2 19 L9.5 5.5 L13.2 11.2 L17 4.5 L22 19' fill='none' stroke='%232E6B5E' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='miter'/%3E%3C/svg%3E">
<meta name="color-scheme" content="light dark">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=Literata:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
${katexCss}
<script>
try {
  var saved = localStorage.getItem('arete-export-theme')
  document.documentElement.dataset.theme =
    saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
} catch (e) {
  document.documentElement.dataset.theme = 'light'
}
</script>
<style>${baseCss}${sidebarCss}${pageCss}${editorCss}${menusCss}${progressCss}${audioCss}${dbCss}${srsCss}${EXPORT_CSS}</style>
</head>
<body>
<div class="app" data-sidebar="open">
  <div class="app-body">
    <div class="sidebar-wrap">
      <aside class="sidebar">
        <div class="sidebar-head">
          <div class="wordmark">${RIDGE}<span class="wordmark-name">Arete</span></div>
          <button type="button" class="icon-btn" data-sidebar-toggle title="Close sidebar (⌘\\)">${icon('panel-left-close', 16)}</button>
        </div>
        <button type="button" class="sidebar-search" data-open-search>${icon('search', 15, 1.8)}<span>Search</span><kbd class="kbd">⌘K</kbd></button>
        <nav class="sidebar-nav">
          <button type="button" class="nav-row" data-view="review">${icon('graduation-cap', 15, 1.8)}<span>Review</span><span class="due-badge" id="due-badge" hidden></span></button>
          <button type="button" class="nav-row" data-view="cards">${icon('layers', 15, 1.8)}<span>Cards</span></button>
        </nav>
        <div class="sidebar-scroll" role="tree">
          <div class="section-label">Pages</div>
          <div id="tree"></div>
        </div>
        <div class="sidebar-foot">
          <a class="new-page" href="https://smejak.github.io/arete/" target="_blank" rel="noopener">${RIDGE}<span>Made in Arete</span></a>
        </div>
      </aside>
    </div>
    <main class="main">
      <header class="topbar">
        <div class="topbar-side">
          <button type="button" class="icon-btn" data-sidebar-toggle id="sb-open" title="Open sidebar (⌘\\)" hidden>${icon('panel-left-open', 16)}</button>
          <span class="crumb is-current view-crumb" id="view-crumb" hidden></span>
          <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav>
        </div>
        <div class="topbar-side">
          <button type="button" class="icon-btn" id="theme-btn"></button>
        </div>
      </header>
      <div class="page-scroll" id="v-page">
${articles}
      </div>
      <div class="view-scroll" id="v-review" hidden></div>
      <div class="view-scroll" id="v-cards" hidden></div>
    </main>
  </div>
</div>
<div id="overlays"></div>
<script>
window.__ARETE=${JSON.stringify(data).replace(/</g, '\\u003c')};
window.__ICONS=${JSON.stringify({
    play: icon('play', 17, 2.2),
    pause: icon('pause', 17, 2.2),
    sun: icon('sun', 16),
    moon: icon('moon', 16),
    chevron: icon('chevron-right', 13, 2.4),
    cap: icon('graduation-cap', 28, 1.4),
    capSm: icon('graduation-cap', 14, 1.8),
    layers: icon('layers', 14, 1.8),
    quote: icon('quote', 12, 2),
    open: icon('external-link', 11, 2),
    search: icon('search', 17, 1.8),
    x: icon('x', 14, 1.8),
    fileCode: icon('file-code-2', 13),
    standard: icon('repeat', 12, 1.9),
    routine: icon('calendar-clock', 12, 1.9),
    temp: icon('timer', 12, 1.9),
  }).replace(/</g, '\\u003c')};
</script>
<script>${EXPORT_JS.replace(/<\/(script)/gi, '<\\/$1')}</script>
</body>
</html>`

  return {
    filename: sanitizeFilename(root.title || 'Untitled') + '.html',
    html,
    pages: ids.length,
    cards: cardData.length,
  }
}

// ---------------------------------------------------------------------------
// Export-only stylesheet — the small delta between "Arete" and "Arete you
// cannot type in". Everything above this line is the app's real CSS.
// ---------------------------------------------------------------------------

const EXPORT_CSS = `
/* The app hides things by unmounting them; this file hides them with the
   attribute, and half these classes carry a display of their own. */
[hidden]{display:none!important}
/* Titles are textareas in the editor and headings here. */
h1.page-title{margin:0;font-family:inherit}
.page.font-serif h1.page-title{font-family:var(--font-serif)}
.page.font-mono h1.page-title{font-family:var(--font-mono)}
/* Read-only affordances: nothing here takes a caret or a hover promise. */
.tiptap{caret-color:transparent}
.page-icon{cursor:default}
.page-icon:hover{background:none}
.tiptap ul[data-type='taskList'] input[type='checkbox']{cursor:default}
.tiptap ul[data-type='taskList'] input[type='checkbox']:hover{border-color:var(--text-3)}
.callout-emoji:hover{background:none}
.pr-hit{cursor:default}
.pr-hit:hover{background:none}
.dbt-th,.dbt-cell{cursor:default}
.image-shell{display:block}
.image-shell img{cursor:zoom-in}
.fn-note{cursor:default}
/* The sidebar footer link stands in for "New page". */
.sidebar-foot .new-page{color:var(--text-3);text-decoration:none;font-size:13px}
.sidebar-foot .new-page:hover{color:var(--accent);background:var(--bg-hover)}
.sidebar-foot .new-page svg{flex:none}
/* Expanded embed, portalled the way the editor portals it. */
.media-modal iframe{flex:1;min-height:0;width:100%;border:0;border-radius:8px;background:#fff}
/* A card opened from the browser: the review card, framed as a modal. */
.card-modal{width:min(640px,100%)}
.card-modal .modal-body{padding:16px 20px 20px;overflow-y:auto}
.card-modal .review-card{border:0;box-shadow:none;padding:0;background:none}
.export-note{text-align:center;font-size:11.5px;color:var(--text-3);margin-top:8px;font-style:italic}
`

// ---------------------------------------------------------------------------
// Export runtime — vanilla JS, no dependencies. It plays the part of the
// app's router, sidebar, review loop and card browser.
// ---------------------------------------------------------------------------

const EXPORT_JS = `
(function(){
var D=window.__ARETE,I=window.__ICONS;
var TYPE_LABEL={standard:'Spaced',routine:'Routine',temp:'Temporary'};
var RATINGS=[{r:1,label:'Again',key:'1',kind:'again'},{r:2,label:'Hard',key:'2',kind:'ok'},{r:3,label:'Good',key:'3',kind:'ok'},{r:4,label:'Easy',key:'4',kind:'ok'}];

var view='page',current=null,expanded={},overlays=document.getElementById('overlays');
var vPage=document.getElementById('v-page'),vReview=document.getElementById('v-review'),vCards=document.getElementById('v-cards');

function el(html){var d=document.createElement('div');d.innerHTML=html;return d.firstElementChild}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function fmtMs(ms){var s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}

// ---------------------------------------------------------------- theme ----
var themeBtn=document.getElementById('theme-btn');
function paintTheme(){
  var dark=document.documentElement.dataset.theme==='dark';
  themeBtn.innerHTML=dark?I.sun:I.moon;
  themeBtn.title=dark?'Switch to light':'Switch to dark';
}
themeBtn.onclick=function(){
  var next=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  try{localStorage.setItem('arete-export-theme',next)}catch(e){}
  paintTheme();
};
paintTheme();

// -------------------------------------------------------------- sidebar ----
var app=document.querySelector('.app'),sbOpen=document.getElementById('sb-open');
function setSidebar(open){
  app.dataset.sidebar=open?'open':'closed';
  sbOpen.hidden=open;
}
Array.prototype.forEach.call(document.querySelectorAll('[data-sidebar-toggle]'),function(b){
  b.onclick=function(){setSidebar(app.dataset.sidebar!=='open')};
});

function renderTree(){
  var host=document.getElementById('tree');
  host.innerHTML='';
  var walk=function(ids,depth){
    ids.forEach(function(id){
      var n=D.tree[id];
      var row=el('<div class="tree-row" role="treeitem"><span class="row-slot"><span class="row-icon">'+n.icon+'</span>'+
        '<button type="button" class="row-toggle">'+I.chevron+'</button></span>'+
        '<span class="row-title">'+esc(n.title)+'</span></div>');
      row.style.paddingLeft=(10+depth*14)+'px';
      if(id===current&&view==='page')row.classList.add('is-active');
      var open=!!expanded[id];
      if(open)row.querySelector('.row-toggle svg').classList.add('is-open');
      row.querySelector('.row-toggle').onclick=function(e){
        e.stopPropagation();expanded[id]=!open;renderTree();
      };
      row.onclick=function(){show(id)};
      host.appendChild(row);
      if(open){
        if(n.children.length)walk(n.children,depth+1);
        else{
          var empty=el('<div class="tree-empty">No pages inside</div>');
          empty.style.paddingLeft=(10+(depth+1)*14+24)+'px';
          host.appendChild(empty);
        }
      }
    });
  };
  walk(D.roots,0);
}

// ------------------------------------------------------------ navigation ----
var crumbs=document.getElementById('crumbs'),viewCrumb=document.getElementById('view-crumb');

var VIEW_META={review:{icon:'capSm',label:'Review'},cards:{icon:'layers',label:'Cards'}};

function setView(next){
  var was=view;
  view=next;
  vPage.hidden=next!=='page';
  vReview.hidden=next!=='review';
  vCards.hidden=next!=='cards';
  Array.prototype.forEach.call(document.querySelectorAll('.nav-row'),function(b){
    b.classList.toggle('is-active',b.getAttribute('data-view')===next);
  });
  crumbs.hidden=next!=='page';
  viewCrumb.hidden=next==='page';
  if(next!=='page'){
    viewCrumb.innerHTML=I[VIEW_META[next].icon]+'<span class="crumb-title">'+VIEW_META[next].label+'</span>';
  }
  // Entering review afresh deals a new queue; coming back mid-session keeps it.
  if(next==='review'){if(was!=='review'&&!queue.length)startSession();renderReview()}
  if(next==='cards')renderCards();
  renderTree();
}

function show(id){
  current=id;
  Array.prototype.forEach.call(document.querySelectorAll('.page-doc'),function(a){
    a.hidden=a.getAttribute('data-page')!==id;
  });
  crumbs.innerHTML='';
  (D.tree[id].trail||[id]).forEach(function(pid,i){
    if(i>0){var sep=document.createElement('span');sep.className='crumb-sep';sep.textContent='/';crumbs.appendChild(sep)}
    var b=el('<button type="button" class="crumb"><span class="crumb-icon">'+D.tree[pid].icon+'</span><span class="crumb-title">'+esc(D.tree[pid].title)+'</span></button>');
    if(pid===id)b.classList.add('is-current');
    b.onclick=function(){show(pid)};
    crumbs.appendChild(b);
  });
  // Open the tree down to the page you landed on, like the app does.
  (D.tree[id].trail||[]).slice(0,-1).forEach(function(p){expanded[p]=true});
  setView('page');
  vPage.scrollTop=0;
  requestAnimationFrame(function(){layoutNotes(id)});
  if(history.replaceState)history.replaceState(null,'',id===D.root?location.pathname+location.search:'#'+id);
}

// --------------------------------------------------------- footnote rail ----
// Same three-layout rule as the app: notes beside a centered column, the
// column leaning left when the margin is tight, nothing when there is no room.
function layoutNotes(id){
  var doc=document.querySelector('.page-doc[data-page="'+id+'"]');
  if(!doc)return;
  var page=doc.querySelector('.page'),margin=doc.querySelector('.fn-margin');
  if(!page||!margin)return;
  var GAP=26;
  var centeredRoom=(vPage.clientWidth-page.offsetWidth)/2-GAP;
  page.classList.toggle('fn-lean',centeredRoom<100);
  var pageRect=page.getBoundingClientRect();
  var room=vPage.getBoundingClientRect().right-pageRect.right-GAP-8;
  margin.hidden=room<90;
  if(margin.hidden)return;
  margin.style.width=Math.max(90,Math.min(210,room))+'px';
  var bottom=-1e9;
  Array.prototype.forEach.call(margin.querySelectorAll('.fn-note'),function(note){
    var ref=page.querySelector('.fn-ref[data-fn="'+note.getAttribute('data-fn')+'"]');
    if(!ref||!ref.offsetParent){note.style.display='none';return}
    note.style.display='';
    var block=ref;
    while(block.parentElement&&!block.parentElement.classList.contains('tiptap'))block=block.parentElement;
    var top=block.getBoundingClientRect().top-pageRect.top;
    if(top<bottom+10)top=bottom+10;
    note.style.top=top+'px';
    bottom=top+note.offsetHeight;
  });
}
window.addEventListener('resize',function(){if(view==='page'&&current)layoutNotes(current)});

// ------------------------------------------------------------- highlights ---
// The app's flash, copied: a stylesheet keyed on the data attribute, because
// the class would not survive a re-render there. Here it just keeps parity.
function flashRefs(cardId,refId){
  var sel='span.cardref[data-card="'+cardId+'"]'+(refId?'[data-ref="'+refId+'"]':'');
  var span=document.querySelector('.page-doc:not([hidden]) '+sel);
  if(!span)return false;
  span.scrollIntoView({block:'center',behavior:'smooth'});
  var style=document.createElement('style');
  style.textContent=sel+'{background:var(--hl);box-shadow:0 0 0 2.5px var(--hl);border-radius:3px;transition:background .25s ease,box-shadow .25s ease}';
  document.head.appendChild(style);
  setTimeout(function(){
    style.textContent=sel+'{background:transparent;box-shadow:0 0 0 2.5px transparent;border-radius:3px;transition:background 1.2s ease,box-shadow 1.2s ease}';
    setTimeout(function(){style.remove()},1300);
  },5000);
  return true;
}
// A block reference is matched on its words, so a paragraph reworded since
// simply is not found and the jump lands at the top of the page instead.
function flashBlockText(text){
  var doc=document.querySelector('.page-doc:not([hidden]) .tiptap');
  if(!doc)return false;
  // Whitespace-insensitive, so a reference stored before the text extraction
  // was tightened still finds its paragraph.
  var norm=function(s){return String(s||'').replace(/\s+/g,' ').trim()};
  var want=norm(text);
  var hit=Array.prototype.filter.call(doc.children,function(el){
    return norm(el.textContent).indexOf(want)>=0;
  })[0];
  if(!hit)return false;
  hit.scrollIntoView({block:'center'});
  hit.classList.add('block-flash');
  setTimeout(function(){
    hit.classList.add('is-fading');
    setTimeout(function(){hit.classList.remove('block-flash','is-fading')},1300);
  },4000);
  return true;
}

function openAtRef(cardId,ref){
  closeOverlays();
  show(ref.pageId);
  requestAnimationFrame(function(){flashRefs(cardId,ref.refId)});
}

// ----------------------------------------------------------------- cards ----
// Everything that shipped is practisable. The source vault's due dates order
// the queue — overdue first — but they never hold a card back: whoever opens
// this file has no schedule of their own, and a deck they cannot practise is
// just a list.
function typeChip(c,withLabel){
  return '<span class="type-chip type-'+c.type+'">'+I[c.type]+(withLabel?TYPE_LABEL[c.type]:'')+'</span>';
}
function deckTitle(c){
  return c.pageId&&D.tree[c.pageId]?D.tree[c.pageId].title:'Unfiled';
}
function refsBlock(card){
  if(!card.refs.length)return '';
  return '<div class="review-refs"><button type="button" class="refs-toggle" data-refs-toggle>'+I.quote+' Refs · '+card.refs.length+'</button>'+
    '<div class="refs-list" hidden>'+card.refs.map(function(r,i){
      return '<div class="refs-item"><div class="refs-quote"><span class="refs-n">'+(i+1)+'</span><span class="refs-text">'+esc(r.text)+'</span></div>'+
        '<div class="refs-src">'+(r.live?'':'<span class="refs-stale">as highlighted — text has changed</span>')+
        '<span class="refs-page">'+D.tree[r.pageId].icon+' '+esc(D.tree[r.pageId].title)+'</span>'+
        '<button type="button" class="refs-open" data-open-ref="'+i+'">'+I.open+' Open</button></div></div>';
    }).join('')+'</div></div>';
}
function wireRefs(scope,card){
  var toggle=scope.querySelector('[data-refs-toggle]');
  if(toggle)toggle.onclick=function(){
    var list=scope.querySelector('.refs-list');list.hidden=!list.hidden;
  };
  Array.prototype.forEach.call(scope.querySelectorAll('[data-open-ref]'),function(b){
    b.onclick=function(){openAtRef(card.id,card.refs[+b.getAttribute('data-open-ref')])};
  });
}

// ---------------------------------------------------------------- review ----
// A session, not a schedule: the queue is dealt once, Again sends a card to
// the back of it, and everything else retires the card until the file is
// reopened. There is nowhere in an HTML file to write a review to.
var deck='all',queue=[],revealed=false,reviewed=0,started=false;
var retired={};

function inDeck(c){return deck==='all'||(deck==='unfiled'?!c.pageId:c.pageId===deck)}
/** Still to see in this session: shipped, not archived at the source, not
 * already answered since the file was opened. */
function pending(c){return !c.archived&&!retired[c.id]}
function startSession(){
  queue=D.cards.filter(function(c){return pending(c)&&inDeck(c)})
    .sort(function(a,b){
      // Overdue first, then the rest by how soon they were next wanted.
      var ad=a.due===null?Infinity:a.due, bd=b.due===null?Infinity:b.due;
      return ad-bd;
    });
  revealed=false;
}
function dueBadge(){
  var n=D.cards.filter(pending).length;
  var badge=document.getElementById('due-badge');
  badge.hidden=n===0;badge.textContent=n;
}
function deckSelect(){
  var counts={};
  D.cards.filter(pending).forEach(function(c){
    var k=c.pageId||'unfiled';counts[k]=(counts[k]||0)+1;
  });
  var total=Object.keys(counts).reduce(function(a,k){return a+counts[k]},0);
  var opts=[{id:'all',label:'All cards · '+total}];
  if(counts.unfiled||deck==='unfiled')opts.push({id:'unfiled',label:'Unfiled · '+(counts.unfiled||0)});
  var ids=Object.keys(counts).filter(function(k){return k!=='unfiled'&&D.tree[k]});
  if(deck!=='all'&&deck!=='unfiled'&&D.tree[deck]&&ids.indexOf(deck)<0)ids.push(deck);
  ids.map(function(id){return{id:id,title:D.tree[id].title,n:counts[id]||0}})
    .sort(function(a,b){return b.n-a.n||a.title.localeCompare(b.title)})
    .forEach(function(p){opts.push({id:p.id,label:p.title+' · '+p.n})});
  if(opts.length<2)return '';
  return '<select class="cf-mini cf-select review-deck-filter" id="deck-filter">'+
    opts.map(function(o){return '<option value="'+esc(o.id)+'"'+(o.id===deck?' selected':'')+'>'+esc(o.label)+'</option>'}).join('')+'</select>';
}

function renderReview(){
  var card=queue[0];
  if(!card){
    var picker=deckSelect();
    var shipped=D.cards.filter(function(c){return !c.archived}).length;
    var title=started?'Session complete':shipped?'Nothing in this deck':'No cards in this export';
    var sub=started
      ? 'You reviewed '+reviewed+' card'+(reviewed===1?'':'s')+'. Reload the file to run through them again.'
      : shipped
        ? 'Pick another deck above to keep practising.'
        : 'This page was shared without its cards.';
    vReview.innerHTML='<div class="review-wrap">'+(picker?'<div class="review-meta">'+picker+'</div>':'')+
      '<div class="review-empty">'+I.cap+
      '<div class="review-empty-title">'+title+'</div>'+
      '<div class="review-empty-sub">'+sub+'</div></div></div>';
    wireDeck();
    return;
  }
  var deckPage=card.pageId&&D.tree[card.pageId];
  vReview.innerHTML='<div class="review-wrap">'+
    '<div class="review-meta"><span class="review-count">'+queue.length+' to review · '+reviewed+' reviewed this session</span>'+deckSelect()+'</div>'+
    '<div class="review-card">'+
      '<div class="review-card-top">'+typeChip(card,true)+
        '<span class="review-schedule">'+esc(card.schedule)+'</span>'+
        (deckPage?'<button type="button" class="review-deck" data-goto-deck>'+deckPage.icon+' <span>'+esc(deckPage.title)+'</span></button>':'')+
      '</div>'+
      '<div class="card-side review-front"><div class="tiptap">'+card.front+'</div></div>'+
      (revealed
        ? '<div class="review-divider"></div><div class="card-side review-back"><div class="tiptap">'+(card.back||'<p><span class="review-noback">—</span></p>')+'</div></div>'
        : '<button type="button" class="review-reveal" id="reveal">Show answer <kbd class="kbd">space</kbd></button>')+
      refsBlock(card)+
    '</div>'+
    (revealed?'<div class="review-ratings">'+RATINGS.map(function(x){
      var sub=card.intervals?card.intervals[x.r]:(x.r===1?'retry':card.type==='temp'?'counts':'done');
      return '<button type="button" class="rate-btn rate-'+(x.kind==='again'?'again':'ok')+'" data-rate="'+x.r+'">'+
        '<span class="rate-label">'+x.label+'</span><span class="rate-sub">'+esc(sub)+'</span><kbd class="kbd">'+x.key+'</kbd></button>';
    }).join('')+'</div>':'')+
    '<div class="review-hint">'+
      (card.type==='routine'?'Routine cards return on their schedule — only correct answers advance it.':
       card.type==='temp'?'A temporary card: high density now, gone when it expires.':
       'Intervals grow with every correct answer.')+
    '</div>'+
    '<div class="export-note">Answers are not saved — this is an export.</div>'+
  '</div>';

  var reveal=document.getElementById('reveal');
  if(reveal)reveal.onclick=function(){revealed=true;renderReview()};
  Array.prototype.forEach.call(vReview.querySelectorAll('[data-rate]'),function(b){
    b.onclick=function(){rate(+b.getAttribute('data-rate'))};
  });
  var deckBtn=vReview.querySelector('[data-goto-deck]');
  if(deckBtn)deckBtn.onclick=function(){show(card.pageId)};
  wireRefs(vReview,card);
  wireDeck();
}

function wireDeck(){
  var sel=document.getElementById('deck-filter');
  if(sel)sel.onchange=function(){deck=sel.value;startSession();renderReview()};
}

function rate(r){
  var card=queue.shift();
  if(!card)return;
  started=true;reviewed++;
  if(r===1)queue.push(card);else retired[card.id]=true;
  revealed=false;
  renderReview();
  dueBadge();
}

// ----------------------------------------------------------- cards browser --
// The toolbar is built once and only the list repaints, so the search field
// keeps its caret while you type.
var cq='',cDeck='all',cType='all',cStatus='active',cardsBuilt=false;

function renderCards(){
  if(cardsBuilt){paintCardList();return}
  var decks={};
  D.cards.forEach(function(c){if(c.pageId&&D.tree[c.pageId])decks[c.pageId]=D.tree[c.pageId].title});
  vCards.innerHTML='<div class="cards-wrap">'+
    '<div class="view-head"><h1 class="view-title">Cards</h1></div>'+
    '<div class="cards-toolbar">'+
      '<div class="cards-search">'+I.search+'<input id="cq" placeholder="Search cards…" spellcheck="false"></div>'+
      '<select class="cf-mini cf-select" id="c-deck"><option value="all">All decks</option><option value="unfiled">Unfiled</option>'+
        Object.keys(decks).map(function(id){return '<option value="'+esc(id)+'">'+esc(decks[id])+'</option>'}).join('')+'</select>'+
      '<select class="cf-mini cf-select" id="c-type">'+
        ['all|All types','standard|Spaced','routine|Routine','temp|Temporary'].map(function(o){
          var p=o.split('|');return '<option value="'+p[0]+'">'+p[1]+'</option>'}).join('')+'</select>'+
      '<select class="cf-mini cf-select" id="c-status">'+
        ['active|Active','archived|Archived','all|All'].map(function(o){
          var p=o.split('|');return '<option value="'+p[0]+'">'+p[1]+'</option>'}).join('')+'</select>'+
    '</div><div id="cards-list"></div></div>';

  var input=document.getElementById('cq');
  input.oninput=function(){cq=input.value;paintCardList()};
  document.getElementById('c-deck').onchange=function(){cDeck=this.value;paintCardList()};
  document.getElementById('c-type').onchange=function(){cType=this.value;paintCardList()};
  document.getElementById('c-status').onchange=function(){cStatus=this.value;paintCardList()};
  cardsBuilt=true;
  paintCardList();
}

function paintCardList(){
  var q=cq.trim().toLowerCase();
  var list=D.cards.filter(function(c){
    if(cStatus!=='all'&&(cStatus==='archived')!==!!c.archived)return false;
    if(cType!=='all'&&c.type!==cType)return false;
    if(cDeck==='unfiled'?!!c.pageId:cDeck!=='all'&&c.pageId!==cDeck)return false;
    if(q&&(c.text+' '+c.backText+' '+c.tags.join(' ')).toLowerCase().indexOf(q)<0)return false;
    return true;
  });
  var host=document.getElementById('cards-list');
  host.innerHTML=list.length
    ? '<div class="cards-list">'+list.map(function(c){
        // The source vault's schedule, frozen — except for cards answered
        // here, which say so rather than still claiming to be waiting.
        var due=retired[c.id]?'reviewed':c.dueLabel;
        return '<div class="card-row'+(c.archived?' is-archived':'')+'">'+
          // not data-card: that attribute belongs to the highlight spans.
          '<button type="button" class="card-row-body" data-open-card="'+esc(c.id)+'">'+typeChip(c,false)+
          '<span class="card-row-main"><span class="card-row-front">'+esc(c.text)+'</span>'+
          '<span class="card-row-sub">'+(c.backText?'<span class="card-row-back">'+esc(c.backText)+'</span>':'')+
          c.tags.map(function(t){return '<span class="tag-chip">#'+esc(t)+'</span>'}).join('')+'</span></span>'+
          '<span class="card-row-deck">'+esc(deckTitle(c))+'</span>'+
          '<span class="card-row-r">'+(c.recall===null?'—':c.recall+'%')+'</span>'+
          '<span class="card-row-due'+(due==='due now'?' is-due':'')+'">'+due+'</span></button></div>';
      }).join('')+'</div>'
    : '<div class="cards-empty">No cards match<span class="cards-empty-sub">Try a different search or filter.</span></div>';
  Array.prototype.forEach.call(host.querySelectorAll('[data-open-card]'),function(b){
    b.onclick=function(){openCard(b.getAttribute('data-open-card'))};
  });
}

function openCard(id){
  var card=D.cards.filter(function(c){return c.id===id})[0];
  if(!card)return;
  var deckPage=card.pageId&&D.tree[card.pageId];
  var overlay=el('<div class="modal-overlay"><div class="modal-panel card-modal">'+
    '<div class="modal-head"><span class="modal-title">Card</span><button type="button" class="icon-btn sm" data-close>'+I.x+'</button></div>'+
    '<div class="modal-body"><div class="review-card">'+
      '<div class="review-card-top">'+typeChip(card,true)+'<span class="review-schedule">'+esc(card.schedule)+'</span>'+
      (deckPage?'<button type="button" class="review-deck" data-goto-deck>'+deckPage.icon+' <span>'+esc(deckPage.title)+'</span></button>':'')+'</div>'+
      '<div class="card-side review-front"><div class="tiptap">'+card.front+'</div></div>'+
      (card.back?'<div class="review-divider"></div><div class="card-side review-back"><div class="tiptap">'+card.back+'</div></div>':'')+
      refsBlock(card)+
    '</div></div></div></div>');
  overlay.onmousedown=function(e){if(e.target===overlay)closeOverlays()};
  overlay.querySelector('[data-close]').onclick=closeOverlays;
  var deckBtn=overlay.querySelector('[data-goto-deck]');
  if(deckBtn)deckBtn.onclick=function(){closeOverlays();show(card.pageId)};
  wireRefs(overlay,card);
  overlays.appendChild(overlay);
}

// ---------------------------------------------------------------- search ----
function openSearch(){
  var overlay=el('<div class="search-overlay"><div class="search-panel">'+
    '<div class="search-input-row">'+I.search+'<input class="search-input" placeholder="Search pages…" spellcheck="false"></div>'+
    '<div class="search-results"></div>'+
    '<div class="search-foot"><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> navigate</span>'+
    '<span><kbd class="kbd">↵</kbd> open</span><span><kbd class="kbd">esc</kbd> dismiss</span></div></div></div>');
  var input=overlay.querySelector('.search-input'),results=overlay.querySelector('.search-results'),index=0,hits=[];
  function score(){
    var q=input.value.trim().toLowerCase();
    if(!q)return D.order.slice(0,8);
    return D.order.map(function(id){
      var t=D.tree[id].title.toLowerCase(),s=0;
      if(t.indexOf(q)===0)s+=60;else if(t.indexOf(q)>=0)s+=40;
      if(D.tree[id].text.toLowerCase().indexOf(q)>=0)s+=12;
      return{id:id,s:s};
    }).filter(function(x){return x.s>0}).sort(function(a,b){return b.s-a.s}).map(function(x){return x.id}).slice(0,9);
  }
  function paint(){
    hits=score();
    if(!hits.length){results.innerHTML='<div class="search-empty">No pages match “'+esc(input.value.trim())+'”.</div>';return}
    results.innerHTML='<div class="search-section">'+(input.value.trim()?'Results':'Pages')+'</div>'+
      hits.map(function(id,i){
        var path=D.tree[id].trail.slice(0,-1).map(function(p){return esc(D.tree[p].title)}).join(' / ');
        return '<button type="button" class="search-item"'+(i===index?' data-selected':'')+' data-i="'+i+'">'+
          '<span class="search-item-icon">'+D.tree[id].icon+'</span>'+
          '<span class="search-item-text"><span class="search-item-title">'+esc(D.tree[id].title)+'</span>'+
          (path?'<span class="search-item-path">'+path+'</span>':'')+'</span></button>';
      }).join('');
    Array.prototype.forEach.call(results.querySelectorAll('[data-i]'),function(b){
      b.onclick=function(){closeOverlays();show(hits[+b.getAttribute('data-i')])};
      b.onmousemove=function(){index=+b.getAttribute('data-i');paint()};
    });
  }
  input.oninput=function(){index=0;paint()};
  input.onkeydown=function(e){
    if(e.key==='ArrowDown'){e.preventDefault();index=Math.min(index+1,hits.length-1);paint()}
    else if(e.key==='ArrowUp'){e.preventDefault();index=Math.max(index-1,0);paint()}
    else if(e.key==='Enter'){e.preventDefault();if(hits[index]){closeOverlays();show(hits[index])}}
  };
  overlay.onmousedown=function(e){if(e.target===overlay)closeOverlays()};
  overlays.appendChild(overlay);
  paint();
  input.focus();
}

function closeOverlays(){overlays.innerHTML=''}

// ------------------------------------------------------- embeds and audio ---
document.addEventListener('click',function(e){
  var goto=e.target.closest('[data-goto]');
  if(goto){
    e.preventDefault();
    var quote=goto.getAttribute('data-flash');
    show(goto.getAttribute('data-goto'));
    // A block reference lands on its paragraph, not the top of the page.
    if(quote)requestAnimationFrame(function(){flashBlockText(quote)});
    return;
  }

  var nav=e.target.closest('.nav-row');
  if(nav){setView(nav.getAttribute('data-view'));return}

  var searchBtn=e.target.closest('[data-open-search]');
  if(searchBtn){openSearch();return}

  var arrow=e.target.closest('[data-toggle]');
  if(arrow){arrow.closest('.toggle-block').classList.toggle('is-open');
    if(view==='page'&&current)layoutNotes(current);return}

  var expand=e.target.closest('[data-embed-expand]');
  if(expand){
    var frame=expand.closest('.html-block').querySelector('iframe');
    var name=expand.closest('.html-block').querySelector('.html-name').textContent;
    var root=el('<div class="media-modal-root"><div class="media-backdrop"></div>'+
      '<div class="media-modal"><div class="html-head">'+I.fileCode+'<span class="html-name">'+esc(name)+'</span>'+
      '<button type="button" class="icon-btn sm" title="Close (esc)" data-close>'+I.x+'</button></div></div></div>');
    var clone=frame.cloneNode(true);
    root.querySelector('.media-modal').appendChild(clone);
    root.querySelector('.media-backdrop').onclick=closeOverlays;
    root.querySelector('[data-close]').onclick=closeOverlays;
    overlays.appendChild(root);
    return;
  }

  var img=e.target.closest('.image-shell img');
  if(img){
    // The app's viewer, minus the gesture: an export has no React to hang the
    // pinch handler on, so this is the same full-screen frame, tap to close.
    var box=el('<div class="media-viewer"><button type="button" class="media-viewer-close">'+I.x+
      '</button><img src="'+img.getAttribute('src')+'" alt="'+
      esc(img.getAttribute('alt')||'').replace(/"/g,'&quot;')+'"></div>');
    box.onclick=closeOverlays;
    overlays.appendChild(box);
    return;
  }

  var fnRef=e.target.closest('.fn-ref');
  if(fnRef){
    var doc=fnRef.closest('.page-doc');
    var note=doc.querySelector('.fn-note[data-fn="'+fnRef.getAttribute('data-fn')+'"]');
    if(note&&!note.closest('.fn-margin').hidden){
      note.classList.remove('is-hot');void note.offsetWidth;note.classList.add('is-hot');
    }
    return;
  }
});

// The whole face plays and pauses; the scrubber and the speed control own
// their own zones, exactly as in the editor.
document.addEventListener('click',function(e){
  var shell=e.target.closest('[data-audio]');
  if(!shell)return;
  var audio=shell.querySelector('audio');
  if(e.target.closest('.audio-rate')){
    var rates=[1,1.25,1.5,2,0.75],next=rates[(rates.indexOf(audio.playbackRate)+1)%rates.length];
    audio.playbackRate=next;
    shell.querySelector('.audio-rate').textContent=next+'×';
    return;
  }
  if(e.target.closest('.audio-scrub')){
    var bar=shell.querySelector('.audio-scrub'),rect=bar.getBoundingClientRect();
    if(audio.duration)audio.currentTime=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*audio.duration;
    return;
  }
  if(audio.paused)audio.play();else audio.pause();
});
document.addEventListener('play',function(e){
  var shell=e.target.closest('[data-audio]');
  if(!shell)return;
  shell.classList.add('is-playing');
  shell.querySelector('.audio-glyph').innerHTML=I.pause;
},true);
document.addEventListener('pause',function(e){
  var shell=e.target.closest('[data-audio]');
  if(!shell)return;
  shell.classList.remove('is-playing');
  shell.querySelector('.audio-glyph').innerHTML=I.play;
},true);
function paintAudio(shell,a,at){
  var total=isFinite(a.duration)?a.duration:0;
  shell.querySelector('.audio-time').innerHTML=fmtMs(at*1000)+
    (total?'<span class="audio-total"> / '+fmtMs(total*1000)+'</span>':'');
  shell.querySelector('.audio-scrub-fill').style.width=total?Math.min(100,(at/total)*100)+'%':'0%';
}
// The length shows before you press play, as it does in the editor.
document.addEventListener('loadedmetadata',function(e){
  var shell=e.target.closest('[data-audio]');
  if(shell)paintAudio(shell,e.target,e.target.currentTime);
},true);
document.addEventListener('timeupdate',function(e){
  var shell=e.target.closest('[data-audio]');
  if(shell)paintAudio(shell,e.target,e.target.currentTime);
},true);
document.addEventListener('ended',function(e){
  var shell=e.target.closest('[data-audio]');
  if(!shell)return;
  shell.classList.remove('is-playing');
  shell.querySelector('.audio-glyph').innerHTML=I.play;
  e.target.currentTime=0;
  paintAudio(shell,e.target,0);
},true);

// -------------------------------------------------------------- keyboard ----
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(overlays.firstChild){closeOverlays();return}
  }
  if(e.metaKey||e.ctrlKey){
    if(e.key.toLowerCase()==='k'){e.preventDefault();overlays.firstChild?closeOverlays():openSearch()}
    else if(e.key==='\\\\'){e.preventDefault();setSidebar(app.dataset.sidebar!=='open')}
    return;
  }
  if(e.altKey||overlays.firstChild)return;
  var tag=(e.target||{}).tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(view!=='review'||!queue.length)return;
  if(!revealed&&(e.key===' '||e.key==='Enter')){e.preventDefault();revealed=true;renderReview()}
  else if(revealed){
    if(e.key===' '){e.preventDefault();rate(3);return}
    for(var i=0;i<RATINGS.length;i++){
      if(RATINGS[i].key===e.key){e.preventDefault();rate(RATINGS[i].r);return}
    }
  }
});

// ------------------------------------------------------------------ boot ----
// The top level starts open: a reader arriving at a shared file should see
// what else is in it without hunting for a chevron.
D.roots.forEach(function(id){expanded[id]=true});
dueBadge();
var initial=(location.hash||'').slice(1);
show(D.tree[initial]?initial:D.root);
})();
`
