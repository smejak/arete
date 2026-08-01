import type { JSONContent } from '@tiptap/core'
import type { Page } from '../store/types'
import { parseProgressJSON, progressToJSON, sanitizeProgress } from './progress'
// From `audio`, not `media`: media imports `sanitizeFilename` from this file,
// and the pair would be a cycle. `audio` is a leaf.
import { isAudioName } from './audio'

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

/** Info string that marks a fenced block as a progress row. */
const PROGRESS_FENCE = 'arete-progress'

/** Footnote text is markdown itself, kept on one line inside `^[…]`:
 * backslashes and `]` are escaped, newlines become literal `\n`. */
const escFootnote = (s: string) => s.replace(/[\\\]]/g, m => '\\' + m).replace(/\n/g, '\\n')
const unescFootnote = (s: string) => s.replace(/\\([\\\]n])/g, (_m, c: string) => (c === 'n' ? '\n' : c))

/** Pandoc-style inline math: the content hugs its dollars (no space just
 * inside either delimiter), the closing $ is neither escaped nor followed by
 * a digit — so "$10m is smaller than $20m" is prose, not an equation. `\$`
 * may appear inside the content (a literal dollar in LaTeX). */
const INLINE_MATH_RE = /\$([^\s$](?:\\\$|[^$\n])*[^\s$\\]|[^\s$\\])\$(?!\d)/

/** Escape the `$`s of any text span the parser would mistake for math (and
 * double a literal backslash sitting before a `$`), so unwrapped equations
 * and ticker-style pairs like "$AAPL$" survive the round-trip as text. */
function escapeDollars(text: string): string {
  if (!text.includes('$')) return text
  let rest = text.replace(/\\(?=\$)/g, '\\\\')
  let out = ''
  for (;;) {
    const m = INLINE_MATH_RE.exec(rest)
    if (!m) return out + rest
    out += rest.slice(0, m.index) + '\\$' + m[1] + '\\$'
    rest = rest.slice(m.index + m[0].length)
  }
}

function inlineToMd(node: JSONContent, resolve: TitleResolver): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'mathInline') return `$${((node.attrs?.latex as string) ?? '').trim()}$`
  if (node.type === 'footnote') return `^[${escFootnote((node.attrs?.md as string) ?? '')}]`
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
  else out = escapeDollars(out)
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

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

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
    // A list nested directly in a list (an indented run with no parent
    // bullet) serializes as a deeper-indented block of its own.
    if (LIST_TYPES.has(item.type ?? '')) {
      lines.push(
        listToMd(item, resolve, indent + '  ', item.type === 'orderedList', item.type === 'taskList'),
      )
      continue
    }
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

/**
 * A block, with its tag/id marker if it has one.
 *
 * The marker is emitted here rather than at the top level, so a block nested
 * inside a callout, a toggle or a quote writes it too — those are exactly the
 * places the handle descends into, and a tag put on one of them used to be
 * dropped on the way to disk.
 */
function blockToMd(node: JSONContent, resolve: TitleResolver): string | null {
  const body = blockBody(node, resolve)
  if (body === null) return null
  const meta = blockMeta(node)
  return meta ? `${meta}\n${body}` : body
}

