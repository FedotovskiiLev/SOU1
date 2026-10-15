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

## Sound and resource budget

The sample-clock score emits pitched note-on events with instrument, velocity,
finite duration (sample-exact note-off), and pan. Five original additive synths
use distinct spectra and envelopes: sustained pad, decaying pluck, inharmonic bell,
slow detuned texture, and short round pulse. Thirty-two preallocated voices bound
polyphony; excess notes are dropped rather than stealing an audible voice.
Independent melody, pad, texture and harmony clocks keep beds overlapping while
motifs include deliberate rests. Stable related voicings are [50,57,62,64],
[53,57,60,64], and [55,57,62,65]. Pad fundamentals stay above MIDI 49.

Normalized layer defaults are pad=.65, pluck=.55, bell=.35, texture=.20, pulse=.15.
Evolution defaults to 0: exactly three harmony choices, one per hour in a three-
hour session. Evolution 1 develops harmony approximately every 24 seconds with
shorter melodic phrases. Intermediate values continuously change these times.
Melody entrance after three seconds makes the score audible during startup.
Intensity changes musical gain, brightness changes pad partial balance, motion
changes oscillator drift, and timbre changes pluck decay. These are synthesis
controls, not calibrated safe-listening levels.

Weather is original procedural synthesis, mixed before the shared macro bus.
RainType=0 (off), 1 (light), 2 (steady), or 3 (heavy); rain, thunder and wind are
independent normalized gains, initially zero. The final combined mix passes a
12 Hz DC blocker and saturating limiter with peak strictly below .85.
The oscillator lookup table is shared and immutable (about 32 KiB); delay memory
is fixed, proportional to sample rate. Rendering allocates no objects and has no
growing queues, history, external assets, network access, or blocking operations.

Equal seed, sample rate and controls reproduce output. Constant controls are also
independent of render block size. A control change is applied at the next block,
so control timing differences intentionally change output.

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
- `{type: 'parameters', parameters: {intensity, brightness, motion, timbre}}`

After stop has faded completely, the processor posts `{type: 'silent'}` once.
The processor stays alive so start can resume without rebuilding it. The UI may
suspend AudioContext after receiving silence. If the user already restarted,
ignore any stale silence message. Do not suspend immediately after stop, since
that would interrupt its fade. Parameter updates allocate one bounded snapshot
per message; rendering allocates nothing per sample or block. Only a silence
transition posts a message.

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
