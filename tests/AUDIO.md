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
silence pauses musical time; restarting continues the same scene. Create a new
instance to restart from the seed. `isSilent()` must be read on the rendering thread.

UI threads may call start/stop and publish `new AmbientEngine.Parameters(intensity,
brightness, motion, timbre)` through `setParameters`. Controls are finite, clamped 0..1;
NaN/infinity use neutral defaults. A parameter snapshot is read once per render
block, and values smooth over a 1.5-second time constant. Call `getParameters()` to
read the latest target, not instantaneous smoothed values. Control setters do not
allocate on the rendering thread. Do not render one engine concurrently.

## Sound and resource budget

Six softly overlapping pad voices draw from a consonant pentatonic pitch set,
using phase-continuous sine oscillators with quiet second/third harmonics. Raised-
cosine envelopes allow pitch changes only at silent boundaries. Up to three
sparse, enveloped high notes enter over the pad; motion changes slow envelope and
note timing plus subtle drift. Stereo panning and damped cross-feedback delays add
space. Delay feedback is less than unity, a 12 Hz DC blocker removes offset, and
a smooth saturating output function provides a strict peak bound below 0.85.
Intensity is a musical texture/loudness control, not a calibrated safe listening
level: users should keep device/headphone volume comfortable.

The oscillator lookup table is shared and immutable (about 32 KiB); each instance
has fixed delay memory proportional to sample rate (about 274 KiB at 48 kHz,
1.1 MiB at 192 kHz), nine voices, and no per-frame allocations. No growing history,
queues, random-device access, or blocking operations occur during rendering.

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
values. Controls are intensity, brightness, motion and timbre (all 0..1). Timbre
moves from dark (0), through warm (.5), to airy (1), by smoothly changing the
harmonic mix. Java's three-argument Parameters constructor remains supported;
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
host-shim contract test. JVM and JS have the same sound architecture but use
different seeded generators, so a seed is repeatable within each implementation,
not byte-identical across Java and JS. Worklet host-shim tests do not substitute
for browser autoplay, mobile power, background playback, or listening checks.
