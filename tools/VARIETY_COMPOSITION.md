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
`velocity`, `pan` plus audit labels `bar`, `beat`, `gateBeats`, `role`, `section`. Layer
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

## Further MIDI / phrasing variety

`composeExpressivePlan` is an optional second arrangement step, leaving all
existing `composeVarietyPlan` note bytes unchanged. Five independent phrasing
strategies combine with the six base forms (30 combinations):

- `lyrical`: fewer attacks, linked longer gates, smaller passing leaps and a
  phrase-level dynamic arch.
- `dialogue`: the lead asks in the first half-bar and a separate voice answers
  in the second. The original countermelody is replaced, not just layered on.
- `angular`: displaced, short fragments, larger diatonic leaps and gaps.
- `ornamented`: diatonic grace/turn notes resolve into the target note.
- `triplet`: offbeats move onto thirds, with matching gate/bass/hat treatment.

`phraseBars` (2, 4 or 8) changes the dynamic-arch length; `dynamics`, `humanize`
and `articulation` range 0..1. Articulation affects detached/ornamented/swung
gates; lyrical and dialogue gates follow their own phrase rules. Seeded
humanization is bounded to ±0.025 quarter-note beats and small velocity changes
at maximum strength. It never moves a note into another bar. These are
algorithmic arrangements, not a claim to reproduce a human performance.

```sh
node tools/render-variety-cue.mjs --expressive examples/expressive/song-dialogue.json output/dialogue
node tools/render-variety-cue.mjs --replay output/dialogue.json output/dialogue-again
node tools/export-score-midi.mjs --expressive examples/expressive/song-dialogue.json output/dialogue.mid
node tools/export-score-midi.mjs examples/variety/motor.json output/motor.mid
node --test tests/expressive-score.test.mjs
```

```js
import {composeExpressivePlan} from './composition/expressive-score.mjs';
import {exportScoreMidi} from './composition/score-midi.mjs';
import {renderExpressiveCue} from './render-variety-cue.mjs';
const recipe = {score:{style:'song',seed:477,mode:'major'}, phrasing:'dialogue',
  phraseBars:4, dynamics:.8, humanize:.25, articulation:.8};
const plan = composeExpressivePlan(recipe);
const midi = exportScoreMidi(plan); // Uint8Array bytes plus a conversion report
const audio = await renderExpressiveCue(recipe);
```

MIDI is Standard MIDI File type 1, 960 ticks/quarter, with the actual tempo,
time signature, named melodic parts, one combined percussion track and section
markers. The combined channel-10 track guarantees note-off-before-retrigger
ordering even when two source drum layers use the same MIDI key. Unlike the retained-history
export, this exports the complete finite score rather than the last 512 notes.
It preserves elapsed score timing within MIDI quantization and ends after the
final bar, without the WAV transport's two-second tail.

MIDI1 cannot encode independent overlapping voices of the same pitch/channel.
The exporter coalesces simultaneous duplicates or shortens a preceding
overlap and reports every edit. High-tom articulation key 49 is translated to
GM tom 50 to avoid the crash-cymbal key on channel 10. Melodic pan is a
per-track average; simultaneous per-note pan is not claimed. Program changes
are only GM suggestions. A host still needs the desired synths, saved patches
and separate drum instruments. No REAPER import or exact plugin-state recall
is established by these byte-level tests.

Musical `gateBeats` is retained before conversion to sample frames. Expression
operates on those beat values, so a rounded half-beat cannot become two thirds
at one sample rate and one third at another. All marker metadata is bounded
and validated against the finite score.

## Combine composition with a prepared drum kit

Both audio renderer APIs accept a top-level `drumKit`: `vcsl` (default),
`fsa-electronic` (the original mini-kit), `fsa-distkit`, `fsa-sdbkit`,
`fsa-synthkit`, `fsa-x0xproc1` or `fsa-x0xproc2`. For expressive audio it belongs
beside `score`/`phrasing`, not inside the pure composition's `score` options:

```js
await renderExpressiveCue({score:{style:'broken',seed:477,bars:16},
  phrasing:'triplet', drumKit:'fsa-distkit'});
await renderVarietyCue({style:'motor',seed:42,bars:16,drumKit:'fsa-x0xproc2'});
```

Kit selection never changes the generated notes, timing, velocity or pan.
Receipts record both banks and the supplying bank for every sampled instrument.
In particular, `fsa-sdbkit` has no cymbal and retains VCSL short clash explicitly.
The selected manifest is fingerprinted, and exact replay keeps the kit choice.
No arbitrary bank path or URL is accepted. Pitched instruments remain VCSL
marimba and sine pad/bass; this is not a Surge XT integration.

The pure composer takes composition options only. The MIDI CLI also accepts
the same render recipe: it validates `drumKit`, removes it before composition,
and records it as `requestedDrumKit` in the receipt. It does not change the
MIDI bytes or automatically load the bank. Select that kit in the MIDI host;
no sample audio is embedded in a MIDI file. For example:

```sh
node tools/render-variety-cue.mjs --expressive examples/integrated/broken-triplet-fsa-distkit.json output/broken
node tools/export-score-midi.mjs --expressive examples/integrated/broken-triplet-fsa-distkit.json output/broken.mid
```

The live browser/Android app still
uses its previous engine. See [full drum-kit provenance](FULL_DRUM_KITS.md).

New expressive receipts include their own recipe and fingerprint. Legacy
audio recipes still produce the same audio, but old receipts must be replayed
with their matching code version because source fingerprints intentionally
change when the renderer gains a new module.
