# SOU1 isolated browser rack lab

A local-only prototype beside the production app, not inside `docs/`. It uses
the real SOU1 EventScore and the CC0 rack to prepare a short stereo buffer in a
module worker. A separate **Play** click starts that buffer through Web Audio.
There is no live AudioWorklet, microphone, account, analytics, upload, service
worker registration or production deployment.

## Open locally

From the repository root, with an existing Python installation:

```sh
python3 -m http.server 8787 --bind 127.0.0.1
```

Open `http://127.0.0.1:8787/experiments/rack-browser/` in a browser supporting
module workers, Web Crypto and Web Audio. Serve the **repository root**, not
`docs/` or just the experiment folder. Direct `file://` loading is unsupported.
No browser security flags or disabled sandbox are required or recommended.
Stop the local server when finished.

Choose an arrangement, uint32 seed and 4..30 seconds. **Prepare sound** loads
only local same-origin files, checks hashes and renders in the worker; it never
autoplays. **Stop / cancel** interrupts preparation or playback. **Play from
start** always creates a new one-shot AudioBufferSourceNode. Output listening
volume starts at 35%; start quietly. Switching tabs stops playback. Leaving the
page terminates preparation and closes the audio context. Returning through
BFCache creates a fresh idle controller without automatic playback.

## Implementation and limits

- `event-score-core.mjs` now holds shared pure routing; Node and worker use the
  same implementation. The Node loader still verifies the original DSP files.
- Browser `score-source.mjs` checks both pinned files and imports **the verified
  contents** as temporary Blob modules. It replaces the one environment import
  with the verified environment Blob URL and revokes both after import. It does
  not verify one response and then execute a second fetch of the source URL.
- The isolated document allows same-origin code plus Blob modules for that
  verified-source flow. It does not allow `unsafe-eval` or external scripts.
  Production CSP, app code and hosting are not changed.
- The browser bank loader bounds streamed responses, validates source metadata,
  sample SHA256, PCM shape, local filenames and decoded/mapped memory budgets.
  It never imports code from the sample manifest.
- The worker returns transferred Float32 channels. Main-thread playback copies
  them into an AudioBuffer. A 30-second stereo 48 kHz buffer is 11.52 MB; copies, sample
  data, engine objects and browser overhead add more. This is not a total-memory
  measurement or low-memory-mobile qualification.
- Rack synthesis happens before playback, not on an audio callback. The current
  implementation is not presented as real-time-safe. Cancelling terminates the
  worker and discards stale results.
- PCM matches the Node reference within PCM24/Float32 rounding in the tested
  scenario. A device/browser may resample the prepared 48 kHz buffer to its hardware
  sample rate; device output is not asserted bit-identical.
- Musical caveats remain: simple sine pad/bass/texture replacements, marimba
  fallback outside its range, no tom/crash backends, no original effects/weather,
  and a 50-ms release followed by approximately 1.95 seconds of ending silence.

## Verification on 2026-11-03

Run:

```sh
node --test tests/browser-rack.test.mjs
node --test tests/event-score-rack.test.mjs tests/sample-instruments.test.mjs tests/render-cue.test.mjs
node tests/audio-engine.test.mjs
node tests/midi-export.test.mjs
```

**What was executed:** Node tests with fake Worker/AudioContext/DOM lifecycle
objects, and a real loopback HTTP server with real fetch/streams/hash checks,
asset loading, source/rack rendering and comparison against Node WAV output.
Cases include cancellation and restart, repeated Play, delayed resume, suspended
context cleanup, stale worker messages, source checksum failures, response-size
limits, visibility, unload and BFCache restoration.

**What was NOT executed:** actual browser DOM rendering, CSP/Blob-module behavior,
real browser Worker messaging, Web Audio playback/device output, visual layout,
mobile/background behavior or subjective listening. Chromium startup was
attempted normally, then with its profile in the permitted workspace. It failed
with `socket() failed: Operation not permitted` before loading the page. The
initial default-profile attempt also could not create its profile directory.
No sandbox/security override or alternate route around that restriction was
used. Local HTTP availability does not mean the browser ran successfully.

## Required real-browser acceptance before app integration

1. Load this page normally on localhost/HTTPS; verify no CSP/module errors.
2. Prepare both profiles; listen quietly; inspect diagnostics for no lost notes.
3. Play, stop, replay and rapidly repeat clicks; check there is only one source.
4. Cancel/restart preparation and stop while audio resume is pending.
5. Switch tabs, suspend/resume audio, navigate away/back, including BFCache.
6. Check desktop and phone widths, keyboard navigation and screen-reader status.
7. Check corrupted/missing sample errors and verify there is no partial bank.
8. Check real render duration/memory and output on target browsers/devices.

These remain open browser checks, not implied passes. Keep the production
oscillator default until this experiment is qualified. Samples remain CC0;
source code remains AGPL-3.0-only. No release or deployment was made.

Primary API references:
- [AudioBufferSourceNode lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)
- [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)
- [Worker.terminate](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate)
