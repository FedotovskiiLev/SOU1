# Compact recorded melodic palettes

This isolated addition supplies real CC0 acoustic instruments to both Java and
browser DSP. It does not yet change the production engine, UI, cache, manifest,
service or default procedural sound. Those integration paths remain with their
existing owner. No Surge/sfizz/GPL host binary is included or required.

## Palettes

- `chamber`: sustained cello, harp lead, harp reply, sustained violin, pizzicato
  cello bass. Decoded mono source PCM: 23,127,028 bytes.
- `piano-room`: cello, Steinway B lead/reply, violin, pizzicato bass. Decoded PCM:
  32,297,680 bytes. The piano retains three original velocity bands, at source
  roots six semitones apart. This is a compact instrument, not the full piano.
- `chamber-flute`: chamber with a soft flute lead. Decoded PCM: 26,327,028 bytes.
  Flute range is only MIDI 60–78, the region previously balanced for chamber music.
  A caller must explicitly fall back at the original event pitch outside it,
  recording that fallback in diagnostics. Never silently transpose or lose notes.

Two main palettes cover the entire DevelopmentScore contract: pad 45–74,
lead 57–88, reply 48–88, texture 62–86 and bass 33–52. The optional flute restriction
is deliberate. Pizzicato's original lowest C2 zone is extended down three
semitones for the bass range; the actual emitted MIDI pitch is unchanged.

The package has 89 distinct WAVs, 21,374,756 encoded bytes in total. A preset
loads only its own samples, shared across roles and pitches. Source data is mono
32kHz PCM16. There is no per-sample normalization: original region gains and
velocity boundaries survive. Pizzicato keeps two velocity layers and two
alternates. Quiet strings/flute use one selected soft source layer across the
velocity range. The original project controls still apply to generated notes.

## Browser handoff

1. `loadRecordedMelodies(preset, sampleRate, {signal})` starts a dedicated module
   worker. Fetching, SHA256, WAV decoding, owned PCM copies, zone/group lookup and
   sinc kernel preparation happen there. Abort terminates that worker. A caller
   still must check its latest request ID before activating the result.
2. It returns `{wireBank, report}`. `wireBank` is a structured-cloneable prepared
   DTO, not an instance with private fields. Transfer it into the processor with
   `melodicTransferList(wireBank)`; never clone the large PCM payload.
3. In processor setup use `LiveMelodicPool.fromPrepared(rate, wireBank)`. This
   adopts the transferred source/table buffers and initializes bounded voice and
   per-pool RR cursor state. It does not copy/scan every PCM frame, decode audio or
   compute filter tables. The adoption API is an internal ownership-transfer
   seam for intact, worker-prepared data, not an arbitrary untrusted-bank parser.
   Do not retain mutable aliases or use SharedArrayBuffers.
4. The raw `new LiveMelodicPool(rate, rawBank)` constructor remains useful for
   tests and off-render preparation. Never call that heavy path in a running
   AudioWorklet.
5. `trigger(layer, pitch, durationSeconds, velocity, pan)` returns accepted/not
   accepted. `next(Float64Array(5), enabled)` writes `outputL` and `outputR`.
   Omit `enabled` to retain state set by `setEnabled`. Melody's existing checkbox
   maps to `setMelodyEnabled`, which affects layers 1/2 only. It must not disable
   pads 0 / texture 3 / pulse 4. Preserve existing gain smoothing and pre-effects mix.
6. Stop/release is a 50ms fade, reset clears tails and RR counters, reseed should
   call reset. Repeated controls never extend a release. Release during attack
   captures the current attack amount and cannot produce a swell. Full pools
   drop the new event without stealing existing voices. Missing mappings return
   false; use the separate `unmapped` counter to distinguish fallback from a
   polyphony/disabled event. Never create a fallback for a deliberately muted
   or full-pool event.

