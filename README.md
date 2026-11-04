# SOU1

An original ambient instrument for focus, study and quiet work. ASCII interface, an audio-reactive play button, composition layers, timbral controls, effects and independent procedural environment sounds.

- **PWA:** dependency-free Web Audio / AudioWorklet, local preferences and offline cache after first load.
- **Android:** the same bundled interface with native AudioTrack synthesis in a foreground media service. Android8+; no Internet, microphone or storage permissions.
- **Sound:** the original oscillator engine remains the default. The 0.3 candidate adds optional bundled CC0 melodic palettes and recorded drum kits to the PWA and native Android service, plus a separate continuously developing score. Original synthesis, effects, weather and saved scenarios remain available. APK/device acceptance is pending. No streamed audio. Start quietly.
- **Privacy:** no accounts, analytics, recording or uploads.

## Controls

- Exposed phrase controls blend long-form sustained ambient, simplified tonal counterpoint, rhythmic sequences and evolving arpeggios. Density, variation, swing and harmonic development are independently adjustable. “Eno-inspired” and “Bach-inspired” are original generative presets, not recordings, copied compositions or claims of recreating those artists.
- Tempo: 30–180 BPM. Melodic polyphony: 8, 16, 24 or 32 voices; a separate bounded drum pool handles percussion.
- Melody voices and drums have independent enable switches. Pads, plucks, bells, texture and bass/pulse have independent levels. Drum controls cover kick, snare, hi-hat, toms and cymbal.
- “New melody” changes the seed during playback without resetting the session timer. Music changes through a short fade; weather remains independently controlled.
- The slow pad endpoint retains three harmonies over three hours. Development raises the pace of harmonic changes. Other phrase settings use progression, motif and rhythmic development. Notes are internal MIDI-like events with a Standard MIDI File export of the retained history; external MIDI device output is not implemented.
- Effects: original warmth, presence, stereo width and diffuse reverb. The four-macro reference is [TOSKA by Noon Instruments](https://www.nooninstruments.com/toska); this is not its engine or sample library.
- Environment: light/steady/heavy rain with discrete impacts, independent multi-roll thunder and gusting wind. All sample-free; realism and listening quality require subjective evaluation.
- EN/RU, output level and timer. The mobile layout separates Composition, Voices, Effects and Environment. Native Android hides APK/PWA-install links; the website retains them.
- ASCII and the play-button outline react to actual output. Reduced-motion preference suppresses deformation.

Presets are complete snapshots of exposed musical, effect and weather controls. They do not select hidden artist modes; master output, seed and session timer remain independent.

## Development status

Early preview. DSP numerical/JVM/Node tests exist; a generated APK is not a claim of physical-device, listening or background-playback qualification. Browser playback can be suspended by the browser/OS. Android's notification can stop playback; audio-focus loss and headphone disconnect also stop it.

## Offline music for video (development branch)

One Node command renders stereo PCM24 WAV plus a reproducible JSON receipt:

`node tools/music-for-video.mjs render --config examples/cues/video-pulse.json --out output/teaser`

Choose the original oscillator DSP or the optional CC0 instrument rack. Replay a
receipt with `node tools/music-for-video.mjs replay output/teaser.json --out output/repeat`;
the WAV must match its expected hash before it is saved. See
[Music for video](tools/MUSIC_FOR_VIDEO.md) for profiles, limits, licensing and
editor use. This is an offline prototype, not a change to the installed app.

## Run web locally

Serve `docs/` through localhost HTTP or HTTPS. Audio starts only after a click. Run `node tests/audio-engine.test.mjs` for DSP tests. The app needs a current browser supporting AudioWorklet. Install through your browser when available; otherwise use it as a normal web app.

## Build Android

Use JDK17+, Gradle9.6.0, Android platform36/build-tools36.0.0 and AGP9.4.0. With the SDK already installed and its applicable license accepted:

`gradle :app:assembleDebug :app:lintDebug`

The read-only GitHub Actions workflow verifies its hosted toolchain, runs tests/lint and produces `SOU1-preview-apk`. Debug builds are development-signed; they are not Play Store releases. Hosted builds currently use different debug signing certificates, so a newly downloaded preview cannot normally update-install over an earlier preview. Uninstalling removes app-local settings. Use the PWA if preserving those settings is important. No signing credentials are stored here.

Run `sh tests/run.sh` for Java DSP tests, `sh tests/run-environment.sh` for weather tests and `node tests/ui-contract.test.mjs` for UI data-flow contracts. The script can use the JDK compiler module when a standalone `javac` launcher is absent.

## Licensing and provenance

Application and tool code: AGPL-3.0-only. See LICENSE. All application DSP and interface code in the initial implementation is original. The optional offline bank in `assets/cc0-mini/` contains separately licensed CC0-1.0 VCSL derivatives; see [provenance](tools/CC0_SAMPLER.md). No Zeitgeist source history, private game files, third-party song recordings or external fonts are included. Java and JavaScript synthesis share the design but are not PCM-identical across implementations. Public source remains linked from the interface.


## MIDI export (0.2)

The MIDI panel exports its retained generated-note history (up to 512 events) as a type-1 `.mid` file with separate instrument tracks. Viewer visibility filters do not remove notes from the export. Live web export requests a fresh engine snapshot; stopping also retains the final snapshot before audio suspension. A new seed clears this history.

Timing is preserved in seconds using a fixed 120 BPM, 960-PPQ export grid; the original changing beat grid is not recorded. General MIDI programs approximate the custom synthesizer, and effects/weather are not MIDI notes. Captured drum pitches are preserved (the generator's high tom pitch49 also maps to GM crash cymbal49). MIDI 1.0 cannot identify overlapping identical channel/pitch notes independently: retriggers shorten earlier notes, same-tick duplicates coalesce, and cross-track collisions use a one-tick gap (adjacent-tick collisions coalesce). This prevents stuck notes on common players.

Browsers download the file locally. Android uses the system Create Document picker without storage permissions; it reports success only after the output stream closes. A cancelled picker preserves the score. Process death cancels a pending save rather than exporting a different snapshot.

Version0.2.0 uses versionCode2. CI produces an **unsigned release APK** for owner-controlled release signing; this artifact is not install-ready. The persistent release key and password must stay outside this repository. The old debug-signed preview cannot be upgraded in place with a new release certificate. The public download manifest now points to the signed 0.2.0 APK. The owner confirmed a successful phone check on 2026-10-17; this does not claim broader device or background-playback qualification. Download the APK from the PWA or [GitHub Releases](https://github.com/FedotovskiiLev/SOU1/releases/tag/v0.2.0).


### Prepared electronic drums (offline branch)

The local rack can select the CC0 Fugue State Audio x0xproc1 kit and render a
repeatable common-note A/B against the original oscillator drums. See
[the electronic-drums guide](tools/ELECTRONIC_DRUMS.md). The standalone CLI remains available. The opt-in PWA and native Android paths below also use these banks; Surge XT hosting is separate.

See [five complete CC0 drum kits and aligned stem rendering](tools/FULL_DRUM_KITS.md) for the full 58-sound catalog.

### Composition, phrasing and full MIDI scores (offline branch)

The opt-in composer offers six different forms, meters and harmonic strategies,
plus five combinable phrasing treatments: lyrical, dialogue, angular,
ornamented and triplet. New notes, pauses, articulation, dynamic arcs and
counterparts are generated independently of sound selection. Both the basic
and expressive renderer can select any prepared drum kit, and the complete
score exports as type-1 MIDI with its real tempo, meter and section markers.

See [composition and MIDI guide](tools/VARIETY_COMPOSITION.md). This updates
local offline tools only: the live PWA/Android composer and installed version
are unchanged. Surge XT hosting and REAPER verification are separate work.

See [the separate Guigui acoustic CC0 soft/dynamic presets](tools/ACOUSTIC_DRUMS.md) for a recorded acoustic alternative and its source-quality caveats.

## Recorded drums in the PWA (development branch, not a release)

The existing Voices panel now offers the original procedural drums plus nine
recorded CC0 banks. Stop playback before changing the bank, enable **Drums**, then
press Play. Preparation is explicit and cancellable; failure is reported rather
than silently falling back to synthesis. The updated native Android bridge exposes
the same choice using its own background loader and native engine. Older native
bridges hide the choice. Existing saved settings default to procedural drums.

Samples are loaded and checksum-verified in a worker, resampled once to the audio
context rate and handed to a fixed 16-voice worklet pool. No decoding, sinc filter
or voice allocation occurs per sample. The recorded mix passes through the same
layer smoothing, activity gain, shared effects, weather mix, DC blocker and limiter.
The original EventScore, oscillator melodies, preset/control meanings, live reseed,
session timer and retained MIDI history are unchanged. This step does **not** wire
the new finite expressive MIDI composer into the main app or host Surge/SFZ.

Guigui dynamic only selects a hard sample when generated note velocity exceeds
0.6. The layer-volume knob changes output gain, not that selection threshold; quiet
generated notes can therefore select exactly the same hits as the soft kit. Source
hard-hit rail contacts and the non-calibrated dynamics remain documented.

`python3 tools/package-web-drums.py` creates the exact browser dependency package
and source hash lock under `docs/audio-kit/`. It includes the source license and
provenance documents. The service worker caches the full approximately 9.6 MB
package; an incomplete package fails installation without activating the update.
Then run `python3 tools/version-cache.py` when web assets change. Generated copies
are checked against their canonical repository sources.

Local validation includes actual banks over HTTP, worker cancellation, the real
AudioWorklet module under a Node host shim, original-event and disabled-drum PCM
parity, live controls/FX/weather/reseed/stop, packaging and offline-install contracts.
These checks are not an actual-browser, device, listening or release qualification.
The supported cloud-desktop preview is reachable; current browser acceptance results and unresolved checks are recorded in [the 0.3 candidate guide](tools/SOU1_03_INTEGRATION.md).

See [PWA integration, packaging and acceptance details](tools/PWA_RECORDED_DRUMS.md).

## Native recorded drums (development, device acceptance pending)

The foreground service prepares the selected bundled kit on one bounded worker,
then constructs the same native engine with an immutable bank. UI and service
correlate request IDs; cancelled/failed/stale work cannot silently restart playback.
The selected timer starts with the ready native session, including when the WebView
is hidden. Stop, focus loss, headphone disconnect and destruction cancel preparation.
The original procedural constructor and native AudioTrack stop policy are preserved.
No new network, storage, microphone or other permissions are added.

Bank preparation matches 9,997,004 JS Float32 frames and all 156 PCM hashes; the
recorded native engine matches 2,402,400 JS Float32 samples. These are deterministic
software comparisons, not device playback evidence. The aggregate Node suite and
new JVM tests are now part of the existing Android CI before APK compilation/lint.
See [native service contract and qualification limits](tools/NATIVE_DRUM_SERVICE.md)
and [native bank preparation](tests/NATIVE_DRUM_BANKS.md). APK build, remaining browser acceptance
and physical-device checks remain required before any release.


## SOU1 0.3 candidate: continuous composition and instrument selection

The original continuous ambient workflow remains, with an explicit **Developing
phrases** alternative. While stopped, choose tonic, scale, meter, melodic rhythm,
arpeggio order, drum pattern, harmony policy and drum variation. A manual choice
locks that field against randomization; presets and New melody preserve it.
Randomize only unlocked fields to combine settings beyond the four presets.

The Voices panel adds Chamber, Piano Room and range-limited Flute Chamber recorded
CC0 palettes. Five independent drum-role selectors assemble a kit from different
recorded banks. Existing layer levels, tempo, shared effects, weather and timer
remain available. Brightness/modulation/pluck-decay timbre controls continue to
shape the original oscillator voices, not the natural recorded instrument timbre.

Android candidate metadata is versionCode 3 / versionName 0.3.0. The download
manifest intentionally still identifies the existing signed 0.2.0 APK until a real
0.3 artifact is built, signed and verified. No old device result qualifies 0.3.
See [configuration, preparation, validation and release gates](tools/SOU1_03_INTEGRATION.md).
