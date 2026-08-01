/**
 * Progress rings — the model behind the `progressBlock` node.
 *
 * No React and no TipTap in here: the markdown layer and the HTML exporter
 * share this file, so ring geometry and validation are defined once. Every
 * entry point treats its input as untrusted — a block's payload lives in a
 * vault file that Obsidian, a script, or an LLM may have rewritten — so
 * attributes are sanitized on the way in rather than believed.
 */

export type ProgressKind = 'percent' | 'count'

export interface ProgressBar {
  title: string
  kind: ProgressKind
  value: number
  /** Always present in memory; only serialized for counts (percent is 100). */
  max: number
}

export interface ProgressData {
  size: number
  bars: ProgressBar[]
}

/** Four is the point where rings stop being readable at page width. */
export const PROGRESS_MAX_BARS = 4
export const PROGRESS_MIN_SIZE = 56
export const PROGRESS_MAX_SIZE = 260
export const PROGRESS_DEFAULT_SIZE = 104
export const PROGRESS_DEFAULT_MAX = 10
export const COUNT_CEILING = 9999

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const int = (raw: unknown, fallback: number): number => {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) ? n : fallback
}

export function sanitizeSize(raw: unknown): number {
  return clamp(int(raw, PROGRESS_DEFAULT_SIZE), PROGRESS_MIN_SIZE, PROGRESS_MAX_SIZE)
}

export function emptyBar(kind: ProgressKind = 'percent'): ProgressBar {
  return { title: '', kind, value: 0, max: kind === 'percent' ? 100 : PROGRESS_DEFAULT_MAX }
}

export function sanitizeBar(raw: unknown): ProgressBar {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind: ProgressKind = o.kind === 'count' ? 'count' : 'percent'
  const max = kind === 'percent' ? 100 : clamp(int(o.max, PROGRESS_DEFAULT_MAX), 1, COUNT_CEILING)
  return {
    title: typeof o.title === 'string' ? o.title : '',
    kind,
    value: clamp(int(o.value, 0), 0, max),
    max,
  }
}

/** Always at least one ring — a block with none has nothing to render. */
export function sanitizeBars(raw: unknown): ProgressBar[] {
  const list = Array.isArray(raw) ? raw.slice(0, PROGRESS_MAX_BARS).map(sanitizeBar) : []
  return list.length ? list : [emptyBar()]
}

export function sanitizeProgress(raw: unknown): ProgressData {
  const o = (raw ?? {}) as Record<string, unknown>
  return { size: sanitizeSize(o.size), bars: sanitizeBars(o.bars) }
}

/** Payload of the ```arete-progress fence — `max` only where it means something. */
export function progressToJSON(data: ProgressData): string {
  return JSON.stringify({
    size: data.size,
    bars: data.bars.map(b =>
      b.kind === 'count'
        ? { title: b.title, kind: b.kind, value: b.value, max: b.max }
        : { title: b.title, kind: b.kind, value: b.value },
    ),
  })
}

export function parseProgressJSON(text: string): ProgressData | null {
  try {
    const raw: unknown = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return sanitizeProgress(raw)
  } catch {
    return null // caller keeps the fence as a code block rather than lose it
  }
}

/** Ring metrics for an outer diameter. Stroke scales with the ring so a small
 * one reads as the same object as a large one. */
export function ringGeometry(size: number) {
  const stroke = clamp(Math.round(size * 0.115), 6, 20)
  const r = (size - stroke) / 2
  return { stroke, r, center: size / 2, circumference: 2 * Math.PI * r }
}

export const clampValue = (value: number, max: number) => clamp(Math.round(value), 0, max)

export const barFraction = (bar: ProgressBar): number =>
  bar.max <= 0 ? 0 : clamp(bar.value / bar.max, 0, 1)

export const barLabel = (bar: ProgressBar): string =>
  bar.kind === 'percent' ? `${bar.value}%` : `${bar.value}/${bar.max}`

/** One click moves a percent ring by 5 and a count by 1. */
export const barStep = (bar: ProgressBar): number => (bar.kind === 'percent' ? 5 : 1)

export const steppedValue = (bar: ProgressBar, dir: 1 | -1): number =>
  clampValue(bar.value + dir * barStep(bar), bar.max)

/** Widest the centre label will ever get for this ring. Sizing by the widest
 * rather than the current text keeps the label from jumping a point or two
 * every time the value crosses a digit. */
export const labelChars = (bar: ProgressBar): number =>
  bar.kind === 'percent' ? 4 : `${bar.max}/${bar.max}`.length

/** Centre label size that stays inside the hole at any diameter. A long count
 * like 287/365 has to come down a few points to clear the ring. */
export function labelFontSize(size: number, chars = 4): number {
  const { stroke } = ringGeometry(size)
  const base = clamp(Math.round(size * 0.2), 11, 26)
  const hole = Math.max(16, size - stroke * 2 - 10)
  const fit = hole / (0.62 * Math.max(1, chars))
  return clamp(Math.round(Math.min(base, fit)), 8, 26)
}
