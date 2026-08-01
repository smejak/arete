import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { AudioLines, Mic, Pause, Play, Square, Trash2, X } from 'lucide-react'
import {
  canRecord,
  fmtDuration,
  LONG_RECORDING_MS,
  pickRecordingFormat,
  probeDuration,
  recordingName,
  startRecording,
  type Recorder,
} from '../../lib/audio'
import { saveMedia, useMediaURL } from '../../lib/media'
import { cx } from '../../lib/util'

/**
 * Voice recordings and audio files.
 *
 * One node covers both: a block with no `mediaId` is an armed recorder, a
 * block with one is a player. Playback is deliberately NOT gated on the editor
 * being editable — a card under review is a read-only surface, and its audio
 * is the whole point of the card. Nothing ever autoplays; a recording starts
 * when someone presses play.
 */

/** Playback speeds, in the order the control cycles through them. */
const RATES = [1, 1.25, 1.5, 2, 0.75]

function Player({
  mediaId,
  duration,
  editable,
  onClear,
}: {
  mediaId: string
  duration: number
  editable: boolean
  onClear: () => void
}) {
  const url = useMediaURL(mediaId)
  const el = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [len, setLen] = useState(duration)
  const [rate, setRate] = useState(1)

  // The recorded container often has no duration of its own, so the attribute
  // written at record time is the fallback the player trusts.
  const total = len || duration || 0

  useEffect(() => {
    setLen(duration)
  }, [duration])

  const toggle = () => {
    const a = el.current
    if (!a) return
    if (a.paused) void a.play().catch(() => setPlaying(false))
    else a.pause()
  }

  /** Seek from a pointer anywhere along the scrubber, including a drag. */
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = el.current
    if (!a || !total) return
    const track = e.currentTarget
    const apply = (clientX: number) => {
      const r = track.getBoundingClientRect()
      const fraction = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      a.currentTime = fraction * total
      setAt(a.currentTime)
    }
    apply(e.clientX)
    const move = (ev: PointerEvent) => apply(ev.clientX)
    const up = () => window.removeEventListener('pointermove', move)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    setRate(next)
    if (el.current) el.current.playbackRate = next
  }

  if (!url) {
    return (
      <div className="audio-shell is-missing">
        <AudioLines size={15} strokeWidth={1.7} />
        <span className="audio-note">Missing audio</span>
      </div>
    )
  }

  return (
    // The whole face is the play/pause target — a small button is a small
    // target, and this is a thing you reach for constantly. The scrubber and
    // the speed control sit in their own zones and stop the click there.
    <div
      className={cx('audio-shell', 'is-player', playing && 'is-playing')}
      onClick={toggle}
      title={playing ? 'Pause' : 'Play'}
    >
      <audio
        ref={el}
        src={url}
        preload="metadata"
        onLoadedMetadata={e => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setLen(d)
        }}
        onTimeUpdate={e => setAt(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setAt(0)
        }}
      />
      <div className="audio-face">
        <span className="audio-glyph">
          {playing ? <Pause size={17} strokeWidth={2.2} /> : <Play size={17} strokeWidth={2.2} />}
        </span>
        <span className="audio-time">
          {fmtDuration(at)}
          {total ? <span className="audio-total"> / {fmtDuration(total)}</span> : null}
        </span>
        <span className="audio-gap" />
        <button
          type="button"
          className="audio-rate"
          title="Playback speed"
          onClick={e => {
            e.stopPropagation()
            cycleRate()
          }}
        >
          {rate}×
        </button>
        {editable && (
          <button
            type="button"
            className="audio-clear"
            title="Remove audio"
            onClick={e => {
              e.stopPropagation()
              onClear()
            }}
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <div
        className="audio-scrub"
        title="Seek"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => {
          e.stopPropagation()
          scrub(e)
        }}
      >
        <div
          className="audio-scrub-fill"
          style={{ width: total ? `${Math.min(100, (at / total) * 100)}%` : '0%' }}
        />
      </div>
    </div>
  )
}


