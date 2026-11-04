# SOU1 continuous development score

This original score develops music continuously in SOU1's existing ambient instrument
concept. It does not concatenate rendered excerpts, read MIDI assets or depend on the
finite cue generators under `tools/composition/`. The older `EventScore` and audio
renderer are not modified by this module.

## Integration contract

- Import `DevelopmentScore` from `docs/development-score.js` and construct it with an
  integer sample rate from 8000 through 192000 and an unsigned seed.
- `advanceTo(frame, parameters, sink)` dispatches every due event through that frame,
  inclusive. `frame` is an integer absolute sample position. `-1` is valid pre-roll.
  `sink.noteOn(frame, layer, MIDI, durationFrames, velocity, pan)` receives only scalar
  values, in nondecreasing frame order.
- `reset()` restarts the same seed. `reseed(seed)` resets to the supplied finite seed;
  a nonfinite seed is ignored. Neither operation allocates arrays.
- `beatNext` is a mutable floating-point absolute deadline. The original engine's
  stop-fade operation, which increments this deadline once per fading sample, remains
  supported. The score does not advance its musical time while this deadline alone
  is shifted. `next` is a read-only rounded view of `beatNext`.
- `tick` and `step` count executed sub-ticks, not notes; `eventCount` counts actually
  dispatched notes. `chordChanges` counts actual changes of harmonic field.
  `suppressedEvents` counts voice-budget omissions, not emitted or renderer-dropped
  notes. The per-tick safety cap may additionally omit events.
- Frame zero is an ordinary start, not an audio asset offset. There is no final bar,
  forced cadence, allocated score history, finished flag or scheduled restart.

## Musical structure

The seed selects a root, one of seven diatonic modes, one of six meters, one of six
motif lengths, a phrase length, a harmonic movement family, a rhythm family and an
arpeggio strategy. Modes include major, Dorian, minor, Mixolydian, Lydian, Phrygian
and harmonic minor. Meters are 4/4, 3/4, 5/4, 7/8, 9/8 and 6/4. Motifs have 6–12
cells; phrases have 4, 6, 8, 10 or 12 bars.

A bounded, seeded motif is composed once. At phrase boundaries its rotation,
inversion, direction, scale-degree offset, intensity and breathing space develop.
At slower long-form boundaries only one cell is mutated. Notes are read from this
shared musical material, rather than drawn independently at every onset. Rhythms
are built into four fixed-size bar grids. They include straight, ternary, displaced,
spacious, triplet, broken, offbeat and tresillo cells, with occasional pickups and
fills. Onset priority determines density; it is not a new random coin flip per note.

The independent style weights retain different musical roles:

- **Ambient:** sparse melodic gestures, long notes, very slow pads, optional bass
  responses and explicit breathing spaces. Its melody intervals use musical elapsed
  seconds rather than a busy beat grid. Default ambient has no drums.
- **Counterpoint:** alternating call and reply emphasis, a related contrary lower
  voice, independent cursors and longer answering articulations.
- **Rhythmic:** a broken/syncopated riff, short gates, displaced accents and bass
  pickups. It is not an arpeggio with a different sound.
- **Arpeggio:** ascending, descending, pendulum, alternating outside voices,
  skipping, motif-derived, triplet and displaced strategies with register changes.

At pure ambient plus evolution zero, a separate related 0 → 2 → 3 harmonic-field
cycle preserves the legacy slow endpoint: exactly three distinct fields and two
changes in the first three hours. The first field begins at frame zero. Harmonic
changes occur on the first score tick at or after each elapsed hour. Nonzero
ambient evolution shortens harmonic spacing exponentially from one hour toward
16 seconds. Driven styles use harmonic spans of one to four bars. Their harmonic
walk does not require a return to tonic at an eight-bar or phrase boundary.

Every pitched event remains in the seed's root/mode. Chord voicings and melodic
registers are bounded; nearest-register voice leading is used for sustained parts
and the two contrapuntal voices. Percussion follows the seed's meter and rhythm
family instead of always imposing one fixed 4/4 pattern.

## Live controls and timing

`ambient`, `counterpoint`, `rhythmic` and `arpeggio` are independent weights in [0,1].
They are normalized together by the square root of their sum when that sum exceeds
one. If none of these values is finite, `composition` supplies the legacy one-hot
selection, defaulting to ambient. If any explicit weight is finite, missing or
nonfinite individual weights are zero. This avoids enabling an unrequested style
when a partial explicit mix is supplied.

Density controls onset priority and ambient spacing. Complexity enables additional
motif transformations, chord extensions, pickups, fills and subdivisions. Evolution
controls harmonic spacing and longer-form development speed. Rhythm grids and
phrase plans update at the next respective musical boundary; direct gates, style
weights, mute states and BPM are read at the next due tick. Sustained notes retain
their original note-off, and enabling a sparse style does not forcibly restart its
phrase or emit an immediate new note.

