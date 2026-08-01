/**
 * Recording and playback helpers for the audio block.
 *
 * The format question is the whole game here. WKWebView — the Mac app and the
 * iPhone app both — plays what AVFoundation decodes: MP3, M4A/AAC, WAV, AIFF,
 * CAF, FLAC. It does NOT play Ogg or WebM, even though this WebKit will
 * happily *record* WebM. So a recording must come out as MP4/AAC wherever that
 * is offered, and only fall back to WebM in a browser that cannot do it (a
 * Firefox web session) — where we say so, rather than handing someone a clip
 * that is silent on their other devices.
 */

/** Extensions we treat as audio on the way in from a vault folder or a drop.
 * Ogg and WebM are on the list because we store and sync them faithfully —
 * they simply will not play inside WKWebView. */
export const AUDIO_EXTENSIONS = [
  'mp3', 'm4a', 'aac', 'wav', 'wave', 'aiff', 'aif', 'caf', 'flac', 'oga', 'ogg', 'opus', 'weba',
  // `.webm` is ambiguous in general, but Arete has no video, and it is what
  // the WebM fallback recorder produces — it has to round-trip as audio.
  'webm',
] as const

const AUDIO_RE = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i')

export const isAudioName = (name: string) => AUDIO_RE.test(name)

/** Only what WKWebView can actually decode, for warning on import. */
export const isPlayableAudioName = (name: string) =>
  /\.(mp3|m4a|aac|wav|wave|aiff|aif|caf|flac)$/i.test(name)

/** In preference order: the first the platform accepts wins. */
const RECORDING_TYPES: { mime: string; ext: string; portable: boolean }[] = [
  { mime: 'audio/mp4', ext: 'm4a', portable: true },
  { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a', portable: true },
  { mime: 'audio/aac', ext: 'aac', portable: true },
  { mime: 'audio/webm;codecs=opus', ext: 'webm', portable: false },
  { mime: 'audio/webm', ext: 'webm', portable: false },
]

export interface RecordingFormat {
  mime: string
  ext: string
  /** False for WebM: recordable here, but silent in the Mac and iPhone apps. */
  portable: boolean
}

export function pickRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of RECORDING_TYPES) {
    if (MediaRecorder.isTypeSupported(t.mime)) return t
  }
  // A recorder with no type we recognise still records *something*; let the
  // browser choose and name it by what it gives back.
  return { mime: '', ext: 'webm', portable: false }
}

export const canRecord = () =>
  typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** Voice, not music: mono at 64 kbps is ~0.5 MB a minute and indistinguishable. */
export const RECORDING_BITRATE = 64_000

/**
 * Emit a chunk every second instead of one blob at the end.
 *
 * This is not a tuning knob — it is the difference between recording and
 * losing most of it. Measured in a bare WKWebView (the engine both apps run),
 * recording a live 50-second stream:
 *
 *   start()      → 1 chunk,  54 KB, 9.98s of audio decoded
 *   start(1000)  → 48 chunks, 341 KB, 49.94s decoded
 *
 * Without a timeslice WebKit simply drops what it has not flushed, silently
 * and by an unpredictable factor. As a bonus, a crash mid-take now costs one
 * second rather than the whole recording.
 */
export const RECORDING_TIMESLICE_MS = 1000
/** Past this a take is probably an accident; we warn but never cut it off. */
export const LONG_RECORDING_MS = 10 * 60_000

export interface Recorder {
  stop: () => Promise<Blob>
  cancel: () => void
  /** 0–1, for the level meter. Reads live off the analyser. */
  level: () => number
}

/**
 * Open the microphone and start recording. Rejects with a human-readable
 * message — a denied permission is the common case and deserves better than
 * "NotAllowedError" in the UI.
 */
