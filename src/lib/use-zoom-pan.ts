import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Pinch, pan and double-tap for a single element inside a fixed container.
 *
 * Pointer Events rather than touch events, so one implementation serves a
 * thumb, a trackpad and a mouse wheel. The phone needs it most: the app sets
 * `user-scalable=no`, so the browser hands us nothing — and page zoom would be
 * the wrong answer anyway, since it would scale the chrome along with the
 * picture.
 *
 * Transforms read `translate(x, y) scale(k)`: CSS applies the scale first, so
 * x and y stay in screen pixels and the bounds maths stays honest.
 */

export interface Transform {
  scale: number
  x: number
  y: number
}

interface Pt {
  x: number
  y: number
}

const REST: Transform = { scale: 1, x: 0, y: 0 }
/** Movement under this (px) is still a tap. */
const TAP_SLOP = 6
/** A second tap inside this window, near the first, is a double tap. */
const DOUBLE_MS = 300
const DOUBLE_SLOP = 28
/** Pull-down past this at rest dismisses. */
const SWIPE_CLOSE = 96
const DOUBLE_TAP_SCALE = 2.5

const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const spread = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function useZoomPan({
  containerRef,
  contentRef,
  maxScale = 4,
  onDismiss,
}: {
  containerRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  maxScale?: number
  onDismiss: () => void
}) {
  const [transform, setTransform] = useState<Transform>(REST)
  /** Pull-down distance while dismissing; separate from the transform so it
   * survives the bounds clamp (which pins y to 0 at rest). */
  const [swipe, setSwipe] = useState(0)
  /** Fingers are down. Transitions are switched off while they are, or the
   * image would ease along behind them instead of tracking them. */
  const [interacting, setInteracting] = useState(false)

  const live = useRef(transform)
  live.current = transform
  const swipeLive = useRef(swipe)
  swipeLive.current = swipe

  const pointers = useRef(new Map<number, Pt>())
  const pinch = useRef<{ mid: Pt; dist: number } | null>(null)
  const press = useRef<{ at: Pt; moved: boolean } | null>(null)
  const lastTap = useRef<{ at: Pt; time: number } | null>(null)
  const tapTimer = useRef(0)

  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  /** Never below fit, never past this — but always far enough to reach 1:1
   * pixels, which is the whole point for a screenshot or a dense diagram. */
  const ceiling = useCallback(() => {
    const img = contentRef.current as HTMLImageElement | null
    const fitted = img?.offsetWidth ?? 0
    const natural = img?.naturalWidth ?? 0
    return fitted && natural ? Math.max(maxScale, natural / fitted) : maxScale
  }, [contentRef, maxScale])

  const bound = useCallback(
    (next: Transform): Transform => {
      const box = containerRef.current?.getBoundingClientRect()
      const el = contentRef.current
      const scale = clamp(next.scale, 1, ceiling())
      if (!box || !el) return { ...next, scale }
      // offsetWidth/Height are the untransformed layout size — the fitted box.
      const limitX = Math.max(0, (el.offsetWidth * scale - box.width) / 2)
      const limitY = Math.max(0, (el.offsetHeight * scale - box.height) / 2)
      return { scale, x: clamp(next.x, -limitX, limitX), y: clamp(next.y, -limitY, limitY) }
    },
    [containerRef, contentRef, ceiling],
  )

  const centre = useCallback((): Pt | null => {
    const box = containerRef.current?.getBoundingClientRect()
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null
  }, [containerRef])

  /** Scale by `factor` while keeping whatever sits under `p` under `p`. */
  const zoomAbout = useCallback(
    (factor: number, p: Pt) => {
      const c = centre()
      if (!c) return
      setTransform(prev => {
        const scale = clamp(prev.scale * factor, 1, ceiling())
        const k = scale / prev.scale
        return bound({
          scale,
          x: (p.x - c.x) * (1 - k) + prev.x * k,
          y: (p.y - c.y) * (1 - k) + prev.y * k,
        })
      })
    },
    [bound, ceiling, centre],
  )

  const reset = useCallback(() => setTransform(REST), [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setInteracting(true)
    if (pointers.current.size === 1) {
      press.current = { at: { x: e.clientX, y: e.clientY }, moved: false }
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { mid: midpoint(a, b), dist: spread(a, b) }
      // A pinch is never a tap, however little the fingers travelled.
      if (press.current) press.current.moved = true
    }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const was = pointers.current.get(e.pointerId)
      if (!was) return
      const now = { x: e.clientX, y: e.clientY }
      pointers.current.set(e.pointerId, now)

      const p = press.current
      if (p && !p.moved && Math.hypot(now.x - p.at.x, now.y - p.at.y) > TAP_SLOP) p.moved = true

      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()]
        const mid = midpoint(a, b)
        const dist = spread(a, b)
        const before = pinch.current
        pinch.current = { mid, dist }
        if (!before?.dist) return
        const c = centre()
        if (!c) return
        setTransform(prev => {
          const scale = clamp(prev.scale * (dist / before.dist), 1, ceiling())
          const k = scale / prev.scale
          // Two moves at once: the pair of fingers dragging the image, and the
          // gap between them scaling it about their midpoint.
          const panned = {
            x: prev.x + (mid.x - before.mid.x),
            y: prev.y + (mid.y - before.mid.y),
          }
          return bound({
            scale,
            x: (mid.x - c.x) * (1 - k) + panned.x * k,
            y: (mid.y - c.y) * (1 - k) + panned.y * k,
          })
        })
        return
      }

      const dx = now.x - was.x
      const dy = now.y - was.y
      if (live.current.scale > 1) {
        setTransform(prev => bound({ ...prev, x: prev.x + dx, y: prev.y + dy }))
      } else {
        // At rest a drag is a dismissal, not a pan. Downwards only — an upward
        // pull has nowhere to go and reads as a stuck gesture.
        setSwipe(s => Math.max(0, s + dy))
      }
    },
    [bound, ceiling, centre],
  )

  const settle = useCallback(
    (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) pinch.current = null
      if (pointers.current.size > 0) return
      setInteracting(false)

      const p = press.current
      press.current = null

      if (live.current.scale === 1 && swipeLive.current > SWIPE_CLOSE) {
        onDismiss()
        return
      }
      setSwipe(0)
      if (!p || p.moved) return

      const last = lastTap.current
      const isDouble =
        !!last &&
        e.timeStamp - last.time < DOUBLE_MS &&
        Math.hypot(p.at.x - last.at.x, p.at.y - last.at.y) < DOUBLE_SLOP

      if (isDouble) {
        window.clearTimeout(tapTimer.current)
        lastTap.current = null
        if (live.current.scale > 1) reset()
        else zoomAbout(DOUBLE_TAP_SCALE / live.current.scale, p.at)
        return
      }

      lastTap.current = { at: p.at, time: e.timeStamp }
      // A single tap closes, but only once the double-tap window has passed —
      // otherwise the first half of a double tap would shut the viewer.
      if (live.current.scale === 1) {
        window.clearTimeout(tapTimer.current)
        tapTimer.current = window.setTimeout(onDismiss, DOUBLE_MS)
      }
    },
    [onDismiss, reset, zoomAbout],
  )

  // Wheel zoom needs a non-passive listener to keep the page behind still, and
  // WKWebView's own pinch (gesture*) has to be refused explicitly — the
  // viewport already forbids it, but a webview under an accessibility setting
  // may still try.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAbout(Math.exp(-e.deltaY / 320), { x: e.clientX, y: e.clientY })
    }
    const refuse = (e: Event) => e.preventDefault()
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', refuse)
    el.addEventListener('gesturechange', refuse)
    el.addEventListener('gestureend', refuse)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', refuse)
      el.removeEventListener('gesturechange', refuse)
      el.removeEventListener('gestureend', refuse)
    }
  }, [containerRef, zoomAbout])

  return {
    transform,
    swipe,
    interacting,
    zoomed: transform.scale > 1,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
    },
  }
}
