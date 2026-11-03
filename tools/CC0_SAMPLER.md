# SOU1 compact CC0 instrument prototype

This is an **offline development prototype**, not an update to the installed app,
PWA, Android package or release. It extends the offline-cue proposal with an
original, dependency-free sampler and a small, auditable sample bank. The existing
live oscillator DSP, UI, AudioWorklet, Android engine and service worker are
unchanged. No VST, JUCE, sfizz or other third-party executable was installed.

## Run and verify

With an existing Node installation (tested with Node 24.22.1):

```sh
node --test tests/sample-instruments.test.mjs
node --test tests/render-cue.test.mjs
node tests/audio-engine.test.mjs
node tests/midi-export.test.mjs
node tools/render-sample-cue.mjs output/cc0-mini
```

The last command creates `cc0-mini.wav` and `cc0-mini.json` exclusively; existing
files are never overwritten. The JSON includes event data, source commit, bank
memory size, output hash, gain, peak/RMS and accepted/dropped note counts. The
16-second demonstration mixes sampled percussion/marimba and an original sine
voice on one clock. It does not claim to reproduce the live SOU1 generator.

## Instrument contract

`InstrumentRack` is a renderer-independent, bounded event host. A note contains
integer `frame`, `duration` in output sample frames, MIDI `pitch`, `velocity`
0..1, `pan` 0..1 and an `instrument` string. `schedule` validates a whole batch
before accepting it and returns independent note IDs. `noteOff(id)` releases an
active note by ID, not by pitch. It does not cancel a future queued note; `stop`
clears all queued events and releases current voices. `reset` clears voices,
queues, counters, transport and round-robin state.

The two interchangeable backends, `SampleInstrument` and `SineInstrument`, expose
`createVoice(event, sampleRate, triggerIndex)`, `length(voice)` and
`value(voice, age)`. They share timing, velocity, pan, polyphony, note-off and stop
semantics. This is a small renderer boundary, not a desktop-plugin host.

- Queue limit: 4,096 events by default, configurable up to 16,384.
- Polyphony: 24 by default, configurable 1..64; capacity exhaustion drops and
  counts the new note rather than abruptly stealing an existing voice.
- One-shot percussion plays its natural decay despite its nominal gate;
  explicit note-off/stop still releases it. Marimba/sine respect their gate.
- Attack guard: 1 ms. Explicit/gated release: 50 ms. Same-group choke: 5 ms.
  Finite samples have a 2 ms endpoint taper. These are rendering envelopes;
  the stored PCM has not been trimmed, faded or normalized.
- Closed-hat round robins rotate deterministically. Both are **closed** strikes,
  not a closed/open pair. Group chokes happen only after a new note is admitted;
  saturated polyphony drops a hit rather than silencing an old one.
- Velocity ranges and note zones exist in the interface. This compact bank has
  **one velocity layer** per instrument, not detailed velocity multisampling.
- Sample playback uses a bounded 16-tap Hann-windowed sinc, with cutoff adjusted
  for playback rate. It is a preview resampler, not a mastering-grade converter.
- Core rack/WAV decoder use standard JavaScript; file loading and the CLI are
  Node-only. No browser AudioWorklet/mobile real-time qualification is implied.

## Compact bank and provenance

The seven WAV files in `assets/cc0-mini/` total **987,846 bytes**. Decoded mono
Float32 data totals **1,975,076 bytes** (under 2 MiB), excluding object/queue,
voice, renderer and transient load/copy overhead. The loader caps both decoded
source data and mapped instrument copies to its budget (default 8 MiB). Peak
memory during loading can exceed that steady-state PCM budget.

All source recordings are VCSL / Versilian Studios LLC, pinned to commit
[`c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`](https://github.com/sgossner/VCSL/tree/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e).
The pinned [README](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/README.md)
licenses the collection CC0 and explicitly permits commercial software/media.
The pinned [LICENSE](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/LICENSE)
is CC0 1.0 Universal. Both are retained verbatim in the bank directory. No
separate restrictions were found in the selected sample directories.

The manifest records each exact source path, Git blob SHA-1, source WAV SHA256,
processed SHA256, source/processed bytes, sample rate, frames, root note and
transform. `upstream.json` is the checked source-file index. A blob SHA-1 is not
the same as a raw-file SHA256. No individual performer attribution was inferred.

Selection:

- Orchestral bass drum: `BDrumNew_hit_v3_rr1_Sum.wav`. It is not a contemporary
  electronic kick library despite the short internal ID `kick`.
- Modern snare: `Snare2_HitSN_v5_rr1_Mid.wav`.
- Closed hi-hat: `HiHat_HitC_v2_rr1_Mid.wav` and `rr2`.
- Marimba: `Marimba_hit_Outrigger_C4_med_01.wav` and `G4_med`.
- Small shaker: `Mid_ShakerDouble_Down_rr1.wav`, a double-down gesture.

**Pitch convention:** the marimba filenames use a different octave convention
from MIDI's middle-C=60 naming. Spectral inspection found dominant tones around
525 and 783 Hz, consistent with MIDI notes **72 and 79**, not 60 and 67. The
manifest uses these roots. No fine-tuning was applied; this is not a claim of
laboratory pitch calibration. Zones cover MIDI60..75 and76..91 respectively.

Stored transforms are reproducible: `(L+R)/2`, PCM16 quantization with
round-to-even, no dither, no resampling, no trimming, no normalization or gain.
Original stereo/24-bit material remains upstream; this small bank is an
intentional compact mono derivative. These quality trade-offs need listening.

To rebuild, retrieve only the seven exact upstream files listed in
`upstream.json`, name them `sample0.wav` through `sample6.wav` in a local input
folder, then run:

```sh
python tools/prepare-cc0-mini.py /path/to/pinned-originals /path/to/rebuilt-bank
```

The converter performs no network requests and verifies pinned raw SHA256 and
Git blobs before transforming files. It was run twice into separate output
directories; all seven resulting WAV files and manifest were byte-identical.

## Safety and licensing boundaries

`loadBank` requires CC0 metadata, validates size/format/hash/shape before admission,
rejects path traversal and symlinks escaping the bank, rejects malformed/duplicate
IDs and observes memory budgets. It only returns a complete bank; failures cannot
partially install one in a live rack. A self-declared `license` field is **not**
legal evidence: every future pack still requires an independent source check.
Pinned hashes establish identity, not copyright ownership.

The sample recordings/derivatives remain **CC0-1.0**. SOU1's original code, new
sampler, converter, renderer and tests are **AGPL-3.0-only**. These are separate
licenses. The code license does not by itself relabel the samples or rendered
music as AGPL. No trademark permission or endorsement is claimed.

## Next integration step

Review the audio first, then adapt the existing EventScore sink to this instrument
boundary without changing the score's note timing. Preserve the current
oscillator default and make the CC0 bank optional. A browser implementation must
load/verify away from the audio callback, transfer bounded PCM once, expose
bank-ready/error states and preserve offline cache behavior. Android needs an
explicit matching renderer or a qualified alternative, not a claim that this
Node prototype already works there. UI changes, external synths, more banks and
release packaging remain separate work.
