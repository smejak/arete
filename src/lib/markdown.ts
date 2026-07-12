import type { JSONContent } from '@tiptap/core'
import type { Page } from '../store/types'

/**
 * Markdown round-trip for vault mode: pages live on disk as plain markdown
 * (Obsidian-compatible where possible). Frontmatter carries page metadata,
 * folders carry hierarchy, `[[wikilinks]]` carry references — `![[…]]` for
 * owning subpage blocks, `[[…]]` for links and mentions. Card highlights
 * serialize as inline HTML spans so the anchors survive.
 */

// ---------------------------------------------------------------------------
// Serialize: TipTap JSON → markdown
// ---------------------------------------------------------------------------

type TitleResolver = (pageId: string) => string | null

function inlineToMd(node: JSONContent, resolve: TitleResolver): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'mathInline') return `$${node.attrs?.latex ?? ''}$`
  if (node.type === 'pageMention') {
    const title = node.attrs?.pageId ? resolve(node.attrs.pageId as string) : null
    return `[[${title ?? 'arete:' + (node.attrs?.pageId ?? '?')}]]`
  }
  if (node.type !== 'text') return ''

  let out = node.text ?? ''
  const marks = node.marks ?? []
  const has = (t: string) => marks.some(m => m.type === t)
  const get = (t: string) => marks.find(m => m.type === t)

  if (has('code')) out = '`' + out + '`'
  if (has('bold')) out = `**${out}**`
  if (has('italic')) out = `*${out}*`
  if (has('strike')) out = `~~${out}~~`
  if (has('highlight')) out = `==${out}==`
  if (has('underline')) out = `<u>${out}</u>`
  const link = get('link')
  if (link?.attrs?.href) out = `[${out}](${link.attrs.href})`
  const card = get('cardref')
  if (card?.attrs?.cardId) {
    out = `<span data-card="${card.attrs.cardId}" data-ref="${card.attrs.refId ?? ''}">${out}</span>`
  }
  return out
}

function inlinesToMd(nodes: JSONContent[] | undefined, resolve: TitleResolver): string {
  return (nodes ?? []).map(n => inlineToMd(n, resolve)).join('')
}

function listToMd(
  node: JSONContent,
  resolve: TitleResolver,
  indent: string,
  ordered: boolean,
  task: boolean,
): string {
  const lines: string[] = []
  let i = 1
  for (const item of node.content ?? []) {
    const checked = task && item.attrs?.checked === true
    const bullet = ordered ? `${i}.` : '-'
    const box = task ? (checked ? ' [x]' : ' [ ]') : ''
    let first = true
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') {
        const text = inlinesToMd(child.content, resolve)
        lines.push(first ? `${indent}${bullet}${box} ${text}` : `${indent}  ${text}`)
        first = false
      } else if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
        lines.push(
          listToMd(child, resolve, indent + '  ', child.type === 'orderedList', child.type === 'taskList'),
        )
        first = false
      }
    }
    i++
  }
  return lines.join('\n')
}

