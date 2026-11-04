# SOU1: composition variety, version 1

This is an **opt-in offline path**, not a replacement of the live app's pinned
`EventScore`. It changes the notes and arrangement, not just the sound preset.
The original app, Android engine, AudioWorklet, old recipes and MIDI exporter are
untouched. It shares the existing CC0 instrument rack.

## Why the old controls could feel alike

The original composition engine shares a natural-minor scale, an eighth-note
grid, 4/4 bars, eight-bar phrase scheduling and a mostly common drum skeleton.
Its four composition weights blend a small collection of motifs and arpeggio
orders. Brightness, warmth and timbre cannot replace those structural choices.
This remains useful as the stable legacy mode, but it does not cover every kind
of music.

## Six independent structural strategies

| Style | Meter | Default mode / quarter-note BPM | Musical behavior |
|---|---|---|---|
| `drift` | 4/4 | Lydian / 66 | Sparse displaced entrances, rests at phrase ends, extended two-bar harmony |
| `waltz` | 3/4 | Major / 108 | Arching melody, bass on one, chord answers on two/three, AABA |
| `broken` | 4/4 | Dorian / 104 | Sixteenth syncopation, call/response, offbeat bass, broken backbeat |
| `motor` | 7/8 | Phrygian / 126 | 2+2+3 grouping, accented ostinato, changing note order |
| `song` | 4/4 | Aeolian / 84 | Verse, lifted chorus, quieter bridge, hook/pickup notes |
| `canon` | 6/8 | Major / 92 | Delayed diatonic lower imitation, compound pulse, contrary contour |

Meter and timing are real: 7/8 contains 3.5 quarter-note beats per bar; 6/8
contains 3. `bpm` always means quarter notes, not dotted-quarter pulses.

Each seed chooses harmony and a motif identity. Phrases reuse that identity
with transposition, contour changes, replies, rests and register development.
The final two bars resolve through scale degree V to I. In modal scales this
is a **modal ending**, not necessarily a classical major dominant cadence.
Harmony is voice-led, and bass fifths and imitations follow the selected scale.
Rhythm, melody and accompaniment use independent random streams: muting a group
does not reroll another group. Turning density to zero retains phrase anchors;
use `melody:false` for an actual melodic mute.

## Render and replay

Requires an existing Node installation. No packages, plugins, network calls,
accounts or new sample download are needed.

```sh
node tools/render-variety-cue.mjs examples/variety/broken.json output/broken
node tools/render-variety-cue.mjs --replay output/broken.json output/broken-again
node --test tests/variety-score.test.mjs
```

Output is stereo PCM24 WAV plus a JSON receipt: normalized options, complete
source notes, routed notes, chord/section plan, symbolic metrics, exact source
fingerprints, peak/RMS levels and WAV hash. Replay rejects mismatched code/bank
fingerprints or audio bytes. Existing outputs are never overwritten. A failure
is reported rather than silently clipping, normalizing, dropping voices or
substituting unknown instruments. File-pair saves are not crash-atomic.

Options:

- `style`: the six names above; default `song`.
- `seed`: uint32; default 7311.
- `bars`: integer 2..32; default 16. Sixteen bars expose the complete four-section
  form. Short cues deliberately use only its beginning and ending.
- `bpm`: finite 40..180, including fractions. The active score must fit in 120s.
- `sampleRate`: 44100 or 48000. Two seconds of transport release follow the bars.
- `root`: MIDI pitch 48..71, default 60. It identifies the tonic, not the entire
  melody register.
- `mode`: `major`, `aeolian`, `dorian`, `lydian`, `phrygian`, `harmonic-minor`.
- `density`, `variation`: 0..1. Density thins weak lead notes; variation controls
  motif alterations and fills. Neither promises a genre-quality score.
- `melody`, `drums`: booleans. Drum defaults depend on the strategy.
- `outputGainDb`: -60..24, default +4. Lower it if a loud configuration clips.

## Programmatic contract

```js
import {composeVarietyPlan, VarietyScore} from './composition/variety-score.mjs';
import {renderVarietyCue} from './render-variety-cue.mjs';
const plan = composeVarietyPlan({style:'motor', bars:16, seed:42});
const {wav, report, events} = await renderVarietyCue(plan.options);
```

`plan.sourceEvents` contains `frame`, `sourceInstrument`, `pitch`, `duration`,
`velocity`, `pan` plus audit labels `bar`, `beat`, `role`, `section`. Layer
numbers match the old EventScore. `plan.events` is directly schedulable on the
existing `InstrumentRack`; the same marimba, sine pad/bass and VCSL drum sounds
are used for every style. No new instrument or external melody is embedded.

`new VarietyScore(sampleRate, seed, options).advanceTo(frame, sink)` dispatches
the existing six-scalar `sink.noteOn(frame, layer, pitch, duration, velocity,
pan)` contract. Its **method signature is intentionally not identical** to the
live score's `advanceTo(frame, parameters, sink)`: settings are fixed at
construction, and the score is finite. Call `reset()` to replay it. Do not
replace the legacy engine blindly or claim realtime compatibility.

The pure composition module has no Node/browser imports and can be adapted to
another host. Browser, AudioWorklet, REAPER, plugin hosting and live parameter
automation still require their own integration and validation.

## What the checks establish

Tests verify seed repeatability; independent muting; sample-clock timing at
44.1/48 kHz; complete-bar boundaries and tonic endings; valid event routing;
bounded note counts at parameter extremes; all six scales; block-invariant WAV
rendering; exact fresh-process replay; unchanged original DSP hashes; and
structural contrast even with the same BPM, mode, seed and no drums.

Interval/rhythm trigram distances are descriptive, transposition-invariant
symbolic measures. Higher distance is **not** a quality rating. These tests
cannot establish that a phrase is pleasant, original in a legal sense, free of
accidental resemblance, or suitable for a particular scene. Audition the demos.
No subjective listening approval, production deployment or GitHub CI pass is
claimed by a local test report.

Code retains this repository's AGPL-3.0-only notice. The existing CC0 bank and
its source notices remain separate and unchanged. No third-party synth code or
new sample library is redistributed by this change.
