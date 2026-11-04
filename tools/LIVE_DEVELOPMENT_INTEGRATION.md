# Continuous developing score integration

This candidate adds a separate `developing` score producer while retaining the
original mode and default. It does not replace SOU1’s continuous local instrument
with a finite song player. Existing blend, density, variation, swing, development,
voice, drum, environment, timer, reseed and MIDI-history controls remain in use.

## Platform paths

- PWA: `developing-worklet.js` -> `createDevelopingEngine` -> `DevelopmentScore`.
  Procedural or prepared recorded percussion can be selected independently.
- Android: the existing native service owns an optional `DevelopmentScore` within
  `AmbientEngine`. The WebView controls it; Web Audio is not used for native playback.
- Mode selection is stopped-only and capability gated. Repeated PLAY/UPDATE does
  not change an active service’s selected score. Missing legacy status mode means
  `original`. App preferences and native status retain the explicit selection.
- `docs/audio-engine.js`, its original score and original worklet remain unchanged.
- MIDI export remains bounded live history, up to 512 notes, not a full session
  recording. Sound-bank selection does not alter the generated MIDI pitches.

## Verification, 4 November 2026

- Whole Node suite: 330 tests passed, none skipped.
- Exact JS/JVM score comparison: 948 configurations, 3,028,402 events, all six
  fields bit-identical; 8–192 kHz, control changes, chunking, seeds, four 3-hour
  and one 8-hour score-only paths. The native BPM API is integer-valued.
- JVM score allocation check: zero measured allocated bytes after warmup over
  432,020 ticks plus 100,000 single-tick calls. This is a score-core assertion,
  not a zero-allocation claim for the whole UI or AudioWorklet.
- Recorded/legacy engine regression suite and native service lifecycle/source
  contracts passed. Existing legacy PCM reference hashes remain unchanged.
- Native engine integration: 39,722 assertions, exact direct-core/history mapping,
  512-event ring, silent stop and burst-free restart, reset/reseed, all 20 legacy
  hashes unchanged, zero JVM allocated bytes over 256,000 rendered lifecycle
  frames. JS/JVM engine parity: 2,947,200 samples with maximum absolute difference
  3.725290298461914e-9; this does not claim identical legacy procedural drum DSP.
- Real cloud desktop browser on a same-environment loopback HTTP server:
  developing mode plus VCSL playback entered GENERATING, ran over seven minutes,
  retained 512 notes, exported an actual .mid file, and handled live reseed.
  Stopped original-mode playback also worked; returning to developing and
  reloading restored mode/seed/controls in STANDBY without autoplay.

The browser MIDI file was format 1, 11 tracks, PPQ 960. This checks the actual
application/AudioWorklet path, not a mock alone. No listening-quality judgment,
Android-device/background-service qualification, HTTPS offline-install test,
new GitHub CI pass or release readiness is claimed by these local checks.

The source generator’s vocabulary, bounds, intentional voice-budget omissions
and endpoint behavior are documented in [DEVELOPMENT_SCORE.md](DEVELOPMENT_SCORE.md).
Stop retains the pre-existing melodic pause/resume tails; reset/reseed clears
these voices, and recorded tails are cleared on stop.

User-editable tonal and drum-pattern configuration and expanded melodic sample
banks are a following integration stage, not part of this candidate’s contract.