function blockToMd(node: JSONContent, resolve: TitleResolver): string | null {
  switch (node.type) {
    case 'paragraph': {
      return inlinesToMd(node.content, resolve)
    }
    case 'heading':
      return `${'#'.repeat(Math.min(3, (node.attrs?.level as number) || 1))} ${inlinesToMd(node.content, resolve)}`
    case 'bulletList':
      return listToMd(node, resolve, '', false, false)
    case 'orderedList':
      return listToMd(node, resolve, '', true, false)
    case 'taskList':
      return listToMd(node, resolve, '', false, true)
    case 'blockquote':
      return (node.content ?? [])
        .map(child => inlinesToMd(child.content, resolve))
        .map(line => `> ${line}`)
        .join('\n')
    case 'callout': {
      const emoji = (node.attrs?.emoji as string) ?? ''
      const head = emoji ? `> [!note] ${emoji}` : '> [!note]'
      const inner = (node.content ?? [])
        .map(child => blockToMd(child, resolve))
        .filter((b): b is string => b !== null)
        .join('\n\n')
      const body = inner ? inner.split('\n').map(l => ('> ' + l).trimEnd()) : []
      return [head, ...body].join('\n')
    }
    case 'toggle': {
      // Obsidian's foldable-callout syntax: `-` after the tag means folded.
      const children = node.content ?? []
      const fold = node.attrs?.open === false ? '-' : ''
      const head = `> [!toggle]${fold} ${inlinesToMd(children[0]?.content, resolve)}`.trimEnd()
      const inner = children
        .slice(1)
        .map(child => blockToMd(child, resolve))
        .filter((b): b is string => b !== null)
        .join('\n\n')
      const body = inner ? inner.split('\n').map(l => ('> ' + l).trimEnd()) : []
      return [head, ...body].join('\n')
    }
    case 'codeBlock':
      return '```\n' + ((node.content ?? []).map(c => c.text ?? '').join('') || '') + '\n```'
    case 'horizontalRule':
      return '---'
    case 'mathBlock':
      return `$$\n${node.attrs?.latex ?? ''}\n$$`
    case 'pageLink': {
      const id = node.attrs?.pageId as string | null
      const title = id ? resolve(id) : null
      const target = title ?? 'arete:' + (id ?? '?')
      return node.attrs?.owner ? `![[${target}]]` : `[[${target}]]`
    }
    case 'imageBlock':
    case 'htmlBlock': {
      // `![name|size](media/<id>__<file>)` — Obsidian-style size suffix.
      const id = (node.attrs?.mediaId as string) ?? ''
      const name = (node.attrs?.name as string) || 'file'
      const size = node.type === 'imageBlock' ? node.attrs?.width : node.attrs?.height
      const label = size ? `${name}|${size}` : name
      return `![${label}](media/${id}__${sanitizeFilename(name) || 'file'})`
    }
    default:
      return null
  }
}

export function docToMarkdown(doc: JSONContent | null | undefined, resolve: TitleResolver): string {
  const blocks = (doc?.content ?? [])
    .map(b => blockToMd(b, resolve))
    .filter((b): b is string => b !== null)
  // Trim trailing empty paragraphs so files stay tidy.
  while (blocks.length && blocks[blocks.length - 1] === '') blocks.pop()
  return blocks.join('\n\n') + '\n'
}

export function pageToMarkdown(page: Page, resolve: TitleResolver): string {
  const fm: string[] = ['---', `arete-id: ${page.id}`]
  if (page.icon) fm.push(`icon: ${page.icon}`)
  if (page.cover) fm.push(`cover: ${page.cover}`)
  if (page.font !== 'sans') fm.push(`font: ${page.font}`)
  fm.push(`order: ${page.order}`)
  fm.push(`created: ${new Date(page.createdAt).toISOString()}`)
  fm.push(`updated: ${new Date(page.updatedAt).toISOString()}`)
  // Databases round-trip as single-line JSON (stringify emits no newlines).
  if (page.db) fm.push(`arete-db: ${JSON.stringify(page.db)}`)
  if (page.props && Object.keys(page.props).length) {
    fm.push(`arete-props: ${JSON.stringify(page.props)}`)
  }
  fm.push('---', '')
  return fm.join('\n') + docToMarkdown(page.content, resolve)
}

export function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
  return cleaned || 'Untitled'
}

// ---------------------------------------------------------------------------
// Parse: markdown → TipTap JSON
// ---------------------------------------------------------------------------

type LinkResolver = (title: string) => string | null

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): JSONContent =>
  marks && marks.length ? { type: 'text', text, marks } : { type: 'text', text }

type Mark = { type: string; attrs?: Record<string, unknown> }

function withMark(nodes: JSONContent[], mark: Mark): JSONContent[] {
  return nodes.map(n =>
    n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), mark] } : n,
  )
}

interface InlinePattern {
  re: RegExp
  handle: (m: RegExpExecArray, resolve: LinkResolver) => JSONContent[]
}

