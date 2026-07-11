import katex from 'katex'
import type { JSONContent } from '@tiptap/core'
import type { Page, SrsCard } from '../store/types'
import { useStore } from '../store/store'
import { useSrsStore } from '../store/srs-store'
import { childrenOf, descendantsOf, ancestorsOf } from './tree'
import { markdownToDoc, sanitizeFilename } from './markdown'
import { applySorts, cellText, evalFilter, isEmptyCell, orderedFields } from './db'
import { getMedia } from './media'

/**
 * Interactive HTML export: one self-contained file that reads like Arete —
 * same alpine palette, same page column — but view-only in any browser.
 * Nested pages become in-file sections with breadcrumb navigation; cards
 * become chips in the right margin of the blocks their highlights touch,
 * opening a review panel (front → answer, flip freely; no scheduling).
 */

export interface HtmlExportOptions {
  subpages: boolean
  cards: boolean
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

interface Ctx {
  pages: Record<string, Page>
  exported: Set<string>
  media: Map<string, { dataUrl?: string; text?: string; name: string }>
  hasMath: { value: boolean }
  /** Highlights only render for cards that ship with the export — orphaned
   * or excluded card marks come out as plain text. */
  cardIds: Set<string>
}

// ---------------------------------------------------------------------------
// Inline + block rendering
// ---------------------------------------------------------------------------

function math(latex: string, display: boolean, ctx: Ctx): string {
  ctx.hasMath.value = true
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false })
  } catch {
    return `<code>${esc(latex)}</code>`
  }
}

function pageAnchor(ctx: Ctx, pageId: string | null, inline: boolean): string {
  const page = pageId ? ctx.pages[pageId] : undefined
  const title = page ? page.title || 'Untitled' : 'Missing page'
  const icon = page?.icon ? esc(page.icon) : '📄'
  if (page && ctx.exported.has(page.id)) {
    return inline
      ? `<a class="x-mention" data-goto="${page.id}">${icon} <span>${esc(title)}</span></a>`
      : `<a class="x-pagelink" data-goto="${page.id}"><span class="x-pl-icon">${icon}</span>${esc(title)}</a>`
  }
  return inline
    ? `<span class="x-mention is-dead">${icon} <span>${esc(title)}</span></span>`
    : `<span class="x-pagelink is-dead"><span class="x-pl-icon">${icon}</span>${esc(title)}</span>`
}

