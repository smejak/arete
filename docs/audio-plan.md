# Voice recordings and audio files in Arete — research + plan

*2026-07-29. The platform findings below were **measured** against the shipping configuration
(Tauri 2.11.5 / wry 0.55.1, WKWebView, `tauri://localhost`) with a throwaway probe build, not
inferred from documentation.*

**Status.** Phases 1–3 are built: the `audioBlock` node with its player and recorder, import by
slash item / paste / drop, the markdown round-trip, vault mirroring and GC, the HTML export, and
audio inside cards on every surface. Autoplay was ruled out by decision — audio always waits for a
play button. Remaining: the two iOS-side changes below (untouched — `arete-ios` has an App Store
submission in flight), lazy media hydration, and an end-to-end recording test with a real
microphone.

## The finding that shapes everything

In-app recording can be **pure web code** — no native audio engine, on either platform.

Probing the real release bundle showed `navigator.mediaDevices` **undefined**, despite
`isSecureContext === true`. WebKit does not expose capture APIs to an embedded webview whose host
app declares no purpose string. Adding `NSMicrophoneUsageDescription` to the bundle's `Info.plist`
and rebuilding flipped it:

| Probe | Without usage string | With usage string |
|---|---|---|
| `isSecureContext` | true | true |
| `navigator.mediaDevices` | **false** | **true** |
| `getUserMedia` | false | **true** |
| `enumerateDevices()` | "no api" | "1 audioinput" |
| `MediaRecorder` / `audio/mp4` | true / true | true / true |
| `audio/webm;codecs=opus` | true | true |

Two supporting facts: wry already answers WebKit's permission callback with
`WKPermissionDecision::Grant` unconditionally
(`wry-0.55.1/src/wkwebview/class/wry_web_view_ui_delegate.rs:126`), so there is no delegate to
write; and this WebKit is new enough to record WebM/Opus as well as MP4/AAC.

**Still unverified:** the macOS TCC prompt itself (a system dialog I could not click from a
script) and the iOS side (same WebKit gating, so the same key in
`arete-ios/src-tauri/gen/apple/arete-mobile_iOS/Info.plist` should do it — worth a 10-minute
simulator check before building on the assumption).

## WebKit drops audio unless MediaRecorder is given a timeslice

*Added 2026-07-30, after a 50-second recording came back 20 seconds long.*

`MediaRecorder.start()` with no argument buffers everything until `stop()`. WebKit does not keep
that promise: it discards whatever it has not flushed, silently, by a factor that varies per run.
Measured in a bare WKWebView recording a live 50-second stream — decoded from the samples, not
read off the container's metadata:

| `start()` | chunks | bytes | audio decoded |
|---|---|---|---|
| `start()` | 1 | 54 KB | **9.98 s** |
| `start(1000)` | 48 | 341 KB | **49.94 s** |

Chromium captures the full 50 s either way, so this never shows up in a browser — only in the
Mac app, and (same engine) the iPhone app. `RECORDING_TIMESLICE_MS` in `lib/audio.ts` is
therefore load-bearing, not a tuning knob. Verified again through the app's own recorder in a
WKWebView: 50 s in, 50.01 s of audio out.

Two lessons baked into the code: the stored duration is read from the **file**, never from the
wall clock — a clock-based label would have written "0:50" over ten seconds of audio and hidden
the loss — and a take that comes back materially shorter than it was recorded now says so in the
block rather than passing silently.

### The lead-in is the device opening, not the recorder

*Added 2026-07-30, after the first words of a take went missing.*

WebKit itself is prompt: in the same harness, `onstart` fires 0–8 ms after `start()`, and a
recording of an already-sounding tone begins with 23 ms of silence — AAC encoder priming, nothing
more. So nothing is lost *after* `start()`. The gap is `getUserMedia` opening the microphone,
during which the block still showed an untouched "Record" button and anything said was simply not
captured.

Two changes: the recorder now reports an explicit **arming** state from the instant the button is
pressed and only shows the timer once capture is live (`startRecording` resolves on `onstart`,
not on `start()` returning), and the capture constraints no longer request echo cancellation,
noise suppression or AGC. Those route macOS through its voice-processing unit, which is slower to
open and spends its first moments adapting — audible as a soft or missing first word. Nothing is
playing back during a voice note, so there is no echo to cancel.

## What already exists and fits

The media pipeline was built for images and HTML embeds, and audio rides most of it unchanged:

- **Blobs in IndexedDB** keyed by an 8-hex id, immutable once written (`lib/media.ts`).
- **Vault mirror** as `media/<id8>__<name>`, written once per id and garbage-collected when no
  page or card references it (`lib/vault.ts` — `referencedMedia` already scans **card markdown**
  as well as page content, so card audio is covered for free).
- **Markdown round-trip** as `![name|size](media/<id>__<file>)`, with the node type chosen by
  file extension on the way back in (`lib/markdown.ts`).
- **Cards are markdown strings** rendered by a full editor, and `buildCardExtensions` already
  carries the media nodes — so a card can hold whatever a page can.
- **The phone already pushes card media** into the vault (`arete-ios/src/mobile-vault.ts`
  `pushCardMedia`), write-once by id.

