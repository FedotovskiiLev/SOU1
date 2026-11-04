# SOU1 0.3 candidate: continuous instrument integration

This is a development candidate, not evidence that the public app or installed
Android package has been updated. The original oscillator path and saved controls
remain available. No Surge/SFZ host is embedded in the browser or Android app.

## Selection and control contract

- Composition: Original or Developing phrases. The latter is a continuous,
  sample-clock score, not a finite exported cue repeated in a loop.
- While stopped, configure tonic/pitch class, scale, meter, melodic rhythm,
  arpeggio order, drum pattern, harmony over time and drum variation. See
  [exact schema and musical meaning](DEVELOPMENT_CONFIG.md).
- Manual choices automatically lock that field. Explicit lock checkboxes control
  future randomization. Presets and New melody do not overwrite these settings.
  Randomization draws separate reproducible combination seeds and preserves all
  locked fields. It does not change the playback seed.
- Drum kit: procedural, one recorded bank, or five independently selected roles.
  Per-role `inherit` follows the chosen base kit. Explicit manual source choices
  remain explicit even if equal to the current base, so changing base does not
  erase user intent. [Routing and documented fallbacks](../docs/CUSTOM_DRUM_BANKS.md).
- Melodic palette: procedural, Chamber, Piano Room or Flute Chamber. Chamber and
  Piano Room cover the developing score's full declared pitch ranges. Flute lead
  is range-limited; unrepresented notes use the original oscillator at the same
  MIDI pitch and are counted as fallback. Polyphony drops are not silent fallbacks.
- Original brightness/modulation/pluck-decay controls affect oscillator voices;
  recorded instruments keep their source timbre. Layer levels, shared effects,
  activity, melody toggle, tempo, polyphony, weather and timer remain effective.
- The 8/16/24/32 melodic voice limit is shared by sampler and oscillator fallback.
  Lowering it releases surplus voices instead of reviving them when raised again.
- Config and bank changes require stopped playback. Existing live knobs and New
  melody work while playing. Settings persist without autoplay on reload.

## Thread and memory contract

The PWA prepares/checks recorded drums then melodic instruments sequentially on
workers. Melodic lookup tables and sinc kernels are compiled before the audio
processor receives them. Prepared ArrayBuffers are transferred, not copied through
AudioWorkletNode processor options. The processor acknowledges the exact setup
request before playback. Cancellation, timeout, processor failure and stale ready
messages cannot reactivate an old selection.

The Android foreground service uses its bounded preparation worker and immutable
selection DTO. The bridge advertises new capabilities; old clients/default
constructors retain Original/procedural/default-config behavior. No new permissions,
network dependency or security settings are required. A malformed acknowledgement
for the active request stops uncertain audio rather than retaining stale playing.

The selected melodic palette owns about 23–32 MB source Float32 PCM plus bounded
lookups/kernels. Preparation can temporarily hold source and owned copies; the
32 MB bank budget is not a promise about total browser/JVM/Android heap. Actual
mobile heap, load latency and sustained audio deadlines require device testing.

## Local checks on 2026-11-04

The combined candidate passed 388/388 Node tests without skips and these suites:

```
sh tests/run-development-config.sh
sh tests/run-custom-drum-banks.sh
sh tests/run-native-selection.sh
sh tests/run-native-drum-service.sh
sh tests/run-recorded-engine.sh
sh tests/run-recorded-melodic-engine.sh
sh tests/run-recorded-melodic-parity.sh
```

Configured Java/JS score comparison: 1,310 cases / 6,878,942 events, all six event
fields exactly equal, including 587 modulation transitions. Original defaults
also retain the frozen first-phase event stream. Melodic engine checks cover
18,461,402 assertions and zero measured hot-path JVM allocations. Six real-bank
chamber/piano/flute+drum cases at 44.1/48 kHz match all 4,420,800 Float32 output
samples exactly, with identical MIDI-source histories and routing counters.
These are CPU/software comparisons, not physical Android audio qualification.

Independent UI/worklet regression review covered malformed native status, delayed
processor cleanup racing a new preparation, cancelled/page-hidden/failed/time-out
loads, stale ready messages, locks/presets/reseed/persistence, mixed polyphony and
initialization. Two observed race defects were fixed and regression tests added.

Actual cloud Chromium ran the combined prepared instruments and mixed drum bank,
showing generated MIDI and 464 sampled notes / 0 fallback / 0 dropped at one
observation. A later renderer crash displayed error code 9 around a MIDI-export
attempt. Its cause is not established. A subsequent same-selection browser rerun reached 3:14 with 2,973 sampled / zero
fallback / zero dropped and stopped normally. An independent 180-second Node
audio-time run retained bounded heap/buffers and passed twelve MIDI encodes. The
original browser crash is still unexplained; these reruns do not establish its
cause or physical-device/listening quality. A stopped-session export was saved through the actual system file dialog and
independently parsed by Java: 5,038 bytes, 10 tracks, 960 PPQ, 504 balanced note
pairs, no stuck notes. Piano Room and Flute Chamber also played; range-limited
Flute fallback was visible and correctly counted. A real preparation cancellation
returned to stopped, and the service-worker update reloaded without autoplay.
The browser subsequently loaded and played recorded instruments after the local
preview server was stopped (connection probe exit 7), using the installed service
worker cache. This tests the trusted loopback offline path, not public HTTPS
deployment, Android installation or the browser install prompt.

## Remaining release gates

- Confirm the public HTTPS deployment and PWA install prompt. Trusted-loopback
  browser playback, real MIDI save, cancellation, palette switching, stopped reload
  and server-disconnected cache playback/update have been exercised.
- Compile/lint the exact combined Android revision and inspect APK contents.
- Sign with the existing owner-controlled release identity; never place its key
  or password in the repository. Verify upgrade/install and foreground/background,
  focus loss, headphone disconnect, pause/reseed, timer and MIDI save on a device.
- Candidate Android version is 0.3.0 / code 3. `docs/version.json` deliberately
  still describes the existing signed 0.2.0 APK until a verified 0.3 package exists.
  Update its URL/hash/source/build/certificate/device claims from real results.
- Check the exact release bundle includes source attribution, CC0 notices and
  AGPL source access. No native sampler-host or unrelated private project code
  belongs in this public bundle.
- Publish through an ordinary reviewed merge and 0.3 release only after applicable
  gates pass. No force push, rewritten history or claim that old CI passed new code.
