# SOU1 development score: manual and seeded configuration

This second phase adds explicit musical configuration without changing the default
score. The first-phase module with SHA-256
`9f42469d8b18d5d7e358722d83fd92290956a184a68f9af8c19046e651ed9edb`
is kept as an immutable regression fixture. No UI, native service or finite
`tools/composition/` generator is changed by these files.

## Public API

`new DevelopmentScore(sampleRate, seed, config = DEVELOPMENT_CONFIG_DEFAULTS)`

The third argument is optional. The constructor validates, copies and freezes it.
The score's `config` property is read-only. `reset()` and `reseed(seed)` retain this
same immutable configuration. To change it, stop playback and construct a new score
with the replacement configuration. This resets its transport; configuration changes
are not live parameter messages. Existing density, complexity, evolution, BPM,
swing, style weights and melody/drum controls remain live as before.

An engine that implements reseeding by constructing a new score, rather than calling
`score.reseed`, must pass the existing configuration to that new constructor.
Otherwise it intentionally receives the default configuration.

`docs/development-config.js` exports:

- `DEVELOPMENT_CONFIG_DEFAULTS`: one frozen complete defaults object.
- `normalizeDevelopmentConfig(input = DEVELOPMENT_CONFIG_DEFAULTS)`: validates a
  partial closed-schema object, supplies omitted defaults, copies it and freezes the
  result. Unknown own keys, including symbol and nonenumerable keys, are rejected.
  Invalid values are errors rather than silent fallback.
- `deterministicRandomConfig(seed, base = DEVELOPMENT_CONFIG_DEFAULTS, locks = {})`:
  returns a frozen complete configuration. Its finite seed uses the same unsigned
  32-bit normalization as the score. Values are sampled independently from the
  individual field domains, without choosing a preset.

These helpers allocate only during setup. The audio-path `advanceTo`, phrase/bar
planning, note emission, `reset` and `reseed` remain allocation-free. The seven typed
arrays still total 660 bytes of element storage.

## Closed schema

| Key | Accepted values | Default |
| --- | --- | --- |
| `tonic` | `'seed'` or integer 0–11 | `'seed'` |
| `mode` | `'seed'` or integer 0–6 | `'seed'` |
| `meter` | `'seed'` or integer 0–5 | `'seed'` |
| `rhythmFamily` | `'seed'` or integer 0–7 | `'seed'` |
| `arpStrategy` | `'seed'` or integer 0–7 | `'seed'` |
| `drumPattern` | `'seed'` or integer 0–7 | `'seed'` |
| `harmony` | `'auto'`, `'fixed'`, `'progression'`, `'modulating'` | `'auto'` |
| `drumVariation` | `'auto'` or finite number 0–1 | `'auto'` |

Selectors do not accept numeric strings, fractional numbers or null. An explicitly
provided undefined value is invalid; omit a key to accept its default. Unknown keys
are rejected to catch stale UI/native contracts and spelling mistakes.

### Selector labels

- Tonic: 0 C, 1 C♯/D♭, 2 D, 3 D♯/E♭, 4 E, 5 F, 6 F♯/G♭, 7 G,
  8 G♯/A♭, 9 A, 10 A♯/B♭, 11 B. The score's anchor register is MIDI 48 plus this
  pitch class, not an independently editable octave.
- Mode: 0 Ionian/major, 1 Dorian, 2 Aeolian/minor, 3 Mixolydian, 4 Lydian,
  5 Phrygian, 6 harmonic minor.
- Meter: 0 4/4, 1 3/4, 2 5/4, 3 7/8, 4 9/8, 5 6/4.
- Melodic rhythm family: 0 straight, 1 ternary, 2 displaced, 3 spacious,
  4 triplet, 5 broken, 6 offbeat, 7 tresillo.
- Arpeggio strategy: 0 ascending, 1 descending, 2 pendulum, 3 alternating outside
  voices, 4 skipping, 5 motif-derived, 6 triplet, 7 displaced.
- Drum pattern: 0 four-on-floor, 1 half-time, 2 broken, 3 clave/tresillo,
  4 triplet, 5 sparse, 6 offbeat, 7 tom-led.

A manual selector survives reseeding and does not get replaced by phrase planning.
A named melodic rhythm holds its onset grid: no autonomous displacement, phrase
rests, call/reply density switching or phrase-end pickups. In rhythmic mode the
named family now uses its own grid rather than the former family+2 offset. A named
arpeggio order also avoids autonomous phrase rests. Density, BPM, swing and meter
remain deliberate live choices; changing them can change the resulting rhythm.
Melody pitches, harmony and dynamics can continue developing inside a held rhythm.

`'seed'` lets the score select that aspect from its seed. Seed-selected melodic
rhythm and arpeggio can develop between phrases as in phase one. Seed-selected drum
rhythm is derived separately from the original seed's rhythm family, rather than
from a manually overridden melodic family. Thus changing melodic rhythm does not
silently change the selected drum pattern.

## Harmony policy and time

- **Auto** preserves the first-phase behavior exactly: changing chords at the
  existing ambient or driven-style spacing, fixed root/mode, and the slow three-field
  ambient endpoint at zero evolution. It does not automatically modulate keys.