function inlineHtml(nodes: JSONContent[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map(n => {
      if (n.type === 'hardBreak') return '<br>'
      if (n.type === 'mathInline') return math((n.attrs?.latex as string) ?? '', false, ctx)
      if (n.type === 'pageMention') return pageAnchor(ctx, (n.attrs?.pageId as string) ?? null, true)
      if (n.type !== 'text') return ''
      let out = esc(n.text ?? '')
      const marks = [...(n.marks ?? [])].sort((a, b) =>
        (a.type === 'cardref' ? 1 : 0) - (b.type === 'cardref' ? 1 : 0),
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
            if (ctx.cardIds.has(cardId)) {
              out = `<span class="x-ref" data-card="${escAttr(cardId)}">${out}</span>`
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
      const inner = (item.content ?? []).map(c => blockHtml(c, ctx)).join('')
      if (kind === 'task') {
        const checked = item.attrs?.checked === true
        return `<li class="x-task${checked ? ' is-done' : ''}"><span class="x-box">${checked ? '✓' : ''}</span><div>${inner}</div></li>`
      }
      return `<li>${inner}</li>`
    })
    .join('')
  if (kind === 'task') return `<ul class="x-tasks">${items}</ul>`
  return kind === 'ul' ? `<ul>${items}</ul>` : `<ol>${items}</ol>`
}

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
  const head = fields
    .map(f => `<th style="min-width:${view.columnMeta[f.id]?.width ?? (f.type === 'title' ? 220 : 140)}px">${esc(f.name)}</th>`)
    .join('')
  const body = rows
    .map(row => {
      const cells = fields
        .map(f => {
          if (f.type === 'checkbox') {
            const on = row.props?.[f.id] === true
            return `<td><span class="x-box${on ? ' is-done' : ''}">${on ? '✓' : ''}</span></td>`
          }
          if (f.type === 'select' || f.type === 'multiSelect') {
            const ids = f.type === 'select'
              ? typeof row.props?.[f.id] === 'string' ? [row.props[f.id] as string] : []
              : Array.isArray(row.props?.[f.id]) ? (row.props![f.id] as string[]) : []
            const chips = ids
              .map(id => {
                const o = f.config.options?.find(x => x.id === id)
                return o ? `<span class="x-chip xo-${o.color}">${esc(o.name)}</span>` : ''
              })
              .join(' ')
            return `<td>${chips}</td>`
          }
          const text = isEmptyCell(f, row) ? '' : cellText(f, row)
          const cls = f.type === 'title' ? ' class="x-cell-title"' : ''
          return `<td${cls}>${esc(text)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  return `<div class="x-db"><div class="x-db-title">${esc(dbPage.title || 'Untitled')}</div><div class="x-db-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`
}

function blockHtml(node: JSONContent, ctx: Ctx): string {
  switch (node.type) {
    case 'paragraph': {
      const inner = inlineHtml(node.content, ctx)
      return `<p>${inner || '&nbsp;'}</p>`
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
    case 'callout':
      return `<div class="x-callout"><span class="x-callout-emoji">${esc((node.attrs?.emoji as string) || '💡')}</span><div>${(node.content ?? []).map(c => blockHtml(c, ctx)).join('')}</div></div>`
    case 'codeBlock':
      return `<pre><code>${esc((node.content ?? []).map(c => c.text ?? '').join(''))}</code></pre>`
    case 'horizontalRule': return '<hr>'
    case 'mathBlock': return `<div class="x-math">${math((node.attrs?.latex as string) ?? '', true, ctx)}</div>`
    case 'toggle': {
      const children = node.content ?? []
      const summary = inlineHtml(children[0]?.content, ctx)
      const body = children.slice(1).map(c => blockHtml(c, ctx)).join('')
      return `<details${node.attrs?.open === false ? '' : ' open'}><summary>${summary}</summary><div class="x-toggle-body">${body}</div></details>`
    }
    case 'pageLink':
      return pageAnchor(ctx, (node.attrs?.pageId as string) ?? null, false)
    case 'imageBlock': {
      const media = ctx.media.get((node.attrs?.mediaId as string) ?? '')
      if (!media?.dataUrl) return `<p class="x-missing">Missing image: ${esc((node.attrs?.name as string) || '')}</p>`
      const width = node.attrs?.width ? ` style="width:${Number(node.attrs.width)}px"` : ''
      return `<figure class="x-img"><img src="${media.dataUrl}" alt="${escAttr((node.attrs?.name as string) || '')}"${width}></figure>`
    }
    case 'htmlBlock': {
      const media = ctx.media.get((node.attrs?.mediaId as string) ?? '')
      const name = esc((node.attrs?.name as string) || 'embed.html')
      if (media?.text === undefined) return `<p class="x-missing">Missing embed: ${name}</p>`
      const height = Number(node.attrs?.height) || 420
      return `<div class="x-embed"><div class="x-embed-head"><span>${name}</span><button class="x-embed-expand" title="Expand">⤢</button></div><iframe sandbox="allow-scripts" style="height:${height}px" srcdoc="${escAttr(media.text)}"></iframe></div>`
    }
    case 'databaseBlock': {
      const target = ctx.pages[(node.attrs?.pageId as string) ?? '']
      return target?.db ? dbTableHtml(target, ctx) : ''
    }
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function collectMediaIds(pages: Page[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (n: JSONContent | undefined) => {
    if (!n) return
    if ((n.type === 'imageBlock' || n.type === 'htmlBlock') && typeof n.attrs?.mediaId === 'string') {
      out.set(n.attrs.mediaId, (n.attrs.name as string) || 'file')
    }
    n.content?.forEach(walk)
  }
  pages.forEach(p => walk(p.content ?? undefined))
  return out
}

export function htmlExportCounts(rootId: string, opts: HtmlExportOptions) {
  const { pages } = useStore.getState()
  const ids = new Set([rootId, ...(opts.subpages ? descendantsOf(pages, rootId) : [])])
  const cards = opts.cards
    ? Object.values(useSrsStore.getState().cards).filter(
        c => (c.pageId && ids.has(c.pageId)) || c.refs.some(r => ids.has(r.pageId)),
      ).length
    : 0
  return { pages: ids.size, cards }
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
    } else {
      const dataUrl = await new Promise<string>(resolve => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(rec.blob)
      })
      media.set(id, { name, dataUrl })
    }
  }

  // Cards
  const allCards: SrsCard[] = opts.cards
    ? Object.values(useSrsStore.getState().cards).filter(
        c => (c.pageId && exported.has(c.pageId)) || c.refs.some(r => exported.has(r.pageId)),
      )
    : []

  const ctx: Ctx = {
    pages,
    exported,
    media,
    hasMath: { value: false },
    cardIds: new Set(allCards.map(c => c.id)),
  }
  const renderCardSide = (md: string): string => {
    const doc = markdownToDoc(md, () => null)
    return (doc.content.content ?? []).map(b => blockHtml(b, ctx)).join('')
  }
  const cardData = allCards.map(c => ({
    id: c.id,
    front: renderCardSide(c.front),
    back: c.back ? renderCardSide(c.back) : '',
    tags: c.tags,
    pages: Array.from(
      new Set([...(c.pageId ? [c.pageId] : []), ...c.refs.map(r => r.pageId)]),
    ).filter(id => exported.has(id)),
  }))

  // Articles
  const articles = ids
    .map(id => {
      const page = pages[id]
      if (page.db) {
        return `<article data-page="${id}" hidden><div class="x-head">${page.icon ? `<div class="x-icon">${esc(page.icon)}</div>` : ''}<h1 class="x-title">${esc(page.title || 'Untitled')}</h1></div>${dbTableHtml(page, ctx)}</article>`
      }
      const body = (page.content?.content ?? []).map(b => blockHtml(b, ctx)).join('')
      return `<article data-page="${id}" hidden><div class="x-head">${page.icon ? `<div class="x-icon">${esc(page.icon)}</div>` : ''}<h1 class="x-title">${esc(page.title || 'Untitled')}</h1></div><div class="x-body">${body}</div></article>`
    })
    .join('\n')

  const crumbs = JSON.stringify(
    Object.fromEntries(
      ids.map(id => [
        id,
        [...ancestorsOf(pages, id).filter(a => exported.has(a.id)).map(a => a.id), id],
      ]),
    ),
  )
  const titles = JSON.stringify(
    Object.fromEntries(ids.map(id => [id, pages[id].title || 'Untitled'])),
  )

  const katexCss = ctx.hasMath.value
    ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">'
    : ''

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(root.title || 'Untitled')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=Literata:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
${katexCss}
<style>${EXPORT_CSS}</style>
</head>
<body>
<header class="x-bar"><nav class="x-crumbs" id="crumbs"></nav><a class="x-made" href="https://smejak.github.io/arete/" target="_blank" rel="noopener">made in Arete</a></header>
<main class="x-main">${articles}</main>
<div class="x-rail" id="rail"></div>
<div class="x-cardpanel" id="cardpanel" hidden></div>
<div class="x-modal" id="cardmodal" hidden><div class="x-modal-back"></div><div class="x-modal-box"></div></div>
<script>
window.__CARDS=${JSON.stringify(cardData).replace(/</g, '\\u003c')};
window.__CRUMBS=${crumbs.replace(/</g, '\\u003c')};
window.__TITLES=${titles.replace(/</g, '\\u003c')};
window.__ROOT=${JSON.stringify(rootId)};
</script>
<script>${EXPORT_JS.replace(/<\//g, '<\\/')}</script>
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
// Export stylesheet — a compact, read-only cut of the alpine language
// ---------------------------------------------------------------------------

const EXPORT_CSS = `
:root{--bg:#fafbfa;--bg-pop:#fff;--bg-hover:rgba(38,66,58,.066);--text:#202825;--text-2:#5b6b64;--text-3:#94a29b;--border:rgba(32,58,49,.11);--border-strong:rgba(32,58,49,.2);--accent:#2e6b5e;--accent-soft:rgba(46,107,94,.11);--glow:rgba(236,143,100,.33);--hl:rgba(242,164,113,.35);--code-inline:#a2512d;--code-bg:rgba(32,58,49,.062);--callout-bg:rgba(46,107,94,.072);--shadow:0 0 0 1px rgba(32,58,49,.08),0 6px 18px rgba(20,34,29,.1),0 24px 54px -12px rgba(20,34,29,.3)}
@media (prefers-color-scheme:dark){:root{--bg:#151918;--bg-pop:#232a28;--bg-hover:rgba(220,240,232,.062);--text:#e2e9e5;--text-2:#9fafa7;--text-3:#64716b;--border:rgba(224,240,233,.085);--border-strong:rgba(224,240,233,.17);--accent:#6fbaa5;--accent-soft:rgba(111,186,165,.14);--glow:rgba(224,120,80,.36);--hl:rgba(228,148,98,.31);--code-inline:#e2926c;--code-bg:rgba(224,240,233,.07);--callout-bg:rgba(111,186,165,.085);--shadow:0 0 0 1px rgba(0,0,0,.5),0 10px 24px rgba(0,0,0,.4),0 30px 70px -12px rgba(0,0,0,.6)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Schibsted Grotesk',-apple-system,sans-serif;font-size:16px;line-height:1.62;-webkit-font-smoothing:antialiased}
.x-bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 22px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);font-size:13px}
.x-crumbs{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;white-space:nowrap}
.x-crumbs a{color:var(--text-2);text-decoration:none;padding:3px 7px;border-radius:6px;cursor:pointer}
.x-crumbs a:hover{background:var(--bg-hover);color:var(--text)}
.x-crumbs .sep{color:var(--text-3)}
.x-crumbs .here{color:var(--text);font-weight:600;padding:3px 7px}
.x-made{color:var(--text-3);font-size:11.5px;letter-spacing:.04em;text-decoration:none;white-space:nowrap}
.x-made:hover{color:var(--accent)}
.x-main{max-width:708px;margin:0 auto;padding:44px 40px 120px}
article[hidden]{display:none}
.x-head{margin-bottom:14px}
.x-icon{font-size:62px;line-height:1;margin-bottom:8px}
.x-title{font-size:38px;font-weight:700;letter-spacing:-.02em;margin:0;line-height:1.15}
p{margin:0;padding:3.5px 0}
h1,h2,h3{line-height:1.25;font-weight:700;letter-spacing:-.018em;padding:3px 0 1px}
h1{font-size:1.84em;margin:26px 0 2px}h2{font-size:1.44em;margin:20px 0 1px}h3{font-size:1.2em;margin:14px 0 0}
ul,ol{margin:1px 0;padding-left:26px}
li{padding:1.5px 0}
li::marker{color:var(--text-2)}
a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--border-strong)}
a:hover{color:var(--accent)}
code{font-family:'IBM Plex Mono',monospace;font-size:.85em;background:var(--code-bg);color:var(--code-inline);padding:2px 5px;border-radius:5px}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin:8px 0;overflow-x:auto}
pre code{background:none;color:var(--text);padding:0;font-size:13.5px;line-height:1.65}
mark{background:var(--hl);color:inherit;border-radius:2.5px;padding:.5px 1px}
blockquote{margin:6px 0;padding:1px 0 1px 16px;border-left:2.5px solid var(--text)}
hr{border:none;height:1px;background:var(--border-strong);margin:11px 0}
.x-callout{display:flex;gap:11px;background:var(--callout-bg);border-radius:10px;padding:13px 16px 13px 11px;margin:6px 0}
.x-callout-emoji{flex:none;width:30px;height:30px;display:grid;place-items:center;font-size:18px}
.x-tasks{list-style:none;padding-left:2px}
.x-task{display:flex;gap:9px}
.x-box{flex:none;width:16px;height:16px;margin-top:5px;border:1.5px solid var(--text-3);border-radius:4.5px;display:grid;place-items:center;font-size:11px;color:#fff}
.x-task.is-done .x-box,.x-box.is-done{background:var(--accent);border-color:var(--accent)}
.x-task.is-done>div{color:var(--text-3);text-decoration:line-through}
details{margin:1px 0}
summary{cursor:pointer;padding:3.5px 0}
.x-toggle-body{padding-left:22px}
.x-math{padding:6px 0;overflow-x:auto}
.x-pagelink{display:flex;align-items:center;gap:9px;padding:5px 8px;margin:2px -8px;border-radius:7px;text-decoration:none;font-weight:600;cursor:pointer}
.x-pagelink:hover{background:var(--bg-hover);color:inherit}
.x-mention{white-space:nowrap;font-weight:600;text-decoration:none;border-bottom:1px solid var(--border-strong);cursor:pointer}
.x-img{margin:6px 0}
.x-img img{max-width:100%;border-radius:8px;display:block}
.x-embed{margin:8px 0}
.x-embed-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 2px 6px;color:var(--text-2);font-size:12.5px;font-family:'IBM Plex Mono',monospace}
.x-embed-expand{border:0;background:none;color:var(--text-2);font-size:15px;cursor:pointer;border-radius:5px;padding:2px 6px}
.x-embed-expand:hover{background:var(--bg-hover)}
.x-embed iframe{width:100%;border:1px solid var(--border);border-radius:10px;background:#fff;display:block}
.x-embed.is-full{position:fixed;inset:3% 4%;z-index:60;margin:0;background:var(--bg-pop);border-radius:12px;box-shadow:var(--shadow);padding:10px 14px;display:flex;flex-direction:column}
.x-embed.is-full iframe{flex:1;height:auto!important}
.x-db{margin:8px 0}
.x-db-title{font-weight:700;padding-bottom:6px}
.x-db-scroll{overflow-x:auto;border-top:1px solid var(--border)}
.x-db table{border-collapse:collapse;font-size:14px;min-width:100%}
.x-db th{text-align:left;font-size:13px;font-weight:500;color:var(--text-2);padding:6px 8px;border-bottom:1px solid var(--border);border-right:1px solid var(--border)}
.x-db td{padding:6px 8px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);vertical-align:top}
.x-cell-title{font-weight:600}
.x-chip{display:inline-block;padding:1.5px 8px;border-radius:20px;font-size:12.5px;font-weight:500;background:var(--bg-hover);color:var(--text-2)}
.xo-green{background:#d9e9e1;color:#2e6b5e}.xo-blue{background:#d9e6ec;color:#2e657c}.xo-red{background:#f2dcd5;color:#a24632}.xo-orange{background:#f6e2d1;color:#96541f}.xo-yellow{background:#f2ebcf;color:#7d651a}.xo-purple{background:#e5dfef;color:#5c4a8a}.xo-pink{background:#f0dde6;color:#94476b}.xo-brown{background:#ebe1d8;color:#6d4f38}.xo-gray{background:#e3e7e5;color:#4b5651}
@media (prefers-color-scheme:dark){.xo-green{background:rgba(111,186,165,.18);color:#8fcab7}.xo-blue{background:rgba(120,180,205,.18);color:#93c2d6}.xo-red{background:rgba(217,106,77,.2);color:#dd9480}.xo-orange{background:rgba(226,146,92,.2);color:#e0a377}.xo-yellow{background:rgba(212,186,100,.18);color:#d3bd7e}.xo-purple{background:rgba(160,140,220,.19);color:#b6a6dd}.xo-pink{background:rgba(214,130,170,.17);color:#d9a2bd}.xo-brown{background:rgba(190,145,105,.22);color:#d3ab88}.xo-gray{background:rgba(224,240,233,.13);color:#b7c2bd}}
.x-missing{color:var(--text-3);font-style:italic}
.x-ref{background:var(--hl);border-radius:2.5px}
.x-ref.is-live{outline:2px solid var(--glow)}
.x-rail{position:absolute;top:0;left:0;width:0}
.x-cardbtn{position:absolute;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;border:1px solid var(--border);background:var(--bg-pop);color:var(--accent);font-size:13px;cursor:pointer;box-shadow:0 1px 4px rgba(20,34,29,.08);transition:transform .12s ease}
.x-cardbtn:hover{transform:scale(1.08);border-color:var(--accent)}
.x-cardpanel{position:absolute;width:330px;background:var(--bg-pop);border-radius:12px;box-shadow:var(--shadow);padding:14px 16px;z-index:40}
.x-cp-head{display:flex;align-items:center;justify-content:space-between;color:var(--text-3);font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px}
.x-cp-btns{display:flex;gap:2px}
.x-cp-btns button{border:0;background:none;color:var(--text-2);cursor:pointer;border-radius:5px;padding:3px 6px;font-size:13px}
.x-cp-btns button:hover{background:var(--bg-hover)}
.x-cp-front{font-weight:600}
.x-cp-back{border-top:1px solid var(--border);margin-top:10px;padding-top:10px}
.x-cp-reveal{margin-top:12px;width:100%;border:1px solid var(--border);background:var(--accent-soft);color:var(--accent);font-weight:600;font-size:13px;padding:7px 0;border-radius:8px;cursor:pointer}
.x-cp-reveal:hover{filter:brightness(1.05)}
.x-cardsec{margin-top:34px;border-top:1px solid var(--border);padding-top:14px}
.x-cardsec-title{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:8px}
.x-cardsec .x-cardchip{display:inline-flex;align-items:center;gap:7px;margin:0 6px 6px 0;padding:6px 12px;border:1px solid var(--border);border-radius:9px;background:var(--bg-pop);cursor:pointer;font-size:13.5px;max-width:100%}
.x-cardsec .x-cardchip:hover{border-color:var(--accent)}
.x-cardchip .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
.x-cardchip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.x-modal{position:fixed;inset:0;z-index:80}
.x-modal-back{position:absolute;inset:0;background:rgba(12,17,15,.45)}
.x-modal-box{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(640px,calc(100vw - 60px));max-height:84vh;overflow-y:auto;background:var(--bg-pop);border-radius:14px;box-shadow:var(--shadow);padding:20px 24px}
`

// ---------------------------------------------------------------------------
// Export runtime — vanilla JS, no dependencies
// ---------------------------------------------------------------------------

const EXPORT_JS = `
(function(){
var CARDS=window.__CARDS,CRUMBS=window.__CRUMBS,TITLES=window.__TITLES,ROOT=window.__ROOT;
var main=document.querySelector('.x-main');
var rail=document.getElementById('rail');
var panel=document.getElementById('cardpanel');
var modal=document.getElementById('cardmodal');
var current=null,openCard=null;

function esc(s){return String(s)}

function show(id){
  current=id;
  document.querySelectorAll('article[data-page]').forEach(function(a){a.hidden=a.getAttribute('data-page')!==id});
  var trail=CRUMBS[id]||[id];
  var nav=document.getElementById('crumbs');
  nav.innerHTML='';
  trail.forEach(function(pid,i){
    if(i===trail.length-1){var b=document.createElement('span');b.className='here';b.textContent=TITLES[pid]||'Untitled';nav.appendChild(b)}
    else{var a=document.createElement('a');a.textContent=TITLES[pid]||'Untitled';a.onclick=function(){show(pid)};nav.appendChild(a);var s=document.createElement('span');s.className='sep';s.textContent='/';nav.appendChild(s)}
  });
  closeCard();
  buildCardSection(id);
  requestAnimationFrame(function(){layoutChips(id)});
  window.scrollTo(0,0);
  if(history.replaceState)history.replaceState(null,'','#'+id);
}

function article(){return document.querySelector('article[data-page="'+current+'"]')}

function blockOf(el){
  var a=article();var n=el;
  while(n&&n.parentElement&&n.parentElement!==a&&!n.parentElement.classList.contains('x-body')){n=n.parentElement}
  return n;
}

function setLive(card,on){
  article().querySelectorAll('.x-ref[data-card="'+card.id+'"]').forEach(function(s){
    if(on)s.classList.add('is-live');else if(openCard!==card.id)s.classList.remove('is-live');
  });
}

function layoutChips(id){
  rail.innerHTML='';
  var a=article();if(!a)return;
  var seen={};
  CARDS.forEach(function(card){
    if(card.pages.indexOf(id)<0)return;
    // One chip per card, at the first block its highlights touch; hovering
    // lights up every reference the card has on the page.
    var spans=a.querySelectorAll('.x-ref[data-card="'+card.id+'"]');
    if(!spans.length)return;
    var b=blockOf(spans[0]);
    if(!b)return;
    var top=b.getBoundingClientRect().top+window.scrollY;
    var key=Math.round(top/28);
    var shift=(seen[key]||0);seen[key]=shift+1;
    var btn=document.createElement('button');
    btn.className='x-cardbtn';btn.title='Review card';btn.textContent='✦';
    btn.style.top=(top+2)+'px';
    btn.style.left=(a.getBoundingClientRect().right+window.scrollX+14+shift*32)+'px';
    btn.onclick=function(ev){ev.stopPropagation();openPanel(card,top)};
    btn.onmouseenter=function(){setLive(card,true)};
    btn.onmouseleave=function(){setLive(card,false)};
    rail.appendChild(btn);
  });
}

function cardBody(card,expanded){
  var d=document.createElement('div');
  d.innerHTML='<div class="x-cp-head"><span>Card</span><span class="x-cp-btns">'+
    (expanded?'':'<button data-act="expand" title="Expand">⤢</button>')+
    '<button data-act="close" title="Close">✕</button></span></div>'+
    '<div class="x-cp-front">'+card.front+'</div>'+
    (card.back?'<div class="x-cp-back" hidden>'+card.back+'</div><button class="x-cp-reveal">Show answer</button>':'');
  var back=d.querySelector('.x-cp-back');
  var reveal=d.querySelector('.x-cp-reveal');
  if(reveal)reveal.onclick=function(){
    var hid=back.hidden;back.hidden=!hid;reveal.textContent=hid?'Hide answer':'Show answer';
  };
  d.querySelector('[data-act="close"]').onclick=function(){expanded?closeModal():closeCard()};
  var ex=d.querySelector('[data-act="expand"]');
  if(ex)ex.onclick=function(){closeCard();openModal(card)};
  return d;
}

function openPanel(card,top){
  closeCard();
  openCard=card.id;
  panel.hidden=false;panel.innerHTML='';
  panel.appendChild(cardBody(card,false));
  var a=article();
  panel.style.top=top+'px';
  panel.style.left=(a.getBoundingClientRect().right+window.scrollX+50)+'px';
  var vw=document.documentElement.clientWidth;
  var rect=panel.getBoundingClientRect();
  if(rect.right>vw-12)panel.style.left=(vw-rect.width-12+window.scrollX)+'px';
  a.querySelectorAll('.x-ref[data-card="'+card.id+'"]').forEach(function(s){s.classList.add('is-live')});
}

function closeCard(){
  panel.hidden=true;openCard=null;
  document.querySelectorAll('.x-ref.is-live').forEach(function(s){s.classList.remove('is-live')});
}

function openModal(card){
  modal.hidden=false;
  var box=modal.querySelector('.x-modal-box');
  box.innerHTML='';box.appendChild(cardBody(card,true));
}
function closeModal(){modal.hidden=true}
modal.querySelector('.x-modal-back').onclick=closeModal;

function buildCardSection(id){
  var old=article().querySelector('.x-cardsec');if(old)old.remove();
  var mine=CARDS.filter(function(c){return c.pages.indexOf(id)>=0});
  if(!mine.length)return;
  var sec=document.createElement('div');sec.className='x-cardsec';
  sec.innerHTML='<div class="x-cardsec-title">Cards from this page — '+mine.length+'</div>';
  mine.forEach(function(card){
    var chip=document.createElement('button');chip.className='x-cardchip';
    var tmp=document.createElement('div');tmp.innerHTML=card.front;
    chip.innerHTML='<span class="dot"></span><span>'+esc(tmp.textContent).slice(0,80)+'</span>';
    chip.onclick=function(){openModal(card)};
    sec.appendChild(chip);
  });
  article().appendChild(sec);
}

document.addEventListener('click',function(e){
  var go=e.target.closest('[data-goto]');
  if(go){e.preventDefault();show(go.getAttribute('data-goto'));return}
  var expand=e.target.closest('.x-embed-expand');
  if(expand){
    var em=expand.closest('.x-embed');
    em.classList.toggle('is-full');
    expand.textContent=em.classList.contains('is-full')?'✕':'⤢';
    return;
  }
  if(openCard&&!e.target.closest('.x-cardpanel')&&!e.target.closest('.x-cardbtn'))closeCard();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(!modal.hidden)closeModal();
    else if(openCard)closeCard();
    else document.querySelectorAll('.x-embed.is-full').forEach(function(em){em.classList.remove('is-full');em.querySelector('.x-embed-expand').textContent='⤢'});
  }
});
window.addEventListener('resize',function(){if(current)layoutChips(current)});

var initial=(location.hash||'').slice(1);
show(TITLES[initial]!==undefined?initial:ROOT);
})();
`