function Recorder({
  onDone,
  onShort,
}: {
  onDone: (mediaId: string, name: string, duration: number) => void
  onShort: (message: string) => void
}) {
  const [rec, setRec] = useState<Recorder | null>(null)
  const [ms, setMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [arming, setArming] = useState(false)
  const setShort = onShort
  const format = pickRecordingFormat()
  const supported = canRecord() && !!format

  // Timer and meter run only while armed, and stop with the recorder.
  useEffect(() => {
    if (!rec) return
    const started = Date.now()
    const tick = window.setInterval(() => {
      setMs(Date.now() - started)
      setLevel(rec.level())
    }, 100)
    return () => window.clearInterval(tick)
  }, [rec])

  const begin = async () => {
    if (!format) return
    setError(null)
    // Opening the microphone takes the OS a moment. Say so immediately —
    // silence here reads as "it's recording", and anything said before the
    // device is live is simply not captured.
    setArming(true)
    try {
      setRec(await startRecording(format))
      setMs(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setArming(false)
    }
  }

  const finish = async () => {
    if (!rec) return
    setSaving(true)
    try {
      // Rejects on an empty take, so a failed recording never becomes a player
      // that looks fine and plays silence.
      const blob = await rec.stop()
      const elapsed = Math.round(ms / 1000)
      // Label the FILE, not the clock. When capture falls short, a wall-clock
      // label would put "0:50" on ten seconds of audio and hide the loss —
      // which is exactly how the WebKit timeslice bug went unnoticed.
      const probed = await probeDuration(blob)
      const name = recordingName(format?.ext ?? 'm4a')
      const saved = await saveMedia(blob, name)
      // Belt and braces on a capture API that has dropped audio before.
      if (probed && elapsed > 3 && probed < elapsed * 0.9) {
        setShort(`Kept ${fmtDuration(probed)} of a ${fmtDuration(elapsed)} take — audio was dropped while recording.`)
      }
      onDone(saved.id, name, probed || elapsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
      setRec(null)
    }
  }

  if (!supported) {
    return (
      <div className="audio-shell is-idle">
        <AudioLines size={15} strokeWidth={1.7} />
        <span className="audio-note">
          Recording is not available here. Use “Audio file” to add a clip instead.
        </span>
      </div>
    )
  }

  if (arming) {
    return (
      <div className="audio-shell is-arming">
        <span className="audio-dot is-arming" />
        <span className="audio-elapsed">Starting…</span>
        <span className="audio-note">Opening the microphone — wait for the timer before speaking.</span>
      </div>
    )
  }

  if (!rec) {
    return (
      <div className="audio-shell is-idle">
        <button type="button" className="audio-record" onClick={() => void begin()} disabled={saving}>
          <Mic size={14} strokeWidth={2} /> Record
        </button>
        <span className="audio-note">
          {error ??
            (format.portable
              ? 'Records to your microphone, stored in this vault.'
              : 'This browser records WebM, which the Mac and iPhone apps cannot play.')}
        </span>
      </div>
    )
  }

  return (
    <div className="audio-shell is-recording">
      <span className="audio-dot" />
      <span className="audio-elapsed">{fmtDuration(ms / 1000)}</span>
      <div className="audio-meter">
        <div className="audio-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      {ms > LONG_RECORDING_MS && <span className="audio-note">long take</span>}
      <button type="button" className="audio-stop" onClick={() => void finish()} disabled={saving}>
        <Square size={12} strokeWidth={2.4} /> Stop
      </button>
      <button
        type="button"
        className="audio-cancel"
        title="Discard"
        onClick={() => {
          rec.cancel()
          setRec(null)
        }}
      >
        <X size={13} strokeWidth={1.9} />
      </button>
    </div>
  )
}

function AudioView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const mediaId = (node.attrs.mediaId as string) || ''
  const editable = editor.isEditable
  const [short, setShort] = useState<string | null>(null)

  return (
    <NodeViewWrapper className={cx('audio-block', selected && 'is-selected')} data-type="audio">
      <div contentEditable={false}>
        {mediaId ? (
          <>
            <Player
              mediaId={mediaId}
              duration={Number(node.attrs.duration) || 0}
              editable={editable}
              onClear={() => {
                setShort(null)
                updateAttributes({ mediaId: null, name: '', duration: 0 })
              }}
            />
            {short && <div className="audio-warn">{short}</div>}
          </>
        ) : editable ? (
          <Recorder
            onDone={(id, name, duration) => updateAttributes({ mediaId: id, name, duration })}
            onShort={setShort}
          />
        ) : (
          <div className="audio-shell is-missing">
            <AudioLines size={15} strokeWidth={1.7} />
            <span className="audio-note">Empty recording</span>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const AudioBlock = Node.create({
  name: 'audioBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: { default: null },
      name: { default: '' },
      /** Seconds. Written at record time; the container often will not say. */
      duration: { default: 0 },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="audio"]',
        getAttrs: el => ({
          mediaId: (el as HTMLElement).dataset.mediaId ?? null,
          name: (el as HTMLElement).dataset.name ?? '',
          duration: Number((el as HTMLElement).dataset.duration) || 0,
        }),
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'audio',
        'data-media-id': node.attrs.mediaId,
        'data-name': node.attrs.name,
        'data-duration': node.attrs.duration || undefined,
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView, {
      // Interactive island — the transport controls need their own events, but
      // dragging the block must still reach ProseMirror.
      stopEvent: ({ event }) => !event.type.startsWith('drag') && event.type !== 'drop',
    })
  },
})
