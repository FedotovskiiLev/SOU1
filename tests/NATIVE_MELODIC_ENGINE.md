# Prepared melodic banks in the native engine

This addition changes only `AmbientEngine.java`. The bank loader, immutable
`DevelopmentConfig`, `DevelopmentScore` and 32-voice `LiveMelodicPool` are separate
owned components. No Android service, UI, permission, asset or loader changes
are included in this patch.

## Constructor and routing contract

The original constructors retain their previous PCM/score behavior:

- `AmbientEngine(rate)`
- `AmbientEngine(rate, seed)`
- `AmbientEngine(rate, seed, drumBank)`
- `AmbientEngine(rate, seed, drumBank, developing)`

New prepared-bank overloads are:

- `AmbientEngine(rate, seed, drumBank, melodicBank, developing)`
- `AmbientEngine(rate, seed, drumBank, melodicBank, developmentConfig)` selects
  the developing score; null config uses `DevelopmentConfig.DEFAULT`.
- `AmbientEngine(rate, seed, drumBank, melodicBank, developing, developmentConfig)`

A null melodic bank retains the old renderer exactly. The bank sample rate must
match the engine. Bank choice/config are immutable session selections. Decoding,
large PCM ownership copies and filter preparation must finish on the preparation
worker before constructing the engine.

Generated events enter the existing history before any voice-limit rejection.
Layers 0–4 call `trigger(layer, pitch, durationFrames / rate, velocity, pan)` with
no transposition, gate rewrite, velocity remapping or alternate pan. Only a rise
in the sampler's `unmapped` counter permits an original-oscillator fallback.
Mute, disabled transport, invalid events and full-budget drops cannot produce
fallbacks. Sampler and fallback voices share the existing 8/16/24/32-note budget.
Lowering the limit retires excess sampled voices over 50 ms and legacy fallback
voices over the original 80 ms. Raising it never resurrects retiring voices.

Layer gains retain existing smoothing. A reusable five-element gain array applies
the existing melody smooth gain only to layers 1/2. Sampler output joins the dry
musical bus before the existing intensity gain, weather, MacroBus, DC blocker and
limiter. Render/control hot paths allocate no objects. All mutable pool calls run
on the renderer, not the control caller.

Stop releases sampled tails; transport silence clears any remaining tails even
after a one-frame start/stop. Reseed and reset clear sampler voices and round
robin state. Existing procedural pause semantics and weather/shared-space reseed
semantics remain unchanged.

## Diagnostics

- `getRecordedMelodicAcceptedCount()` counts sampled admissions.
- `getRecordedMelodicDroppedCount()` counts explicit non-mapping rejections,
  including shared melodic-budget rejection.
- `getRecordedMelodicUnmappedCount()` counts actual missing mappings only.
- `getMelodicFallbackCount()` counts missing mappings successfully admitted to
  the original oscillator pool.
- `getActiveRecordedMelodicVoiceCount()` counts only sampler voices.
- `getActiveVoiceCount()` now includes sampler plus oscillator/fallback voices.

Cumulative route counts survive stop and reseed; `engine.reset()` zeros them.
The internal pool may reset its own counters while clearing tails. Sample note
retirement contributes to the engine note-off diagnostic when the sample voice
ends, independently of the unmodified gate recorded in the exported score.

## Verification

Run from a complete integrated checkout:

    sh tests/run-recorded-melodic-engine.sh
    sh tests/run-recorded-melodic-parity.sh
    sh tests/run-developing-engine.sh
    sh tests/run-recorded-engine.sh

The isolated test checkout can point to prepared assets with
`MELODIC_ASSETS_ROOT=/path/to/docs`. The parity runner accepts a separate JS
checkout as its first argument and a factory module path as its second. It loads
that factory dynamically and uses only locally verified asset bytes.

Verified on 2026-11-04 with JVM and Node:

- 18,461,402 focused native assertions / 9,053,450 rendered frames, using real
  Chamber, Piano Room and Chamber Flute banks at 44.1 and 48 kHz.
- Exact pool-level pitch, gate, velocity and pan delivery against a separate
  sampler; exact generated score history under drops and controls.
- Both full-range palettes cover all tested emitted notes without fallback.
  Flute restrictions are explicitly counted and fall back at original pitches.
- Polyphony 8/16/24/32; mixed 16 sampled + 16 fallback voices reduce to a total of
  8, then increasing the limit does not revive retired voices.
- Melody mute affects only layers 1/2; disabled/full/muted cases never fall back.
- Repeated pause/restart/reseed/reset, one-frame stop, exact stopped silence,
  bounded PCM and render-block partition independence.
- Actual ThreadMXBean measured 0 hot-path bytes across 256,000 frames per rate
  with control/reseed/stop/reset operations, plus 512,000 frames per rate with
  all 32 sustained sampler voices active. Timing is host-only evidence, not an
  Android throughput guarantee.
- All 20 frozen legacy PCM/history hashes and 39,722 prior developing-engine
  checks remain unchanged.
- Existing recorded-engine regression: 1,602,145 checks and 2,402,400 stereo
  samples bit-identical to its existing JS renderer; legacy DSP/score/history
  suites and live drum tests also pass.
- Six integrated real melodic + recorded `fsa-x0xproc2` vectors: 4,420,800 stereo
  samples bit-identical between native and JS; exact source event histories,
  route counters and active voice counts at every 2/4/6/8-second boundary.
  Default developing config, seed 7311, BPM 112→180 at 2 s→112 at 4 s, stop at
  6 s. The vector builder uses the unchanged `DevelopingEngineTest.knobs` values
  including macros/weather. It records exact source manifest hashes and bytes.

Dense sustained Chamber sessions can legitimately hit the selected budget and
drop new notes; they are never silently replaced by oscillator notes. These are
JVM/Node tests only. Android AudioTrack/device listening, foreground/background,
lockscreen, underruns, preparation peak heap and musical acceptance remain
separate release checks.

Generated `.f32` fixtures are local reproducible evidence, not required checked-in
assets. The Java vector producer and Node comparator generate/validate them.