MIDI velocity selection uses nearest integer `round(velocity*127)`. Exact key /
velocity match groups have independent round-robin cursors. PCM is not copied
per pitch; playback uses precomputed 16-tap, 128-phase Hann-windowed sinc tables
with interpolation between phases. Capacity is preallocated at32. `setVoiceLimit(8|16|24|32)` keeps the existing
polyphony control, smoothly retires excess voices and never cancels an active
release. `getPolyphony()`/`polyphony` reports the active limit, capacity stays32.
No allocation/transcendentals in the render
loop. The output is not separately limited: it belongs before the existing
shared effects and limiter.

## Android handoff

Run `NativeMelodicBankLoader.prepare(preset, rate, AssetManager::open)` on the
existing background preparation worker. It checks exact compiled manifest and
WAV hashes, fixed mono PCM16 headers and budgets. The immutable resulting Bank
includes privately owned source PCM and compiled filter/zone lookup tables.
Create `new LiveMelodicPool(prepared.bank, 32)` and use the same event/control
contract. It performs no decoding, filtering preparation or large PCM copies.
The loader handles thread interruption; the service must preserve request IDs,
background playback, MediaSession, timer and single render-thread ownership.

Selected PCM is capped at 32 MiB, filter tables at ~4 MiB (actual~81–97KiB). In source
preparation, original decoded PCM and owned copies can briefly coexist, about
64 MiB for the largest bank, plus loader/VM objects and any still-live old bank.
Do not call the 32MiB source cap a total heap cap. Prepared transfer avoids a
second receiver-side copy. Release old preparation/worker references promptly;
validate peak heap and switching on actual target devices.

## Provenance and reproduction

Only public CC0 data is included from Versilian Studios:
VSCO2 CE `6dd651d55dde97fd4028699be9d4481f26917891` and VCSL
`dfcf4a4918771eee884b96ad4493de82ef84daf6`. Every derived WAV has source URL,
original size/SHA256/Git blob, pinned map SHA and exact transformations in its
manifest. Source legal text/readmes are included. Player/tool source retains the
repository's AGPL-3.0-only license; recordings stay CC0.

`tools/melodic-source-lock.json` and `tools/melodic-source-maps/` contain only
selected public CC0 source references/maps. Supply those verified upstream WAVs
under the listed roots to rebuild with NumPy 2.3.5 and SciPy 1.17.0:

    python tools/prepare-melodic-banks.py SOURCE_ROOT tools/melodic-source-lock.json docs/melodic-assets
    python tools/generate-melodic-catalog.py

The builder verifies both SHA256 and Git blob SHA1 before transformation. It
applies source offsets, arithmetic-mean mono downmix, Kaiser resampling, bounded
sample duration and 30 ms terminal fade. No source normalization or repair.
Sustained cello/violin use newly derived 250 ms crossfaded loops, not claimed
original author loops. Other sounds have finite decay. Piano omits pedal and
release-trigger recordings; harp tails are shortened. These limitations are
intentional and must not be described as full SFZ fidelity.

## Verification and remaining gates

    node --test tests/live-melodic-pool.test.mjs tests/melodic-bank.test.mjs tests/melodic-worker.test.mjs
    python tools/generate-melodic-catalog.py --check

Tests exercise exact verified WAVs, declared ranges, velocity boundaries,
round-robin/reset, long loops, early stop/gate/mute, persisted disable, cancellation,
actual Node Worker structured transfer, poison/error paths and Java/JS rendering
at 44.1/48 kHz. `tests/melodic-verification.json` records actual deltas, memory and
32-sustained-voice JVM throughput/allocation. `melodic-transfer-verification.json`
records transfer evidence and consumer setup time. These are Node/JVM results,
not browser AudioWorklet, Android AudioTrack, device listening or final product
acceptance. Real browser/device switches, background/lockscreen, underruns, heap,
musical balance, loop audibility and perceived quality remain release gates.

Loop endpoints are source-specific, not fixed at one timestamp: selected 250ms
window RMS differs by at most0.115dB between start/end (previous fixed points
reached11.11dB). PCM remains byte-identical. This removes an objective level
mismatch, but does not establish perceptual loop transparency.
