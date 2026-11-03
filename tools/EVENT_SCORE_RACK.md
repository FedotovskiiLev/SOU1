# Original EventScore → offline instrument rack

This branch connects the **existing SOU1 `EventScore`**, from the unmodified
`docs/audio-engine.js`, to the compact CC0 sample/oscillator rack. It replaces the
handwritten miniature's note generator for this new command. Existing rendering
commands, PWA, AudioWorklet, Android code and release files are unchanged.

## Run

```sh
node --test tests/event-score-rack.test.mjs
node tools/render-score-cue.mjs examples/cues/score-nocturne.json output/nocturne
node tools/render-score-cue.mjs examples/cues/score-pulse.json output/pulse
```

WAV/JSON outputs are created exclusively. A failed render or invalid score does
not create output files. An existing output is not overwritten. The previous
`render-sample-cue.mjs` remains a small instrument audition; `render-score-cue.mjs`
uses the real SOU1 composition engine.

## What is preserved

For every routed event, the adapter preserves the original integer start frame,
MIDI pitch, gate duration in frames and pan. It scales velocity only by the
requested layer gain. The accompanying JSON records:

- `sourceEvents`: every emitted original event with its numeric source instrument;
- `sourceEventCount`, `routedEvents`, `mutedEvents`, `fallbackEvents`;
- `routingAudit`: a disposition for each source event, its output event index,
  destination instrument and layer gain or explicit mute reason;
- `events`: the exact events submitted to the rack;
- sample/source hashes, output hash, accepted/dropped counts, peak/RMS.

Tests compare directly with `new EventScore(...).advanceTo(...)`, including
incremental advancement. Output audio is identical across tested render block
sizes. At 44.1 and 48 kHz, source times agree within one source sample; the sample
rate does not change the tempo. A new seed changes the original composition,
while the same options remain deterministic.

The source engine and its environment dependency are hash-pinned to commit
`70bf98168b1c854f8ce79676e02acc4bc44bac93` before importing them. The pinned hashes
are calculated from the actual repository bytes, not a normalized/formatted
copy. An engine source change fails explicitly and needs adapter review rather
than executing a different version under the old provenance label.

## What is intentionally different

This is a **new instrumental arrangement**, not a PCM reproduction of SOU1 live
playback:

- Pluck/bell events use the CC0 marimba bank in its supported MIDI60..91 range.
- Notes outside that range retain their exact pitch and use the explicitly
  counted `sine-fallback` backend. They are not folded to another octave.
- Pad, texture and bass/pulse use simple original sine backends. They do not
  reproduce the original SOU1 voice spectra or attack envelopes.
- Kick/snare/hi-hat use the CC0 recordings. The kick is an orchestral bass drum,
  not an electronic kit kick. Closed hat has two deterministic round robins.
- There are no tom/crash samples or replacement backends. When drums are enabled,
  nonzero `toms` or `cymbal` settings are rejected. Both supplied profiles
  explicitly set them to zero; any emitted source events remain visible as
  muted records in the audit.
- The original score's melody-enable semantics are preserved: it disables
  pluck/bell, not the long pads, texture and bass. Zero layer gain is explicit
  mute, not a failure to map a note.
- Percussion one-shots keep their natural sample tails rather than obeying the
  source gate. Explicit note-off/stop still releases them. This is an instrument
  playback choice, not a change to the recorded source gate.
- Original warmth, presence, stereo-width/reverb macros and environment sounds
  are not implemented by this renderer. Unsupported parameter keys are rejected,
  not silently ignored. The arrangements are dry.

## Boundaries and failure behavior

The renderer supports 4..120 seconds, 44.1/48 kHz and a uint32 seed. It uses the
original 30..180 BPM range, normalized composition controls, bounded 4,096-event
plans and a 48-voice rack. It rejects invalid options, unsupported non-muted
layers, event overflow, missing/corrupted assets, clipping, nonfinite output and
any unexpected lost/unmapped rack note. It does not normalize audio automatically.
Output gain is explicit. RMS dBFS is not LUFS or a listening-quality judgment.

Note generation stops at `duration - 2 seconds`. At that exact frame the rack
releases all remaining voices over 50 ms, so even long pad notes finish before
the file ends. About 1.95 seconds of silence then remain; this is a deliberate
transport tail pad, not a two-second musical fade. The JSON preserves the originally generated gate lengths; they may extend
past that explicit transport stop. This is not a lossless transcription of the
rendered endpoint. The final endpoint guard is 128 frames.

The source code is AGPL-3.0-only and the VCSL-derived recordings are CC0-1.0, as
documented in `CC0_SAMPLER.md`. No new software or desktop plugin was installed.
This qualifies the **offline Node route** only. There is no new PWA/Android
integration, browser/mobile real-time performance test, subjective listening
approval, GitHub CI pass or release claim.

## Next step

Listen to the two arrangements and decide which instrument mappings merit
keeping. A live implementation should make the sample bank optional and retain
the current oscillator default. Load/hash/decode must happen outside the audio
callback; the present queue/filter implementation is not represented as a
real-time-safe AudioWorklet. Preserve transport, seed changes and offline-cache
behavior during that later integration. No live-app files were changed here.