BPM is sanitized to 30–180, default 72. The standalone JS class permits fractional
BPM; the existing app parameter contract supplies integers. The clock has twelve
subdivisions per quarter, supporting sixteenths and triplets. Swing lengthens the
first six subdivisions and shortens the next six equally, preserving each complete
quarter at constant BPM. A BPM change alters the next interval without rewinding
scheduled frames or emitting already processed ticks again. Equal parameter
changes at equal frame boundaries are invariant to rendering/chunk size.

`melodyEnabled: false` prevents only layers 1 and 2. Pads, textures and bass remain
available. `drumsEnabled: true` enables percussion independently of all melodic
style weights. All four style weights zero and drums disabled emits no new notes.
The caller remains responsible for terminating already sounding notes on mute,
as the existing audio renderer does.

## Safety and resource bounds

The constructor creates seven typed arrays totaling 660 bytes of element storage:
one 12-cell motif, four 72-cell grids, four previous voicing pitches and 44 voice
deadlines. This is fixed for the lifetime of the score. `advanceTo`, note emission,
bar/phrase development, `reset` and `reseed` create no arrays, objects or closures.
No PCM, rendered clips or accumulated events are stored by the score.

The melodic note budget follows the existing 8/16/24/32 polyphony control, default
16. A separate twelve-voice percussion budget matches the existing renderer. A
slot remains reserved through the known renderer release tail: pad 4 seconds,
texture 2 seconds, other pitched instruments 0.3 seconds and percussion 0.08 seconds.
When the budget is occupied, an otherwise eligible note is intentionally omitted.
The score does not promise to dispatch every candidate note or steal a sounding
voice. High density, multiple styles, long tails or low polyphony can increase these
omissions. The mixed eight-hour stress test intentionally exercises this case.

Muting melody can cause the renderer to release a voice earlier than the score's
reservation. That reservation is conservative and expires after at most 5.8 seconds
for layers 1/2. It can temporarily reduce available notes after a quick unmute; it
cannot grow without bound. Paused transport may allow absolute reservations to
expire while musical time is frozen, matching the renderer's continuing release.

Events are capped at twelve per tick. Every event has a positive integer duration
bounded by 32 seconds, finite velocity in [0.005,1], and pan in [0.15,0.85]. The
stress matrix tests observed one-second event counts at most 64, rather than
asserting that every conceivable external control schedule has that exact rate.

Emitted MIDI ranges are enforced by each emission path:

| Layer | Role | MIDI range |
| --- | --- | --- |
| 0 | Pad | 45–74 |
| 1 | Pluck | 57–88 |
| 2 | Bell / reply | 48–88 |
| 3 | Texture | 62–86 |
| 4 | Pulse / bass | 33–52 |
| 5 | Kick | 36 |
| 6 | Snare | 38 |
| 7 | Hi-hat | 42 |
| 8 | Toms | 45, 47, 49 |
| 9 | Cymbal | 49 |

These ranges are suitable for checking a replacement instrument bank; they are not
claims that each seed visits every pitch. The emitter also has a final defensive
MIDI clamp of 24–96.

## Numerical portability

JS arithmetic uses double precision, positive `Math.round` for frames/durations and
32-bit wrapping only for the explicitly seeded integer hash/LCG. The unsigned value
of `hash` and `randomInt` must be preserved when Java divides it or uses modulo.
Negative musical degrees use mathematical floor and positive modulo, not Java's
truncating division/remainder. `Math.round` on negative motif half-steps follows
floor(x + 0.5), not symmetric rounding away from zero. Java parity should compare
all emitted scalar fields, not only note counts or pitches.

## Verification

Run:

```sh
node --test tests/development-score.test.mjs
```

The thirteen score-only tests cover validation, deterministic reset/reseed, fixed
array identity, the full seed-selected structural palette, 96 distinct seed/style
melodic fingerprints, rhythm-only and root-normalized contour diversity, gradual
motif mutation, nonmandatory tonic endings, sparse ambient distinction, chunk
invariance at 8/44.1/48/192 kHz, live controls and BPM changes, swing, pause/resume,
scale coherence, event bounds, 8/16/24/32 melodic voice budgets, long ambient and
continuous eight-hour operation.

Recorded with the standalone source on 2026-11-04:

- Default ambient, seed 91, three hours: 2,307 events, two harmony changes.
- Pure ambient zero evolution, seeds 0–64: first three fields always 0, 2, 3.
- Fast-evolving ambient, seed 91, ten minutes: 37 harmony changes.
- Eight-hour mixed stress score, seed 431: 519,555 dispatched events, 650,880 ticks,
  1,356 phrases, 13,559 harmony changes, 100,406 intentional budget omissions.
- Across 24 seeds per style: 24 distinct root-normalized contours for every style;
  24 distinct rhythm fingerprints for ambient/counterpoint/rhythmic and 23 for arp.

These are generation tests, not PCM, device, UI, listening or instrument-bank
qualification. Those checks belong to integration. This change does not modify
`audio-engine.js`, native services, the UI, or the pinned finite composition tools.