function blockBody(node: JSONContent, resolve: TitleResolver): string | null {
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
    case 'table': {
      // GFM pipe table. Cells live on one line: `|` escapes to `\|`, paragraph
      // breaks become `<br>`, any other block content degrades to its text.
      // GFM cannot omit the header row, so a headerless table gets an empty one.
      const rows = node.content ?? []
      if (!rows.length) return null
      const cellMd = (cell: JSONContent) =>
        (cell.content ?? [])
          .map(b => blockToMd(b, resolve) ?? '')
          .join('<br>')
          .replace(/\n/g, ' ')
          .replace(/\|/g, '\\|')
      const cols = Math.max(1, ...rows.map(r => (r.content ?? []).length))
      const line = (cells: string[]) => {
        while (cells.length < cols) cells.push('')
        return `| ${cells.join(' | ')} |`
      }
      const hasHeader = (rows[0].content ?? []).every(c => c.type === 'tableHeader')
      const out = [
        line(hasHeader ? (rows[0].content ?? []).map(cellMd) : Array(cols).fill('')),
        `|${' --- |'.repeat(cols)}`,
      ]
      for (const row of hasHeader ? rows.slice(1) : rows) {
        out.push(line((row.content ?? []).map(cellMd)))
      }
      return out.join('\n')
    }
    case 'horizontalRule':
      return '---'
    case 'progressBlock':
      // Structured, not prose: a fenced block keeps the payload out of the
      // reading flow and renders as an inert code block anywhere else.
      return '```arete-progress\n' + progressToJSON(sanitizeProgress(node.attrs)) + '\n```'
    case 'mathBlock':
      return `$$\n${node.attrs?.latex ?? ''}\n$$`
    case 'pageLink': {
      const id = node.attrs?.pageId as string | null
      const title = id ? resolve(id) : null
      const target = title ?? 'arete:' + (id ?? '?')
      return node.attrs?.owner ? `![[${target}]]` : `[[${target}]]`
    }
    case 'groupRef':
      // The tag is the whole reference — membership and order are resolved
      // when it opens, so nothing about them belongs in the file.
      return `<div data-group-ref="${String(node.attrs?.tag ?? '').replace(/"/g, '&quot;')}"></div>`
    case 'blockRef': {
      // The page by title (like a wiki link) and the block by the words it
      // had — no id is minted into the paragraph being pointed at.
      const id = node.attrs?.pageId as string | null
      const title = id ? resolve(id) : null
      const target = (title ?? 'arete:' + (id ?? '?')).replace(/"/g, '&quot;')
      return `<div data-block-ref="${target}">${String(node.attrs?.text ?? '')}</div>`
    }
    case 'imageBlock':
    case 'htmlBlock':
    case 'audioBlock': {
      // `![name|size](media/<id>__<file>)` — Obsidian-style size suffix, where
      // "size" is width, embed height, or an audio clip's duration.
      const id = (node.attrs?.mediaId as string) ?? ''
      const name = (node.attrs?.name as string) || 'file'
      const size =
        node.type === 'imageBlock'
          ? node.attrs?.width
          : node.type === 'audioBlock'
            ? node.attrs?.duration
            : node.attrs?.height
      const label = size ? `${name}|${size}` : name
      // An armed recorder with nothing in it yet has no file to point at.
      if (!id) return null
      return `![${label}](media/${id}__${sanitizeFilename(name) || 'file'})`
    }
    default:
      return null
  }
}

/**
 * Tags and a block id ride on a comment line above the block rather than
 * inside it. On its own line it works the same for a paragraph, a list and a
 * code fence — which a trailing marker does not — it survives any markdown
 * renderer as a comment, and a block that carries neither writes nothing at
 * all, so an untagged vault is byte-for-byte what it always was.
 */
function blockMeta(node: JSONContent): string | null {
  const tags = (node.attrs?.tags as string[] | undefined)?.filter(Boolean) ?? []
  const id = (node.attrs?.blockId as string | undefined) ?? ''
  if (!tags.length && !id) return null
  const parts = [
    id ? `block="${id}"` : '',
    tags.length ? `tags="${tags.join(',')}"` : '',
  ].filter(Boolean)
  return `<!--arete ${parts.join(' ')}-->`
}

export const BLOCK_META_RE = /^<!--arete(?:\s+block="([^"]*)")?(?:\s+tags="([^"]*)")?\s*-->\s*$/

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
  // A name that is only dots (".", "..") becomes a path-traversal segment once
  // it is used as a folder/file path — never let it through.
  if (/^\.+$/.test(cleaned)) return 'Untitled'
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
    // ^[footnote text] — content is escaped markdown (see escFootnote).
    re: /\^\[((?:\\.|[^\]\\])*)\]/,
    handle: m => [
      { type: 'footnote', attrs: { id: crypto.randomUUID(), md: unescFootnote(m[1]) } },
    ],
  },
  {
    // \$ — a literal dollar (what the serializer emits so prose like
    // \$AAPL\$ never parses as math).
    re: /\\\$/,
    handle: () => [t('$')],
  },
  {
    re: INLINE_MATH_RE,
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

/** Build lists from a buffer of bullet lines. Indentation is absolute:
 * deeper runs nest under the item above them, or — when there is no item
 * above (an indented bullet with no parent) — wrap in bare nested lists,
 * which the schema allows. A shallower line ends the run and starts a
 * sibling; adjacent same-type siblings merge back into one list. */
function buildLists(lines: ListLine[], resolve: LinkResolver, context = 0): JSONContent[] {
  const blocks: JSONContent[] = []
  let i = 0
  while (i < lines.length) {
    const base = lines[i].indent
    const ordered = lines[i].ordered
    const task = lines[i].checked !== null
    const items: JSONContent[] = []
    while (i < lines.length && lines[i].indent >= base) {
      if (lines[i].indent > base) {
        const nested: ListLine[] = []
        while (i < lines.length && lines[i].indent > base) nested.push(lines[i++])
        const sub = buildLists(nested, resolve, base + 1)
        const prev = items[items.length - 1]
        if (prev) (prev.content as JSONContent[]).push(...sub)
        else items.push(...sub) // deeper run before any item — direct child lists
      } else {
        const line = lines[i++]
        items.push(
          task
            ? { type: 'taskItem', attrs: { checked: line.checked === true }, content: [p(parseInline(line.text, resolve))] }
            : { type: 'listItem', content: [p(parseInline(line.text, resolve))] },
        )
      }
    }
    let list: JSONContent = {
      type: task ? 'taskList' : ordered ? 'orderedList' : 'bulletList',
      content: items,
    }
    for (let d = base; d > context; d--) list = { type: list.type, content: [list] }
    blocks.push(list)
  }
  const merged: JSONContent[] = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (last && last.type === b.type) (last.content as JSONContent[]).push(...(b.content ?? []))
    else merged.push(b)
  }
  return merged
}

