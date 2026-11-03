# SOU1 offline cues: proposal and prototype

Research date: 2026-11-03. Baseline: SOU1 0.2.0, commit `70bf98168b1c854f8ce79676e02acc4bc44bac93`.

## Implemented in this branch

`render-cue.mjs` uses the existing unmodified JavaScript DSP to make a fixed-length 24-bit stereo WAV at a deterministic seed. Three small original profiles support documentary underscoring, sparse nocturnes and a rhythmic pulse. JSON records the exact parameters, generated note events, source commit, signal statistics and WAV checksum. It has no npm dependencies, network access, plugin installation, sample download or live UI change.

Run from the repository root with Node.js:

```
node tools/render-cue.mjs examples/cues/documentary.json output/documentary
node tools/render-cue.mjs examples/cues/pulse.json output/pulse
node --test tests/render-cue.test.mjs
```

Choose a new output basename for each render. Existing output files are never overwritten. Duration includes the final two-second stop fade. The final 128 samples also taper to zero. Output gain is explicit, bounded, and a clipping result aborts rather than silently limiting the file.

This is an offline prototype, not an update to the published PWA or Android app. It does not integrate any external synthesizer, sampler or sample pack. Signal checks do not establish subjective musical quality. No physical-device or current browser audio check has been performed for this change.

The captured event JSON is not a MIDI transcription of rendered audio: scheduled note gates can extend beyond the final fade; DSP effects and voice releases are absent from it. Existing MIDI export still has its original 512-note limit. Do not call separately rendered layer previews additive stems: nonlinear master processing and shared reverb prevent exact reconstruction by simple summation.

## Recommended update order

1. Keep the existing seed, score and transport as the composition authority. Use fixed-duration cues, explicit sections and a reproducible edit/render manifest for video work. Retain the current sample-free mode and offline Android privacy.
2. Add a small sampler behind a common instrument interface, not a desktop VST host in the browser. Begin with a compact CC0 kit: kick, snare, closed/open hats, toms, shaker, one mallet and one sustained instrument. Target a bounded optional package, not multi-gigabyte downloads. Validate real decoded-memory use, velocity layers, note-off/hat choke, voice limits, resampling and missing-file behavior before choosing a delivery size.
3. Separate the arranger from instrument rendering so the same note events can drive built-in oscillators, a selected WAV bank, or an offline external host. Keep browser/Android implementations aligned through shared fixtures rather than assuming PCM identity.
4. Render original banks and cues with Surge XT externally when the host workflow is qualified. A full C++/WASM/native port is a separate engineering project. Add automation envelopes, section transitions and true pre-master stems only after explicit routing is implemented.

## Candidate instruments and rights

Code licenses, sample/preset licenses, and rendered-music permissions are different questions. A free download or royalty-free music license does not by itself permit redistributing its raw samples inside an app. The entries below are research candidates, not vendored dependencies.

- **VCSL**: official library is CC0 and explicitly permits commercial software, modification and redistribution. Strong general-purpose source. Typical instruments occupy 20–75 MB raw, so curate. https://github.com/sgossner/VCSL
- **VSCO 2 Community Edition**: CC0 sample source, including curated 50-sample and 256-sample subsets. Do not extend that permission to the paid Standard/Professional editions. https://versilian-studios.com/vsco-community/ and https://github.com/sgossner/VSCO-2-CE/blob/master/LICENSE
- **Virtuosity Drums**: publisher identifies the acoustic kit as CC0. Full product is about 1.1 GB, so select a smaller WAV map. The supplied Sforzando mapping and player are not automatically a portable SOU1 implementation, and CC0 samples do not license the proprietary player. https://versilian-studios.com/virtuosity-drums/
- **Surge XT**: GPLv3-or-later code. Official FAQ explicitly permits commercial use of rendered music/sounds/video, including sounds made with factory presets. Use as an external authoring tool first. Do not relabel all original preset/wavetable files as CC0. https://surge-synthesizer.github.io/faq/ and https://github.com/surge-synthesizer/surge/issues/6741
- **Dexed**: GPLv3-family plugin; its underlying msfa engine is Apache-2.0. A narrower FM engine could be evaluated separately from the full plugin. Arbitrary DX7 SysEx banks still need provenance; prefer original patches. The original Google Android engine repository is archived. https://github.com/asb2m10/dexed and https://github.com/google/music-synthesizer-for-android
- **Hydrogen**: GPLv2-or-later desktop drum sequencer, useful for authoring/reference. Drumkits have separate licenses, potentially down to individual samples. Do not bundle all its kits under the application license. https://github.com/hydrogen-music/hydrogen and https://hydrogen-music.org/documentation/manual/manual_en.html#chapter.licensing
- **sfizz**: BSD-2-Clause core sampler with separate dependencies/notices. Its official repository is currently archived. The MIT WebAudio prototype describes embedded/all-in-memory samples and disabled background loading, so it is not turnkey mobile streaming. https://github.com/sfztools/sfizz and https://github.com/sfztools/sfizz-webaudio

SOU1 remains AGPL-3.0-only. GPLv3/AGPLv3 combination provisions exist, but the exact dependency version and redistribution model still need review. Merely rendering music with a copyleft tool does not automatically put the composition under its code license. See https://www.gnu.org/licenses/gpl-faq.en.html#AGPLGPL . This research is not a substitute for a release-specific compliance audit.

## Asset admission contract

Before adding any external file, record: exact source URL, retrieved version/commit, checksum, author, asset-specific license, attribution/notice text, allowed redistribution, transformation performed, original and decoded size, and mapping. Store a copy of the applicable license beside the pack. Reject unknown, noncommercial-only or non-redistributable packs from the default redistributable library. A license for the code never fills a missing sample license.

No external binaries, samples, presets or wavetables were downloaded or installed in this prototype. No release, main merge, public deployment, account, credential or paid resource is part of this change.
