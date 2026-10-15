# SOU1 synthesis contract

All audio is produced by original mathematical synthesis. There are no recordings,
third-party sample packs, music quotations, network calls, or private-project inputs.

## Integration

Create `new AmbientEngine(sampleRate, seed)` for the actual AudioTrack rate. Rates
8000 through 192000 Hz are accepted. Call `start()`, then repeatedly call
`render(shortStereoBuffer, offsetInSamples, frameCount)` on one audio thread and
write the interleaved left/right PCM16 samples to AudioTrack. A float overload is
provided for analysis or float PCM output. Keep buffers small enough for responsive
controls (256–1024 frames is suitable). Zero frames are allowed.

The engine begins silent. `start()` fades in over two seconds; `stop()` fades out
over at most two seconds. Continue rendering and writing until `isSilent()` is true
before stopping/releasing AudioTrack. Never block Android's main thread while
waiting for this. A rapid stop/start smoothly reverses the current fade. Complete
silence pauses musical time; restarting continues the same scene. Call reset() on the render thread to clear the score, voices and tails while
preserving control targets, or create a new instance to restart from the seed. `isSilent()` must be read on the rendering thread.

UI threads may call start/stop and publish `new AmbientEngine.Parameters(intensity,
brightness, motion, timbre)` through `setParameters`. Controls are finite, clamped 0..1;
NaN/infinity use neutral defaults. A parameter snapshot is read once per render
block, and values smooth over a 1.5-second time constant. Call `getParameters()` to
read the latest target, not instantaneous smoothed values. Control setters do not
allocate on the rendering thread. Do not render one engine concurrently.

## Composition and instrument contract

The score emits scalar note-on events: sample frame, instrument, MIDI-numbered
pitch, gate duration in frames, velocity (0..1), and equal-power pan (0..1).
These are internal musical events, not a MIDI file/device protocol. At the exact
gate frame a voice receives note-off, followed by its bounded release envelope.
Control mute, polyphony reduction and reseed can end a gate early. JS optional
onNoteOn/onNoteOff diagnostic callbacks expose accepted voice IDs and frames;
score-only noteOn traces also include gates for notes the voice limit may reject.

Controls shared by web and Android:
- ambient=1, counterpoint=0, rhythmic=0, arpeggio=0: independent style weights 0..1
- density=.5: event cadence; complexity=.5: motif/form detail; swing=0: groove offset
- composition: legacy migration only; any supplied style weight overrides it
- bpm: integer 30..180, default 72
- polyphony: 8, 16, 24 or 32 melodic voices, default 16
- melodyEnabled: boolean, default true; mutes pluck and bell voices
- drumsEnabled: boolean, default false; independent of melody and weather
- kick=.65, snare=.4, hihat=.3, toms=.35, cymbal=.2: normalized drum gains

The eighth-note grid has eight ticks per 4/4 bar and eight bars per phrase.
Seed selects tonic transposition, one of four diatonic progressions, eight motif
families, eight rhythmic masks, response phase and one of six arpeggio orders.
A/A/B/A/B/C/B/cadence phrase sections transform these materials. Phrase
rotation/inversion develops the upper motif; strong beats land on chord tones,
while weak beats may pass through scale tones. Register constraints and octave
adjustments limit upper melodic leaps and keep bass motion near its prior register.
These are explicit composition rules, not a claim of formal fugue or species
counterpoint correctness or a copy of any artist's composition.

Style contributions can be freely combined. Presets are ordinary snapshots of
these exposed controls; no preset name or hidden genre switch enters synthesis.
All four weights zero produces no musical note events (independent drums/weather
can still run). Density controls a deterministic event gate, complexity controls
motif families, inversion, form and fills, and swing alternates long/short eighths
by up to 0.22 beat while retaining complete beat duration.

1. Ambient weight: overlapping pads with sparse melodic accents. At evolution=0,
   three related harmonies each last one hour. Pad voicings refresh every four bars
   while harmony stays fixed. With other style weights present, their blend also determines
   harmonic cadence and pad articulation. Pure ambient evolution interpolates logarithmically from one-hour
   harmony spans to four-bar spans at 1. The base harmonies are [50,57,62,64],
   [53,57,60,64], [55,57,62,65], transposed by seed.