// --- tables ----------------------------------------------------------------

/** Split a `| a | b |` row into trimmed cell strings (`\|` stays escaped). */
function splitRowCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map(c => c.trim())
}

const DELIM_CELL = /^:?-+:?$/

/** `| --- | :---: |` — the row that turns pipe lines into a GFM table. */
function isDelimRow(line: string): boolean {
  const s = line.trim()
  if (!s.startsWith('|')) return false
  const cells = splitRowCells(s)
  return cells.length > 0 && cells.every(c => DELIM_CELL.test(c))
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

function tableCellNode(
  md: string,
  type: 'tableCell' | 'tableHeader',
  resolve: LinkResolver,
): JSONContent {
  return {
    type,
    content: md
      .split(/<br\s*\/?>/i)
      .map(part => p(parseInline(part.replace(/\\\|/g, '|'), resolve))),
  }
}

/** Assemble the TipTap table. Rows pad square (ProseMirror wants a rectangle);
 * an all-empty header row — the serializer's stand-in for "no header" — is
 * dropped again on the way in. */
function tableNode(header: string[], body: string[][], resolve: LinkResolver): JSONContent | null {
  const cols = Math.max(header.length, 1, ...body.map(r => r.length))
  const pad = (r: string[]) => {
    while (r.length < cols) r.push('')
    return r
  }
  const rows: JSONContent[] = []
  if (header.some(c => c.length)) {
    rows.push({ type: 'tableRow', content: pad(header).map(c => tableCellNode(c, 'tableHeader', resolve)) })
  }
  for (const r of body) {
    rows.push({ type: 'tableRow', content: pad(r).map(c => tableCellNode(c, 'tableCell', resolve)) })
  }
  return rows.length ? { type: 'table', content: rows } : null
}

const FLAT_DELIM_RE = /\|(\s*:?-+:?\s*\|)+/

/** Recover a table that an earlier version of the paragraph joiner flattened
 * onto one line (`| a | b | |---|---| | c | d |`) — data saved before tables
 * existed carries this form. The delimiter segment fixes the column count;
 * the single-space row joins show up as empty-cell artifacts between chunks
 * of that width and are dropped. */
function expandFlatTable(line: string): { header: string[]; body: string[][] } | null {
  const s = line.trim()
  if (!s.startsWith('|') || !s.endsWith('|') || s.endsWith('\\|')) return null
  const m = FLAT_DELIM_RE.exec(s)
  if (!m || m.index === 0 || m.index + m[0].length === s.length) return null
  const header = splitRowCells(s.slice(0, m.index))
  const cols = m[0].split('|').filter(c => /-/.test(c)).length
  if (header.length !== cols) return null
  const cells = splitRowCells(s.slice(m.index + m[0].length))
  const body: string[][] = []
  let row: string[] = []
  for (const c of cells) {
    if (row.length === cols) {
      body.push(row)
      row = []
      if (c === '') continue // the row-boundary artifact
    }
    row.push(c)
  }
  if (row.length) body.push(row)
  return body.length ? { header, body } : null
}

/** A table at lines[i]: either a proper GFM block (row, delimiter row, body
 * rows) or a whole table flattened onto a single line. */
function tryParseTable(
  lines: string[],
  i: number,
  resolve: LinkResolver,
): { node: JSONContent; next: number } | null {
  const line = lines[i]
  if (TABLE_ROW_RE.test(line) && !isDelimRow(line) && isDelimRow(lines[i + 1] ?? '')) {
    const header = splitRowCells(line)
    const body: string[][] = []
    let j = i + 2
    while (j < lines.length && TABLE_ROW_RE.test(lines[j])) {
      body.push(splitRowCells(lines[j]))
      j++
    }
    const node = tableNode(header, body, resolve)
    if (node) return { node, next: j }
  }
  const flat = expandFlatTable(line)
  if (flat) {
    const node = tableNode(flat.header, flat.body, resolve)
    if (node) return { node, next: i + 1 }
  }
  return null
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
      blocks.push(...buildLists([...listBuffer], resolve))
      listBuffer.length = 0
    }
  }

  /** Tags/id read off a marker line, waiting for the block underneath it. */
  let pending: { blockId?: string; tags?: string[] } | null = null
  const claim = (): { blockId?: string; tags?: string[] } | null => {
    const held = pending
    pending = null
    return held
  }
  const pushed = blocks.push.bind(blocks)
  blocks.push = ((...added: JSONContent[]) => {
    const meta = claim()
    if (meta && added.length) {
      added[0] = { ...added[0], attrs: { ...(added[0].attrs ?? {}), ...meta } }
    }
    return pushed(...added)
  }) as typeof blocks.push

  while (i < lines.length) {
    const line = lines[i]

    const meta = BLOCK_META_RE.exec(line)
    if (meta) {
      const tags = (meta[2] ?? '').split(',').filter(Boolean)
      pending = {
        ...(meta[1] ? { blockId: meta[1] } : {}),
        ...(tags.length ? { tags } : {}),
      }
      i++
      continue
    }

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
      const info = line.slice(3).trim().toLowerCase()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++
      if (info === PROGRESS_FENCE) {
        const data = parseProgressJSON(code.join('\n'))
        // Unparseable payload falls through to a code block: a hand-edit that
        // broke the JSON stays visible on the page instead of vanishing.
        if (data) {
          blocks.push({ type: 'progressBlock', attrs: { size: data.size, bars: data.bars } })
          continue
        }
      }
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

    if (line.includes('|')) {
      const table = tryParseTable(lines, i, resolve)
      if (table) {
        blocks.push(table.node)
        i = table.next
        continue
      }
    }

    const mediaEmbed = /^!\[([^\]|]*)(?:\|(\d+))?\]\(media\/([0-9a-f]{8})__([^)]+)\)\s*$/.exec(line)
    if (mediaEmbed) {
      const [, label, size, id, file] = mediaEmbed
      const html = /\.html?$/i.test(file)
      const audio = !html && isAudioName(file)
      // The `|n` slot means whatever the block measures itself in: image
      // width, embed height, or — for audio — duration in seconds.
      const sized = size
        ? html
          ? { height: Number(size) }
          : audio
            ? { duration: Number(size) }
            : { width: Number(size) }
        : {}
      blocks.push({
        type: html ? 'htmlBlock' : audio ? 'audioBlock' : 'imageBlock',
        attrs: {
          mediaId: id,
          name: label || file,
          ...sized,
        },
      })
      i++
      continue
    }

    const gref = /^<div data-group-ref="([^"]*)"><\/div>\s*$/.exec(line)
    if (gref) {
      blocks.push({ type: 'groupRef', attrs: { tag: gref[1].replace(/&quot;/g, '"') } })
      i++
      continue
    }

    const bref = /^<div data-block-ref="([^"]*)">([\s\S]*?)<\/div>\s*$/.exec(line)
    if (bref) {
      blocks.push({
        type: 'blockRef',
        attrs: {
          pageId: resolveWikiTarget(bref[1].replace(/&quot;/g, '"'), resolve),
          text: bref[2],
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
      !/^(\s*([-*+]|\d+\.)\s|#{1,6}\s|```|\$\$|>|!\[|\||(!?)\[\[[^\]]+\]\]\s*$|(-{3,})\s*$)/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(p(parseInline(para.join(' '), resolve)))
  }
  flushList()
  return blocks
}