## What audio actually breaks

1. **`mimeFromName` has no audio types** (`lib/media.ts:54`), so an imported `.m4a` gets
   `application/octet-stream`, and an `<audio>` element fed that blob URL refuses to play. This is
   the one-line-looking change that silently breaks everything if missed.
2. **Media hydration is eager.** `loadVault` pulls *every* file in `media/` into IndexedDB at
   startup, and the phone does the same read-only. Fine for images; a few hours of voice notes
   makes it minutes of I/O and hundreds of megabytes on a phone. Audio forces **lazy hydration**:
   fetch a blob by id on first play, not at load.
3. **HTML export inlines media as data URLs.** One 30 MB recording becomes ~40 MB of base64 in a
   file meant to be shared. Audio needs either a size ceiling or an explicit "include audio"
   toggle in the share modal.
4. **Format matters more than it did for images.** WKWebView plays what AVFoundation decodes —
   MP3, M4A/AAC, WAV, AIFF, CAF, FLAC — and *not* Ogg or WebM/Opus, even though this WebKit will
   happily *record* WebM. So: always record `audio/mp4`, and treat an imported `.ogg`/`.webm` as a
   file we store and sync but cannot play in the apps.
5. **Size.** AAC at the default bitrate is ~1 MB/minute; mono at 64 kbps is ~0.5 MB/minute and
   indistinguishable for voice. Worth setting deliberately rather than taking the default.
6. **iOS audio session** is the only native work: without setting `AVAudioSession` to
   `.playAndRecord`, playback is silenced by the ring switch and recording will not start. One
   Swift call in the existing `load(webview:)` hook of `tauri-plugin-vaultfs`
   (`VaultfsPlugin.swift:30`) — no new plugin, no new command surface.

## Design

### `audioBlock` — one node, three entry points

An atom node beside `imageBlock`/`htmlBlock`, attrs `{ mediaId, name, duration }`.

- **Serialization** reuses the existing embed syntax, with the `|size` slot carrying duration in
  seconds: `![Voice note|18](media/3f2a91bc__Voice note.m4a)`. No new markdown grammar, and
  `parseMediaFilename` and the GC keep working untouched. The parser picks `audioBlock` by
  extension, exactly as `.html` picks `htmlBlock` today.
- **Idle → recording → recorded.** `/record` inserts a block already armed; a live timer and a
  level meter while recording; on stop, a compact player — play/pause, scrub, elapsed/total, and
  a speed control (1× / 1.5× / 2×, which matters for re-listening to your own notes).
- **`/audio`** opens the file picker instead, landing in the same block in its recorded state.
- Paste and drag-drop of audio files extend `MediaPaste`'s existing accept test.
- Read-only surfaces (peek, history, export) render the player without the recorder.

### Cards

The same node, registered in `buildCardExtensions`, so front and back can hold audio on Mac and
phone alike. Two decisions worth making explicitly rather than by default:

- **Autoplay on reveal.** For language cards, the audio *is* the prompt, so autoplaying the front
  when the card appears is the point. iOS allows it because revealing the card is a user gesture.
  I'd make it a per-card flag (`![name|18|auto](…)`) rather than a global setting.
- **Review keys.** The rating shortcuts own the keyboard during review; audio would need a key
  that does not collide (`P` for play/replay is free).

### The phone

Everything above is shared code — the mobile app already imports `@arete/lib/media` and reuses
`CardForm`. Its own work is: the `Info.plist` key, the `AVAudioSession` line, and honouring lazy
hydration so a vault full of audio does not get pulled onto the device.

### Storage rules to hold the line

- Record mono AAC at 64 kbps; warn (do not block) past ~10 minutes in one take.
- Hydrate media lazily by id; keep a small in-memory LRU of object URLs.
- Never inline audio into page history — it is a media id in the doc, so this already holds.
- Keep the write-once-by-id rule: an id's bytes never change, which is what makes iCloud
  convergence safe for files this size.

## Phases

1. **Playback and import** — audio MIME types, `audioBlock` + player, markdown round-trip, slash
   item, paste/drop, export. Nothing records yet; everything can already be listened to.
2. **Recording on the desktop** — `Info.plist` key, recorder UI, format negotiation.
3. **Cards** — register in the card editor, composer support, review playback and its key.
4. **The phone** — Info.plist, audio session, verify record + play in the simulator.
5. **Scale** — lazy hydration, export ceiling, size warnings.

Phase 1 is independently useful and carries no permission or platform risk, so it is the right
place to start even if recording later needs iteration.

## Decisions I need from you

- **Autoplay** on card reveal: per-card flag as proposed, always, or never?
- **Recording length**: warn only, or hard-stop at some duration?
- **Web build** (Chrome/Firefox, no MP4 recording in Firefox): record WebM there and accept that
  those clips will not play in the Mac or iPhone apps, or refuse to record where MP4 is
  unavailable?
- **Lazy hydration**: fold into phase 1 (it changes an existing hot path), or ship audio eagerly
  first and fix it when it hurts?
- **Export**: silently skip audio over some size, or a checkbox in the share modal?
