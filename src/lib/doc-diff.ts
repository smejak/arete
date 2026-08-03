import type { JSONContent } from '@tiptap/core'
import { blockText } from './blocks'

/**
 * What changed between two versions of a page, in the shape the stepper needs
 * to light it up.
 *
 * Only additions are described. Stepping shows the document *at* a version, so
 * deleted text is already absent from what is on screen — there is nothing to
 * mark and nowhere to mark it. Added text is the only thing the reader cannot
 * find by looking.
 *
 * Positions are character offsets into a block's concatenated text rather than
 * ProseMirror positions, because this runs on stored JSON and nothing here has
 * a view. `diffDecorations` in editor/StepDiff maps them onto a live document.
 */

export interface BlockChange {
  /** Index among the *new* document's top-level blocks. */
  index: number
  /** Half-open `[start, end)` char ranges into `blockText(block)`. */
  ranges: Array<[number, number]>
  /** The block has no counterpart in the old document — light all of it. */
  whole: boolean
}

const topLevel = (doc: JSONContent | null | undefined): JSONContent[] => doc?.content ?? []

/**
 * Longest common subsequence, returned as the pairs of indices that matched.
 *
 * The table is the whole cost of this, so both callers keep their inputs
 * small: blocks are a page's worth, and the token path bails to a whole-block
 * highlight past MAX_TOKENS rather than allocating a table nobody asked for.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  if (!n || !m) return []
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }
  const out: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j])
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++
    } else {
      j++
    }
  }
  return out
}

interface Token {
  text: string
  at: number
}

/** Words and the gaps between them, each remembering where it started — the
 * offsets are the whole point, so this cannot be a plain split. */
function tokenize(s: string): Token[] {
  const out: Token[] = []
  const re = /\s+|\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) out.push({ text: m[0], at: m.index })
  return out
}

/** Past this, the LCS table costs more than the precision is worth and the
 * block is simply lit whole. A paragraph this long is a pathological case. */
const MAX_TOKENS = 800

/** The parts of `next` that are not in `prev`, as char ranges into `next`. */
function wordRanges(prev: string, next: string): Array<[number, number]> {
  const a = tokenize(prev)
  const b = tokenize(next)
  if (!b.length) return []
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return [[0, next.length]]

  const matched = new Set(
    lcsPairs(
      a.map(t => t.text),
      b.map(t => t.text),
    ).map(([, j]) => j),
  )

  const ranges: Array<[number, number]> = []
  for (let j = 0; j < b.length; j++) {
    if (matched.has(j)) continue
    // Whitespace that changed on its own is not something a reader can see;
    // lighting it produces a glowing gap between two untouched words.
    if (!b[j].text.trim()) continue
    const start = b[j].at
    const end = start + b[j].text.length
    const last = ranges[ranges.length - 1]
    // Two new words either side of an unchanged space are one edit, not two.
    if (last && start - last[1] <= 1) last[1] = end
    else ranges.push([start, end])
  }
  return ranges
}

/**
 * Additions in `next` relative to `prev`.
 *
 * Blocks are aligned first, so an inserted paragraph does not make every
 * paragraph after it look rewritten. Within the gaps that alignment leaves,
 * removed and added blocks are paired off in order: a pair is an edit and gets
 * a word-level diff, while a leftover addition is a genuinely new block.
 *
 * A pair whose word diff comes back empty contributes nothing — text was only
 * removed, and removal has nothing to show.
 */
export function diffDocs(
  prev: JSONContent | null | undefined,
  next: JSONContent | null | undefined,
): BlockChange[] {
  const nextBlocks = topLevel(next)
  if (!nextBlocks.length) return []

  const b = nextBlocks.map(blockText)
  // No previous version at all — everything on screen arrived at once.
  if (!prev) return b.map((_, index) => ({ index, ranges: [], whole: true }))

  const a = topLevel(prev).map(blockText)
  const out: BlockChange[] = []

  let ai = 0
  let bi = 0
  const gap = (aEnd: number, bEnd: number) => {
    const removed: string[] = []
    for (let i = ai; i < aEnd; i++) removed.push(a[i])
    for (let k = 0; bi + k < bEnd; k++) {
      const index = bi + k
      const before = k < removed.length ? removed[k] : null
      if (before === null) {
        out.push({ index, ranges: [], whole: true })
        continue
      }
      const ranges = wordRanges(before, b[index])
      if (ranges.length) out.push({ index, ranges, whole: false })
    }
  }

  for (const [i, j] of lcsPairs(a, b)) {
    gap(i, j)
    ai = i + 1
    bi = j + 1
  }
  gap(a.length, b.length)

  return out
}
