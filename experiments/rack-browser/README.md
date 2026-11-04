# SOU1 isolated composition and sample-rack lab

A local-only experiment beside the production app, outside `docs/`. It now
uses the same pure expressive composer and MIDI exporter as the Node tools,
with recorded electronic/acoustic percussion. The original EventScore path is
still available. A worker prepares a finite stereo buffer; a separate **Play**
click starts it through Web Audio.

This is not a live AudioWorklet, Android integration, Surge/SFZ host, deployment
or release. Pitched voices remain VCSL marimba plus sine pad/bass/texture. The
production app's effects and weather are not reproduced here.

## Open locally

Serve the repository root, not `docs/` or just this folder:

```sh
python3 -m http.server 8787 --bind 127.0.0.1
```

Open `http://127.0.0.1:8787/experiments/rack-browser/` in a browser supporting
module workers, Web Crypto and Web Audio. Direct `file://` loading is not
supported. No browser security flags, disabled sandbox or new permissions are
required or recommended. Stop the preview server when finished.

- **Original EventScore:** retain Nocturne/Pulse, seed and 4..30 seconds.
- **Expressive full score:** choose six forms, five phrasing treatments, bars,
  BPM, seed and percussion enablement. Try 4 bars at 112 BPM initially.
- **Drum samples:** VCSL, the compact FSA electronic bank, five full FSA kits,
  or two Guigui acoustic presets. Instrument-by-instrument provenance appears
  in the diagnostics; missing selected-kit instruments retain VCSL explicitly.
- **Drum velocity scale:** 0.25..2, default 1, for expressive scores only. Try
  1.6 with Guigui dynamic to let some accents cross its soft/hard boundary 0.6.
  Quiet recipes can legitimately produce the same PCM with soft and dynamic.
  These layers are not calibrated dynamics or round robin.
- **Render gain:** starts at +4 dB. If a peak is rejected, lower this gain.
  Listening volume starts at 35%; start quietly.
- **Save full MIDI:** enabled after an expressive score is prepared. It exports
  the same canonical score with real tempo, meter and sections. MIDI contains
  no recordings and does not load the chosen kit in an external DAW. The old
  EventScore path does not claim this new complete-score MIDI export.

All arrangements fit within **30 seconds including a 2-second release tail**.
An overlong request is rejected before loading source code or samples. Controls
are not silently clamped to a different musical arrangement.

## Lifecycle

Prepare never starts audio. Play creates its AudioContext from the explicit
click and creates a new one-shot source each time. Stop/cancel terminates a
preparing worker or fades/stops current playback. A new preparation clears old
PCM and MIDI. Stale/cancelled worker messages cannot restore them. A normal
interruption requires another explicit Play click. Switching tabs stops audio;
leaving the page disposes the controller. BFCache restoration creates a fresh
idle controller without autoplay.

MIDI transfer is copied on acceptance. Format-1/960-PPQ header, track counts,
complete bounded track chunks, EOT endings and no trailing data are checked.
This boundary check is not a general-purpose MIDI parser. Downloads happen only
on the MIDI button click, never on preparation or playback.

## Shared implementation and bounds

`prepare.mjs` imports the existing canonical modules directly:

- `tools/composition/variety-score.mjs`
- `tools/composition/expressive-score.mjs`
- `tools/composition/score-midi.mjs`

There is no second browser copy of the composition algorithm. `composer: 'expressive'` uses the same recipe as `renderExpressiveCue`; `composer: 'legacy'`
(or old plain options without that field) retains the pinned EventScore loader.
The original source loader executes exactly the checked bytes as temporary
Blob modules, not a second unverified fetch.

Only the closed kit registry selects bank URLs. The browser loader verifies
sample SHA-256, source metadata, filenames, PCM shape and memory budgets. Entire
encoded/decoded declared totals are checked **before the first WAV fetch**;
each subsequent bank receives the remaining combined budget. No code is
executed from manifests.

- Combined encoded samples: at most 12 MiB.
- Combined decoded and mapped samples: at most 16 MiB each, with the existing
  8 MiB per-bank decoded/mapped limits.
- At most 28 sampled instruments, reserving room for four sine voices in the
  rack's 32-instrument registry.
- PCM: at most 30 seconds of stereo Float32 at 44.1 or 48 kHz. A 30-second
  48 kHz pair alone is 11.52 MB. AudioBuffer copies, sample copies, browser
  objects and overhead are additional. Reported sample counters are not a
  measurement of total or peak browser memory.
- Full MIDI bytes: at most 2 MiB on the worker/controller boundary.

Rendering remains outside the audio callback. The rack uses allocation-heavy
operations and is not presented as realtime-safe. Browser/device resampling
may change actual output even where the prepared PCM matches the Node renderer.
Source quality caveats for Guigui hard hits remain documented in
[`ACOUSTIC_DRUMS.md`](../../tools/ACOUSTIC_DRUMS.md).

