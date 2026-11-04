# Recorded drums in the existing PWA

This development branch adds an optional recorded percussion path to the existing
continuous SOU1 engine. It is not a release or a claim of browser/device acceptance.

## Preserved behaviour

- Original procedural drums remain the default; old saved preferences remain valid.
- The continuous EventScore, oscillator melodies, effects, independent weather,
  layer controls, seed/reseed, sleep timer and retained MIDI history are unchanged.
- The separate expressive finite composer and its full-score MIDI exporter remain
  offline/experimental tools. Selecting a drum bank does not replace live notes.
- The updated Android bridge exposes the same selector through a native bank
  preparation/engine path; older bridges hide the unsupported choice.

## Preparation and playback

Stop playback, select a bank in Voices, enable Drums and press Play. Nine recorded
options are available: VCSL, the compact FSA electronic map, five full FSA kits,
and Guigui soft/dynamic. Missing selected samples cause an explicit failure, never
an unreported fallback to procedural synthesis. Intentional VCSL articulation
fallbacks in incomplete electronic maps are recorded in the preparation report.

A module worker loads exact manifest/WAV bytes, verifies source hashes and bounds,
and prepares mono PCM at the AudioContext sample rate. The 16-tap windowed sinc
reconstruction happens once, before playback. The fixed 16-voice worklet pool does
no decoding, resampling or voice allocation in its sample loop. No sample
normalization or hard clipping is added; bounded sinc overshoot is retained and
the existing engine limiter remains downstream. Per-layer level and activity gain
are applied once before the existing shared effects and weather path.

Cancel interrupts preparation, including a pending AudioWorklet module load.
A generation guard prevents late results from replacing a newer graph. Changing
the bank is disabled during playback, preparation and a pending MIDI snapshot.
A rapid Stop/Play reuses the graph without a stale silence event suspending it.
When an early Stop reaches global silence before a sample release ends, residual
voices are cleared so the next Play cannot resurrect a frozen tail.

Guigui dynamic selects hard articulations only above note velocity 0.6. Layer
volume is an output gain, not a velocity control. Source hard-hit rail contacts
and the non-calibrated dynamics are unchanged; consult ACOUSTIC_DRUMS.md.

## Packaging

Run `python3 tools/package-web-drums.py`, then `python3 tools/version-cache.py`.
The first command copies 118 exact files (9,669,430 bytes) under docs/audio-kit,
with original notices, provenance and SHA-256 source lock. Code keeps AGPL-3.0;
sample licenses remain CC0. No network, optional install or new license is needed.
Generated files must match canonical sources; unexpected stale package files cause
an error rather than silent deletion. The complete package is precached. A failed
asset request rejects installation so an incomplete update does not activate.

## Validation and remaining acceptance work

Node tests exercise actual bank data over a local HTTP server, strict preparation,
two acoustic sample rates, original-score and muted-drum PCM parity, live controls,
stop/reseed/reset, the actual worklet module with a host shim, worker cancellation,
UI races using DOM/AudioContext doubles, and service-worker packaging contracts.
The Java LiveDrumPool building block additionally matches 18,000 JS/native frames
at 8/44.1/48 kHz and reports zero measured allocation over one million hot-loop
iterations. The native service now uses this pool through the optional bank
constructor; see NATIVE_DRUM_SERVICE.md for its separate integration tests and
unverified device/build requirements.

These are software tests, not listening, browser, performance-deadline or Android
qualification. The available cloud browser cannot reach the localhost preview;
no browser-access restriction has been bypassed. Before release, verify genuine
browser playback/autoplay, install/update/offline, Cancel/Stop/restart, MIDI save,
long sessions and controls; then verify a built Android package on a real device,
including foreground/background, audio focus, notification controls and timer.
The old downloadable APK and version are deliberately unchanged.
