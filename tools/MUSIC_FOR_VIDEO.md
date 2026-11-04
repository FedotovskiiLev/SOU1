# One local path from SOU1 to an editor-ready WAV

This is an offline development tool in this branch, not a shipped PWA/Android
feature. Use the repository checkout containing these files and an existing
Node installation (tested with Node 24.22.1). No npm install, plugin host, login,
network request or microphone access is needed to render.

## Render

From the repository root:

```sh
node tools/music-for-video.mjs profiles
node tools/music-for-video.mjs render --config examples/cues/video-pulse.json --out output/teaser
```

Or select the common controls directly:

```sh
node tools/music-for-video.mjs render --engine cc0 --profile nocturne --seed 20261103 --seconds 30 --rate 48000 --gain-db 12 --out output/quiet
node tools/music-for-video.mjs render --engine synth --profile documentary --seed 20261103 --seconds 30 --rate 48000 --gain-db 12 --out output/documentary
```

`--out` is a file base, without `.wav` or `.json`. Its parent directory is created
after a successful render. Quote paths containing spaces. An absolute script
path also works from another directory; config and output paths are resolved
from that working directory, while engine/bank paths stay relative to the tool.

Each command saves two files:

- `BASE.wav`: signed PCM24 little-endian, stereo, at the requested sample rate.
  48 kHz is the default for both backends. Import this ordinary WAV into your
  video editor, place it under the video and adjust its mix there.
- `BASE.json`: a complete normalized recipe, source/renderer/bank fingerprints,
  WAV SHA256, events, routing/voice counts, actual frame count, peak/RMS and limits.

Stdout is one JSON summary with both paths, the WAV hash, exact duration and
format. Errors go to stderr with a nonzero exit code. There is no automatic
upload, video muxing, MP3 conversion or loudness normalization.

For another local Node tool, `renderRecipe(recipe)` is also exported from
`tools/music-for-video.mjs`. It returns `{wav, report, events}` without writing
files; `wav` is a Node Buffer containing the complete WAV. Call `saveCue` from
`tools/render-cue.mjs` only when you want the exclusive WAV/JSON pair. This is a
Node API, not a browser package or a promise of real-time performance.

## Pick a backend deliberately

- `cc0`: the real SOU1 EventScore routed through the CC0 sample/sine rack.
  Profiles: `nocturne`, `pulse`. Duration 4..120 seconds, 44.1/48 kHz. Marimba
  replaces pluck/bell; pads/bass/texture use simple sine backends. Percussion
  includes stick toms and a **short clash**, not a complete crash/ride kit.
  Original DSP effects/weather are not reproduced. Extended composition/layer
  controls go in a config's `options.parameters`.
- `synth`: the original pinned SOU1 oscillator DSP, with no sample bank.
  Profiles: `documentary`, `nocturne`, `pulse`. Duration 4..300 seconds. Supported
  rates: 8000, 16000, 22050, 24000, 44100, 48000 and 96000 Hz. Prefer 48000 for
  video work. Its profiles are different from same-named CC0 arrangements.

For prepared electronic kick/snare/hats, select `--drum-kit fsa-electronic`
with `cc0`. The default `vcsl` bank remains available. Open-hat/clap and
a common-note A/B are described in [ELECTRONIC_DRUMS.md](ELECTRONIC_DRUMS.md).

The CLI defaults to `cc0`; `help` and `profiles` show choices. The backend
validators supply the remaining defaults, which are written explicitly into
the receipt. Seeds are unsigned 32-bit integers. Gain is explicit, -60..24 dB.
Unknown or duplicate flags, unsupported parameters and mixed config/recipe flags
are rejected. There is no silent fallback to another engine or instrument pack.

## Repeat an exact result

```sh
node tools/music-for-video.mjs replay output/teaser.json --out output/teaser-repeat
```

Replay checks the expected renderer files and bank manifest, then renders the
stored normalized recipe. It compares the WAV SHA256 **before saving anything**.
A success means the new WAV is byte-identical to the receipt's expected hash;
the output summary and new receipt say `replayVerified: true`. It does not mean
the surrounding JSON receipts are identical: replay status/runtime may differ.

Keep the matching source checkout with the recipe. Renderer, profile, original
DSP or bank changes fail the fingerprint check. The receipt records Node version,
OS and architecture for diagnosis; a different runtime is allowed to try, but
must still produce the same WAV hash. Byte identity across every platform/Node
version is not promised. Use `render` for a new arrangement after changing code,
not `replay` with recipe overrides. A hash is reproducibility evidence, not a
signature proving authorship or copyright ownership.

Both original DSP source files are verified before execution, including the
older `render-cue.mjs` command. The CC0 loader also verifies each sample against
the pinned manifest. It does not download anything during a render.

## Editing and failure boundaries

- Requested duration includes the final two seconds of transport tail. The
  rack explicitly releases voices over 50 ms, then leaves approximately 1.95 s
  of silence. The synth uses its own DSP stop/reverb decay. Neither creates an
  automatic musical cadence, seamless loop or video-aware edit. Generated note
  gates can extend past the explicit stop; the receipt preserves them honestly.
- Frame count is rounded to the nearest sample. `actualDuration` records the
  exact file duration. The WAV header and data length are checked in CLI tests.
- Clipping/nonfinite output and unexpected CC0 dropped/unmapped notes fail.
  Lower the explicit gain if clipping is reported. RMS dBFS is not LUFS,
  mastering certification or a listening-quality judgment. Listen quietly.
- Existing WAV or JSON paths are not overwritten. Two simultaneous commands
  aimed at the same base cannot both succeed. Use a different base to keep a
  variant. Ordinary write failures attempt cleanup of only newly reserved files.
- The pair is **not crash-atomic**. Killing the process or losing power while
  writing can leave partial files. Verify the WAV hash against a complete JSON
  receipt; do not mistake an interrupted file for a finished render.
- Replay does not use output paths stored in a receipt. You supply a new `--out`.
  Configs are bounded to 64 KiB and replay receipts to 8 MiB.

## Licensing and qualification

Code is AGPL-3.0-only. VCSL sample derivatives are separately CC0-1.0; see
[`CC0_SAMPLER.md`](CC0_SAMPLER.md) and the retained source LICENSE/README.
The code license does not automatically relabel the samples or generated music.
No external commercial synth, copyrighted song recording or private Zeitgeist
source is included. Third-party assets added later need their own provenance
check; a self-declared CC0 field alone is not sufficient.

This path is tested through real Node CLI subprocesses, WAV parsing, independent
source/asset hashes and byte-identical replays. No browser/device playback,
subjective listening approval, GitHub CI pass, production update or release is
implied. See [`EVENT_SCORE_RACK.md`](EVENT_SCORE_RACK.md) for the detailed arrangement.

```sh
node --test tests/video-music.test.mjs
```