export async function startRecording(format: RecordingFormat): Promise<Recorder> {
  let stream: MediaStream
  try {
    // Plain mono input. Echo cancellation and noise suppression route macOS
    // through its voice-processing unit, which is slower to open and spends
    // its first moments adapting — audible as a soft or missing first word.
    // Nothing is playing back during a voice note, so there is no echo to
    // cancel, and honest audio beats processed audio for a recording you keep.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (err) {
    const name = (err as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Microphone access was denied — allow Arete in System Settings › Privacy.')
    }
    if (name === 'NotFoundError') throw new Error('No microphone found.')
    throw new Error('Could not start recording: ' + ((err as Error)?.message ?? String(err)))
  }

  // Capture mono, but record STEREO.
  //
  // A microphone gives one channel, and a one-channel file plays out of one
  // speaker: WebKit does not up-mix it, not through an <audio> element and not
  // through a MediaElementAudioSourceNode either (measured — the right channel
  // comes back silent both ways). Passing the microphone through a two-channel
  // MediaStreamAudioDestinationNode makes Web Audio do the up-mix while the
  // signal is still live, so the file itself carries both channels and plays
  // correctly in every player. The bitrate is the bitrate, so this costs
  // essentially nothing in size — duplicated channels are what joint stereo is
  // best at.
  //
  // The same graph feeds the level meter. If any of it fails we record the raw
  // microphone stream instead: one-sided audio beats no audio.
  let analyser: AnalyserNode | null = null
  let ctx: AudioContext | null = null
  let buf: Uint8Array<ArrayBuffer> | null = null
  let recorded: MediaStream = stream
  try {
    ctx = new AudioContext()
    const mic = ctx.createMediaStreamSource(stream)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    mic.connect(analyser)
    buf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    const stereo = ctx.createMediaStreamDestination()
    stereo.channelCount = 2
    stereo.channelCountMode = 'explicit'
    stereo.channelInterpretation = 'speakers'
    mic.connect(stereo)
    recorded = stereo.stream
  } catch {
    analyser = null
    recorded = stream
  }

  const recorder = new MediaRecorder(
    recorded,
    format.mime
      ? { mimeType: format.mime, audioBitsPerSecond: RECORDING_BITRATE }
      : { audioBitsPerSecond: RECORDING_BITRATE },
  )
  const chunks: BlobPart[] = []
  recorder.ondataavailable = e => {
    if (e.data.size) chunks.push(e.data)
  }
  // A muxer that fails mid-take fires here and stops itself. Without this the
  // failure is invisible and the UI waits forever on a recorder that has
  // already given up; `stop()` re-throws it instead.
  let failure: Error | null = null
  recorder.onerror = e => {
    failure = new Error(
      'Recording failed: ' + ((e as unknown as { error?: Error }).error?.message ?? 'unknown error'),
    )
  }
  // Resolve when capture has actually begun, not when start() returns, so the
  // caller's "recording now" indicator cannot appear before the microphone is
  // live. Measured at 0–8ms in WKWebView; the guard is only for engines that
  // never fire it.
  const live = new Promise<void>(resolve => {
    recorder.onstart = () => resolve()
    setTimeout(resolve, 500)
  })
  recorder.start(RECORDING_TIMESLICE_MS)
  await live

  const teardown = () => {
    stream.getTracks().forEach(t => t.stop())
    void ctx?.close().catch(() => {})
  }

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        const settle = () => {
          teardown()
          if (failure) return reject(failure)
          const blob = new Blob(chunks, { type: recorder.mimeType || format.mime || 'audio/mp4' })
          // Empty output is a failure, not a recording. Saving it would leave a
          // player that looks fine and plays nothing.
          if (!blob.size) return reject(new Error('Recording captured no audio — check the input device.'))
          resolve(blob)
        }
        recorder.onstop = settle
        recorder.onerror = e => {
          failure =
            failure ??
            new Error(
              'Recording failed: ' + ((e as unknown as { error?: Error }).error?.message ?? ''),
            )
          settle()
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else settle()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      teardown()
    },
    level: () => {
      if (!analyser || !buf) return 0
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
      return Math.min(1, peak / 96)
    },
  }
}

/**
 * Duration of an audio blob, in seconds, or 0 when the file will not say.
 * A freshly recorded MediaRecorder blob frequently reports `Infinity` — its
 * container has no duration until it is remuxed — which is why the recorder
 * passes its own elapsed time instead of asking.
 */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob)
    const el = document.createElement('audio')
    const done = (value: number) => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(el.duration)
    el.onerror = () => done(0)
    // Some containers never fire metadata; do not hang the import on them.
    setTimeout(() => done(el.duration), 4000)
    el.src = url
  })
}

/** `0:07`, `4:31`, `1:02:09` — the shape a player is expected to show. */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}

/** File name for a new recording: sortable, and readable in the vault folder. */
export function recordingName(ext: string, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Recording ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}.${ext}`
}