- **Fixed** holds chord degree zero, tonic and mode. Motif, rhythm and articulation
  development can continue inside this fixed harmonic field.
- **Progression** explicitly permits the existing chord changes while holding tonic
  and mode. Its current event behavior equals auto; the separate policy name makes
  that user choice explicit rather than overloading it with modulation.
- **Modulating** keeps chord progression and permits temporary related-tonic visits.
  Tonic is an **anchor**, not an immutable current root under this chosen policy.
  The configured value is never rewritten. At the transition the current root moves
  up five or seven semitones modulo twelve, chosen deterministically from the phrase
  plan. The next transition returns to the anchor. The configured mode is retained.

Modulation occurs only at a phrase boundary, after
`4 + floor((1 - evolution) * 12)` phrases since the previous transition. This is
4–16 phrases. Changing the live evolution knob changes the upcoming interval, but
cannot trigger multiple catch-up modulations in one boundary. An excursion returns
after at most sixteen further phrases at valid controls. Root visits alternate with
returns; they do not form an unbounded random walk.

The score exposes `anchorRoot` (MIDI 48–59), `root` (current root in the same register)
and `modulationChanges`. A root change also increments `chordChanges`, since the
sounding harmonic field changes, but does not increment the chord-walk
`harmonicStep`. Normalized config tonic remains its original pitch class or `'seed'`.
Already sounding voices finish their normal envelopes; a new key does not forcibly
cut them off. New notes are coherent with the current root and mode.

## Percussion and variation

The eight concrete drum patterns have their own kick/snare/hat/tom onset rules and
do not read the melodic rhythm grids. Their pattern identity remains fixed across
phrases. The seed option preserves the original default percussion behavior, with
its family derived independently from manual melodic-family choices.

`drumVariation: 'auto'` preserves the original fills, phrase dynamics, breathing and
seeded phrase-family development when `drumPattern` is `'seed'` (the explicit Random
option). For a named drum pattern, Auto means held, equivalent to numeric zero.
Numeric one explicitly enables fills and phrase dynamics for either choice. Numeric values
between zero and one reduce phrase-energy variation and gate additional fills and
pickups through the existing complexity control. This is a bounded generative
amount, not a crossfade between recordings or a probability drawn on every note.

At exactly zero:

- No added phrase-end fill or phrase-start cymbal is generated.
- Percussion ignores phrase-energy changes and melodic phrase rests.
- A seed-selected drum family does not mutate between phrases.
- At fixed BPM, swing and other live controls, each bar repeats the same drum score.
- A tom-led base pattern still contains its intentional tom notes. Those are part of
  the chosen pattern, not added fills.

Density and complexity remain live controls for the base drum pattern. Changing one
can change percussion even with zero drum variation; zero disables autonomous
phrase variation, not deliberate user control. Enabling drums is still independent
of melodic style weights. Existing drum instrument gain sliders determine whether
the emitted kick, snare, hi-hat, tom or cymbal is audible in the renderer.

Percussion still shares the twelve-event-per-tick safety cap with musical events,
while using its own twelve-voice pool. Extreme mixtures can omit eligible notes;
independence describes pattern generation, not a guarantee against budget omissions.
All existing per-layer MIDI ranges, duration bounds and sample-rate limits remain
unchanged. No extra drum banks or pitches are required by this phase.

## Reproducible random combinations and locks

The random helper chooses concrete tonic, mode, meter, rhythm, arp and drum selector
integers; one of the four harmony policies; and a variation value in hundredths from
0 through 1. Because it selects fields independently rather than selecting from a
preset table, it can produce combinations that no preset contains.

`locks` is a partial object whose own known-schema keys have boolean values only.
True keeps that field's normalized base value exactly, including a deliberately
locked `'seed'`. False or omitted permits randomization. Unknown keys and invalid
lock types throw. Inherited lock properties are ignored. The random hash uses a
stable field index, so changing one lock never perturbs the random result of another
field. Caller objects are not modified.

The helper handles this musical configuration only. It does not change live style
weights, density, complexity, gains, effects or playback state. A UI may separately
randomize those existing controls under its own explicit action and display the
resulting mixed values.

## Tests and saved compatibility evidence

Run both suites:

```sh
node --test tests/development-score.test.mjs tests/development-config.test.mjs
```

All 22 tests pass. The thirteen previous tests remain in place. Nine additional
tests cover the closed schema, immutable/manual selector behavior, harmony policies,
related-tonic excursions and returns, eight distinct drum MIDI patterns, independence
from melodic rhythm, exact zero-variation bars, reproducible lock-aware random
combinations, cross-rate chunk invariance and event/voice bounds.

The default comparator imports `tests/fixtures/development-score-v1.js` and first
verifies its SHA-256 is the frozen first-phase hash shown above. It then compares
all emitted fields and diagnostics, not just note counts. The matrix contains 112
short cases across four rates, seven seeds and four styles: 136,223 exactly equal
events. Three additional three-hour default-ambient comparisons also pass.

Configuration tests additionally exercise 256 distinct random combinations, all
manual drum patterns, repeated reseeding, three-hour fixed/progression runs and
bounded modulation returns at multiple anchors/evolution settings. This report
qualifies score generation only. Browser, native, MIDI export and listening
qualification must use the separately integrated application.