const INLINE_PATTERNS: InlinePattern[] = [
  {
    re: /<span data-card="([^"]+)" data-ref="([^"]*)">([\s\S]*?)<\/span>/,
    handle: (m, r) =>
      withMark(parseInline(m[3], r), { type: 'cardref', attrs: { cardId: m[1], refId: m[2] || null } }),
  },
  {
    re: /`([^`]+)`/,
    handle: m => [t(m[1], [{ type: 'code' }])],
  },
  {
    re: /\$([^$\n]+)\$/,
    handle: m => [{ type: 'mathInline', attrs: { latex: m[1] } }],
  },
  {
    re: /\[\[([^\]]+)\]\]/,
    handle: (m, r) => {
      const id = resolveWikiTarget(m[1], r)
      return id
        ? [{ type: 'pageMention', attrs: { pageId: id } }]
        : [t(m[1])]
    },
  },
  {
    re: /<u>([\s\S]*?)<\/u>/,
    handle: (m, r) => withMark(parseInline(m[1], r), { type: 'underline' }),
  },
  {
    // Bold+italic serializes as ***text*** — must match before plain bold,
    // which would otherwise eat **text** out of the middle and strand a
    // literal * on each side (dropping the italic).
    re: /\*\*\*([^*\n]+)\*\*\*/,
    handle: (m, r) =>
      withMark(withMark(parseInline(m[1], r), { type: 'italic' }), { type: 'bold' }),
  },
  {
    re: /\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/,
    handle: (m, r) => withMark(parseInline(m[1], r), { type: 'bold' }),
  },
  {
    re: /~~([^~]+)~~/,
    handle: (m, r) => withMark(parseInline(m[1], r), { type: 'strike' }),
  },
  {
    re: /==([^=]+)==/,
    handle: (m, r) => withMark(parseInline(m[1], r), { type: 'highlight' }),
  },
  {
    re: /\[([^\]]*)\]\(([^)\s]+)\)/,
    handle: (m, r) =>
      withMark(parseInline(m[1] || m[2], r), { type: 'link', attrs: { href: m[2] } }),
  },
  {
    re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/,
    handle: (m, r) => withMark(parseInline(m[1], r), { type: 'italic' }),
  },
]

export function resolveWikiTarget(target: string, resolve: LinkResolver): string | null {
  const clean = target.split('|')[0].trim()
  if (clean.startsWith('arete:')) return clean.slice(6) || null
  return resolve(clean)
}

export function parseInline(text: string, resolve: LinkResolver): JSONContent[] {
  const out: JSONContent[] = []
  let rest = text
  while (rest.length) {
    let earliest: { index: number; match: RegExpExecArray; pattern: InlinePattern } | null = null
    for (const pattern of INLINE_PATTERNS) {
      const m = pattern.re.exec(rest)
      if (m && (earliest === null || m.index < earliest.index)) {
        earliest = { index: m.index, match: m, pattern }
      }
    }
    if (!earliest) {
      out.push(t(rest))
      break
    }
    if (earliest.index > 0) out.push(t(rest.slice(0, earliest.index)))
    out.push(...earliest.pattern.handle(earliest.match, resolve))
    rest = rest.slice(earliest.index + earliest.match[0].length)
  }
  return out.filter(n => n.type !== 'text' || (n.text && n.text.length))
}

const p = (content: JSONContent[]): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' }

interface ListLine {
  indent: number
  ordered: boolean
  checked: boolean | null
  text: string
}

function buildList(lines: ListLine[], resolve: LinkResolver): JSONContent {
  const base = lines[0].indent
  const ordered = lines[0].ordered
  const task = lines[0].checked !== null
  const items: JSONContent[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const children: JSONContent[] = [p(parseInline(line.text, resolve))]
    const nested: ListLine[] = []
    i++
    while (i < lines.length && lines[i].indent > base) {
      nested.push(lines[i])
      i++
    }
    if (nested.length) children.push(buildList(nested, resolve))
    items.push(
      task
        ? { type: 'taskItem', attrs: { checked: line.checked === true }, content: children }
        : { type: 'listItem', content: children },
    )
  }
  return {
    type: task ? 'taskList' : ordered ? 'orderedList' : 'bulletList',
    content: items,
  }
}

export interface ParsedMarkdown {
  meta: Record<string, string>
  content: JSONContent
}

export function markdownToDoc(md: string, resolve: LinkResolver): ParsedMarkdown {
  const meta: Record<string, string> = {}
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let i = 0

  if (lines[0] === '---') {
    i = 1
    while (i < lines.length && lines[i] !== '---') {
      const m = /^([A-Za-z-]+):\s*(.*)$/.exec(lines[i])
      if (m) meta[m[1]] = m[2]
      i++
    }
    i++ // past closing ---
  }

  const blocks = parseBlocks(lines.slice(i), resolve)
  if (!blocks.length) blocks.push({ type: 'paragraph' })
  return { meta, content: { type: 'doc', content: blocks } }
}

/** Parse a run of markdown lines into blocks. Recurses into toggle bodies. */
function parseBlocks(lines: string[], resolve: LinkResolver): JSONContent[] {
  const blocks: JSONContent[] = []
  const listBuffer: ListLine[] = []
  let i = 0
  const flushList = () => {
    if (listBuffer.length) {
      blocks.push(buildList([...listBuffer], resolve))
      listBuffer.length = 0
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    const list = /^(\s*)(?:([-*+])|(\d+)\.)\s(?:\[([ xX])\]\s)?(.*)$/.exec(line)
    if (list) {
      listBuffer.push({
        indent: Math.floor(list[1].length / 2),
        ordered: list[3] !== undefined,
        checked: list[4] === undefined ? null : list[4].toLowerCase() === 'x',
        text: list[5],
      })
      i++
      continue
    }
    flushList()

    if (!line.trim()) {
      i++
      continue
    }

    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++
      blocks.push({
        type: 'codeBlock',
        content: code.length ? [t(code.join('\n'))] : undefined,
      })
      continue
    }

    const mathOneLine = /^\$\$(.+)\$\$\s*$/.exec(line)
    if (mathOneLine) {
      blocks.push({ type: 'mathBlock', attrs: { latex: mathOneLine[1].trim() } })
      i++
      continue
    }
    if (line.trim() === '$$') {
      const math: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '$$') {
        math.push(lines[i])
        i++
      }
      i++
      blocks.push({ type: 'mathBlock', attrs: { latex: math.join('\n').trim() } })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        attrs: { level: Math.min(3, heading[1].length) },
        content: parseInline(heading[2], resolve),
      })
      i++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'horizontalRule' })
      i++
      continue
    }

    const mediaEmbed = /^!\[([^\]|]*)(?:\|(\d+))?\]\(media\/([0-9a-f]{8})__([^)]+)\)\s*$/.exec(line)
    if (mediaEmbed) {
      const [, label, size, id, file] = mediaEmbed
      const html = /\.html?$/i.test(file)
      blocks.push({
        type: html ? 'htmlBlock' : 'imageBlock',
        attrs: {
          mediaId: id,
          name: label || file,
          ...(size ? (html ? { height: Number(size) } : { width: Number(size) }) : {}),
        },
      })
      i++
      continue
    }

    const wiki = /^(!?)\[\[([^\]]+)\]\]\s*$/.exec(line)
    if (wiki) {
      const id = resolveWikiTarget(wiki[2], resolve)
      if (id) {
        blocks.push({ type: 'pageLink', attrs: { pageId: id, owner: wiki[1] === '!' } })
      } else {
        blocks.push(p([t(wiki[2])]))
      }
      i++
      continue
    }

    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoted.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      const toggleHead = /^\[!toggle\](-?)\s?(.*)$/.exec(quoted[0])
      if (toggleHead) {
        blocks.push({
          type: 'toggle',
          attrs: { open: toggleHead[1] !== '-' },
          content: [
            p(parseInline(toggleHead[2], resolve)),
            ...parseBlocks(quoted.slice(1), resolve),
          ],
        })
        continue
      }
      const calloutHead = /^\[!\w+\]\s*(.*)$/.exec(quoted[0])
      const inner = (xs: string[]) => xs.filter(x => x.trim().length).map(x => p(parseInline(x, resolve)))
      if (calloutHead) {
        const emoji = calloutHead[1].trim().split(/\s+/)[0] ?? ''
        const body = parseBlocks(quoted.slice(1), resolve)
        blocks.push({
          type: 'callout',
          attrs: { emoji },
          content: body.length ? body : [p([])],
        })
      } else {
        blocks.push({ type: 'blockquote', content: inner(quoted).length ? inner(quoted) : [p([])] })
      }
      continue
    }

    // Plain paragraph: join soft-wrapped lines.
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(\s*([-*+]|\d+\.)\s|#{1,6}\s|```|\$\$|>|!\[|(!?)\[\[[^\]]+\]\]\s*$|(-{3,})\s*$)/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(p(parseInline(para.join(' '), resolve)))
  }
  flushList()
  return blocks
}