2. Counterpoint weight: continuous upper eighth notes, lower half-rate replies,
   bass support, and eight-bar development with phrase-end articulation.
3. Rhythmic weight: syncopated lead rests and recurrent bass pulses.
4. Arpeggio weight: rotating chord-tone order and octave displacement.

Instrument indices 0..4 are pad, pluck, bell, texture and bass pulse. Their layer
controls default to .65, .55, .35, .20, .15. Melody mute leaves pad, texture and bass
available. Layered detuned fundamentals, restrained upper partials, smooth attacks,
releases and per-voice low-pass filtering reduce sharp synthetic transients.
Intensity changes gain, brightness changes partials/filtering, motion changes drift,
and timbre changes pluck decay. Drum gain changes smooth over 50ms; structural
controls affect new grid events while mute fades current voices. These are not
calibrated safe-listening controls.

Instrument indices 5..9 are kick, snare, hi-hat, toms, cymbal. Separate twelve-voice
storage keeps drums outside the selected melodic limit. Kick uses a decaying pitch
sweep, snare uses tone/noise, hat uses a fast noisy transient, toms use pitched
resonance, and cymbal uses a longer noisy tail. Drum timing is bar-aware with
phrase-end tom fills and phrase-opening cymbals. All sound is synthesized.

Melodic storage is fixed at 32 voices; only the chosen 8/16/24/32-voice budget admits
new notes. Overflow is dropped rather than abruptly stealing an audible voice.
Reducing the cap releases out-of-range voices over at most 80ms; hence during this
transition the old cap can briefly remain active. Mute also uses an 80ms maximum
release. No growing event queue or external assets are used.

Weather remains independent procedural synthesis. RainType 0..3 and rain/thunder/
wind gains mix before the shared macro bus. The final combined mix passes a 12Hz
DC blocker and saturating limiter with peak strictly below .85. Delay memory is
fixed and proportional to sample rate. The JS score does bounded event-time work;
continuous oscillator, envelope, filtering and macro processing reuse voice state.
Equal seed, rate, controls and control timing reproduce output. Constant controls
are independent of render block size. Java/JS event scheduling is compared in tests;
PCM is not promised byte-identical across runtimes.

## Live seed switching

Call engine.reseed(seed), AndroidBridge.reseed(seed), or post
{type:'reseed',seed} to the worklet. The audio thread fades the complete output down
in 80ms, replaces the musical score and voices, and fades back in over 80ms. Latest
pending seed wins. The existing AudioTrack/worklet, parameter targets, play state
and Android session timer survive. Weather and macro state continue across the
switch. Reseeding while stopped remains silent; startup uses the new seed. This is
a bounded fade, not overlapping engines or an immediate full-volume reset.

## Verification

Run `./tests/run.sh`. This compiles and executes dependency-free JVM tests, using
javac or the installed JDK compiler module. Checks cover deterministic seeds,
chunk-size independence, buffer bounds, invalid parameters, initial silence,
start/stop/restart, parameter smoothing, finite PCM, DC and peak/RMS bounds.
The test renders ten minutes at 8 kHz and twenty seconds at 44.1, 48, 96 and 192 kHz.
These are numerical tests, not Android device battery/performance or listening QA.

## Web Audio integration

`docs/audio-engine.js` exports `AmbientEngine(sampleRate, seed = 1)`, with `start()`,
`stop()`, `isSilent()`, `setParameters({...})`, and `render(left, right)`. Render
accepts equal-length planar Float32Arrays and overwrites both channels. Target
parameters are frozen snapshots; omitted or nonfinite fields preserve their old
values. Controls include intensity, brightness, motion and timbre plus the layer,
evolution, weather and macro fields documented here. Java's three-argument Parameters constructor remains supported;
its four-argument constructor adds timbre with the same range.

Load `audio-worklet.js` through `context.audioWorklet.addModule()`, then construct
an AudioWorkletNode named `sou1-ambient` with numberOfInputs 0, numberOfOutputs 1,
outputChannelCount [2], and processorOptions {seed}. Connect it to the destination.
The UI must resume AudioContext from a user gesture. Port messages are:

- `{type: 'start'}`
- `{type: 'stop'}`
- `{type: 'reseed', seed}`
- `{type: 'parameters', parameters: {intensity, brightness, motion, timbre}}`

