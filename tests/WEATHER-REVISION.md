# Weather synthesis revision

This revision is original sample-free DSP. Public methods, parameter names,
independent controls, initial silence, deterministic reset and the bounded .45
weather output remain unchanged. No layer is enabled automatically.

## Changes

- Rain: 24 preallocated impact voices, damped 650–2950 Hz resonances, a 1.5 ms
  excitation rise and 18 ms decay, random stereo placement, fine filtered patter
  and a deeper wash. Nominal light / steady / heavy impact density is 16 / 85 /
  240 per second. Crossfaded controls change both density and bed weight.
- Thunder: a softened 320 ms crack, low rumble and seven delayed overlapping
  1.4–3.2 second lobes over an eight-second event. Delays and gains vary by seed;
  later lobes diminish. A separate random stream and clock preserve independence.
- Wind: a stronger low/mid filtered noise layer and a quieter broad air layer,
  shaped by slow gusts. No pure-tone oscillator or repetitive howl.
- Filtered-noise rate compensation and sample-rate-derived drop damping keep the
  overall balance reasonably stable across supported rates.

Rendering uses fixed arrays and bounded loops, with no rendering allocations,
external assets or dependencies. The fixed pool replaces the oldest rain voice
when full; its short decaying tail is normally negligible by then. The existing
soft limiter preserves output headroom, but this is not a calibrated hearing-
safety guarantee. Increased thunder/wind output intentionally invalidates the
old thunder-specific .30 peak expectation; the public .45 bound is unchanged.

## Verification

Run:

    sh tests/run-environment.sh
    node tests/weather-parity.mjs
    node tests/weather-preview.mjs /tmp/sou1-weather-previews

Focused JVM and JS tests cover finite values, headroom, seeded reset, block
independence, independent thunder, distinct rain modes, stop/start smoothing,
zero endpoints and 8 / 44.1 / 48 / 96 / 192 kHz operation. JS includes a ten-minute
8 kHz stress simulation. The cross-language test compares stereo samples every
97 frames over five seconds per rate, including active thunder and a stop.
Observed maximum error: 1.81e-15. Across-rate combined RMS: .0585–.0812.

The preview script writes PCM16 stereo at 48 kHz, seed 7, with a three-second
stop tail, plus a manifest containing exact parameters, duration and metrics.
It does not normalize levels. Isolated thunder peak .412; wind .267; heavy rain
.169. Combined storm peak .390. No preview exceeded the .45 engine bound.

Listening assessment remains required: the checks establish DSP properties,
not perceptual realism. Android device performance and physical speaker/headphone
playback were not measured here. No UI or main-music-engine files were changed.