## Verification on 2026-11-04

```sh
node --test tests/browser-rack.test.mjs tests/browser-composition.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
```

Executed in Node: real loopback HTTP and streaming/hash checks, all nine bank
selectors, six forms, five phrasings at both sample rates, PCM comparison with
Node within PCM24/Float32 rounding, exact canonical MIDI bytes, legacy rendering,
strict pre-fetch budgets, corrupt samples, cancellation/stale results and
mock-DOM control/download wiring. Independent review reproduced the budget
failure, then confirmed its fix and the MIDI boundary checks.

**Actual browser qualification remains open.** The available cloud browser
could not reach the preview URL (`ERR_CONNECTION_REFUSED`). The server session
was also unreachable from a separate execution session; a standard local-only
preview-host launch outside that isolation failed during environment startup
with a read-only filesystem error. No access controls or browser security
settings were changed. The unused server session was stopped. HTTP tests within
one execution process do not demonstrate that a browser loaded or played this
page. No actual screenshot, listening or device-output result is claimed.

Required before production integration:

1. Load normally on localhost/HTTPS; verify modules, CSP and actual Worker.
2. Prepare legacy and expressive arrangements with electronic/acoustic kits.
3. Play, stop, replay, restart/cancel during preparation and delayed resume.
4. Download MIDI, inspect its notes and import it into a real DAW.
5. Switch tabs, interrupt audio, navigate away/back including BFCache.
6. Check desktop/phone layout, keyboard operation and accessible status.
7. Check missing/corrupt assets, real memory/render time and target devices.
8. Separately qualify a realtime PWA path and native Android background audio.

Production oscillator defaults, Android sources, service-worker cache,
workflows, signing and releases are unchanged by this experiment. Code remains
AGPL-3.0-only; recorded banks retain their separate CC0 provenance.

## Continuing composition experiment (2026-11-04)

Open `session.html` from the same localhost/HTTPS server. This separate opt-in page
keeps SOU1's continuing background-music direction: new phrases are prepared while
previous phrases play. It does not replace the production app or the finite rack
page, and it is not an AudioWorklet or an Android background-audio implementation.

- Prepare loads and verifies the selected recorded bank once in a dedicated worker,
  then prepares two phrases. Start requires another explicit click. The main thread
  only schedules prepared AudioBuffers; composition and DSP stay in the worker.
- The first phrase has the requested seed. Later seeds are a deterministic function
  of that seed and phrase index. Style, meter, key, tempo, bank and expression stay
  fixed until another Prepare. All notes still come from the unchanged canonical
  expressive composer; this transport does not rewrite them.
- Each phrase is a complete finite composition with its own cadence, not a claim of
  long-form musical development across boundaries. Two-second release tails overlap
  the next phrase. Starts use absolute beat time, rather than accumulating rounded
  sample lengths. At 44.1/48 kHz, a phrase's final active frame can differ from the
  ideal boundary by at most half a sample.
- The scheduling horizon holds one current and one future phrase, with at most an
  older release tail and one ready phrase. One additional worker render may be in
  flight. Every PCM buffer is bounded by 30 seconds, events by the composer, and
  sample-bank budgets remain enforced. No unbounded session PCM or MIDI history is
  stored. A one-million-phrase safety limit is checked, not silently wrapped.
- The shortest permitted phrase is two seconds. At most two phrase buffers overlap;
  a constant 0.45 master headroom factor precedes listening volume. There is no
  limiter, normalization, crossfade of note attacks or claim about hardware levels.
- If preparation, main-thread allocation or timer delivery misses the next start,
  the session fades/stops with an actionable error. It never skips ahead or starts
  a late phrase immediately. This is a safety behavior, not proof of glitch-free
  real-time operation on a device. Starting requires at least 25 ms of lead after
  buffer allocation; the initial target is 100 ms after the explicit Start click.
- Stop cancels the worker, ready buffers, future sources and timer. Hidden pages stop;
  a suspended audio context stops with an explanation. Back/forward restoration
  starts empty. New settings/reseed require Prepare; no old response can restore
  cancelled playback.
- Save latest phrase MIDI exports the latest prepared/scheduled phrase only. It may
  be ahead of the currently audible phrase. It is not the whole session, and it does
  not embed audio samples or two-second instrument release tails.

Validation: Node mock-Web-Audio lifecycle tests, 180 sequential phrase schedules,
real Node worker threads over loopback HTTP with a single bank load, exact
Float32/MIDI parity against four canonical phrases, invalid response checks,
fractional-BPM and delayed-copy regressions, and mock-DOM interaction. These do not
qualify actual browser Worker/CSP/AudioContext behavior, perceptual transitions,
background performance, REAPER or Android. The prior real-browser preview remains
blocked by the available local hosting environment; no browser security workaround
was attempted. No production files, pinned composer sources, sample data or app
release were changed.