After stop has faded completely, the processor posts `{type: 'silent'}` once.
The processor stays alive so start can resume without rebuilding it. The UI may
suspend AudioContext after receiving silence. If the user already restarted,
ignore any stale silence message. Do not suspend immediately after stop, since
that would interrupt its fade. Parameter updates allocate one bounded snapshot
per message; score event-time work is bounded and voice DSP reuses state. Only a
silence transition posts a message.

Run `node tests/audio-engine.test.mjs` for JS numerical tests and a real-adapter
host-shim contract test. JVM and JS use the same low-32-bit seed, LCG, score and event scheduling.
Event traces match; floating-point PCM is not promised byte-identical across runtimes. Worklet host-shim tests do not substitute
for browser autoplay, mobile power, background playback, or listening checks.

## Original tone and space macros

Optional normalized controls: `warmth=0`, `strength=0`, `width=.5`, `wash=0`.
They are original DSP, inspired by descriptive macro names, not an exact emulation
of any processor. Defaults preserve the original signal. All four macros smooth
with a 50 ms time constant; existing synthesis controls retain their 1.5 s smoothing.
Java adds an eight-argument `Parameters(intensity,brightness,motion,timbre,warmth,
strength,width,wash)` constructor; existing three/four-argument calls stay valid.
Java nonfinite values use defaults; JS omitted/nonfinite values preserve previous
targets. Android intents and status snapshots carry the same named fields.

Warmth blends a 900 Hz low-pass with the dry signal and adds gentle symmetric
saturation. Strength adds compensated high-frequency presence and a restrained
odd soft nonlinearity. Width uses mid/side: 0 is mono, .5 is unchanged, 1 doubles
the side-to-mid ratio with output compensation. Wash mixes up to 50% of a single
shared four-line feedback-delay diffusion bus, with a passive 2600 Hz damping
filter and an orthogonal feedback matrix scaled to .72. Width acts after wash,
so its mono endpoint covers the complete scene. No samples or dependencies.

The delay bus continues updating at wash=0, avoiding cold-start tail discontinuity.
Stop still fades the whole result to exact silence in two seconds and pauses state.
Macro processing allocates only at construction. Numerical macro tests cover exact
neutral bypass, mono/wide endpoints, wet stereo impulse decay, finite long-running
output, peak bounds, and render-block independence. This is numerical verification,
not listening or Android-device performance certification.

## Event-score regression tests

Run `node tests/score.test.mjs` and the JVM suite. Score-only simulation covers
three hours without rendering millions of unnecessary PCM frames: harmony counts,
seeded event determinism, chunk-independent clocks, pitch/duration bounds, five
instrument streams and theoretical maximum polyphony including release tails.
PCM tests exercise developing mode with all layers and weather at maximum,
explicit note-offs, stop/freeze, restart, reset, and finite limited stereo output.
The extended Java Parameters constructor appends pad, pluck, bell, texture, pulse,
evolution, rainType (integer), rain, thunder, wind after the original eight fields.
Old constructors retain the new slow-mode defaults. Native bridge JSON uses these
same field names; private preferences restore controls and volume, never playback.

## Expanded composition tests

Run node tests/composition.test.mjs for the parameter-aware three-hour endpoint,
four distinct two-minute score traces, seed determinism/variation, diatonic pitches,
BPM-dependent density, melody mute, all five drum instruments, finite PCM, bounded
8+12 voices, exact accepted note gate frames, and live/stopped reseed. The legacy
numeric-evolution EventScore overload remains for older score inspection and its
existing Java/JS parity test; production engines use the Parameters/object overload.
Java retains the legacy constructor appending composition, bpm, polyphony, melodyEnabled,
drumsEnabled, kick, snare, hihat, toms, cymbal after the prior eighteen arguments.
The newest overload additionally appends ambient, counterpoint, rhythmic, arpeggio,
density, complexity, swing. New bridge snapshots persist all seven knobs.
Run node tests/composition-parity.test.mjs for 20 new-score cross-runtime traces.
Knob tests additionally cover zero weights, mixtures, density, complexity, swing,
and identical manual/preset knob values producing identical PCM.
No physical-device or critical listening qualification is implied by these tests.
