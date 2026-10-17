# SOU1

An original ambient instrument for focus, study and quiet work. ASCII interface, an audio-reactive play button, composition layers, timbral controls, effects and independent procedural environment sounds.

- **PWA:** dependency-free Web Audio / AudioWorklet, local preferences and offline cache after first load.
- **Android:** the same bundled interface with native AudioTrack synthesis in a foreground media service. Android8+; no Internet, microphone or storage permissions.
- **Sound:** generated from oscillators and bounded delay lines, not streamed or sampled from recordings. Start quietly.
- **Privacy:** no accounts, analytics, recording or uploads.

## Controls

- Exposed phrase controls blend long-form sustained ambient, simplified tonal counterpoint, rhythmic sequences and evolving arpeggios. Density, variation, swing and harmonic development are independently adjustable. “Eno-inspired” and “Bach-inspired” are original generative presets, not recordings, copied compositions or claims of recreating those artists.
- Tempo: 30–180 BPM. Melodic polyphony: 8, 16, 24 or 32 voices; a separate bounded drum pool handles percussion.
- Melody voices and drums have independent enable switches. Pads, plucks, bells, texture and bass/pulse have independent levels. Drum controls cover kick, snare, hi-hat, toms and cymbal.
- “New melody” changes the seed during playback without resetting the session timer. Music changes through a short fade; weather remains independently controlled.
- The slow pad endpoint retains three harmonies over three hours. Development raises the pace of harmonic changes. Other phrase settings use progression, motif and rhythmic development. Notes are internal MIDI-like events, not external MIDI device output or a Standard MIDI File export.
- Effects: original warmth, presence, stereo width and diffuse reverb. The four-macro reference is [TOSKA by Noon Instruments](https://www.nooninstruments.com/toska); this is not its engine or sample library.
- Environment: light/steady/heavy rain with discrete impacts, independent multi-roll thunder and gusting wind. All sample-free; realism and listening quality require subjective evaluation.
- EN/RU, output level and timer. The mobile layout separates Composition, Voices, Effects and Environment. Native Android hides APK/PWA-install links; the website retains them.
- ASCII and the play-button outline react to actual output. Reduced-motion preference suppresses deformation.

Presets are complete snapshots of exposed musical, effect and weather controls. They do not select hidden artist modes; master output, seed and session timer remain independent.

## Development status

Early preview. DSP numerical/JVM/Node tests exist; a generated APK is not a claim of physical-device, listening or background-playback qualification. Browser playback can be suspended by the browser/OS. Android's notification can stop playback; audio-focus loss and headphone disconnect also stop it.

## Run web locally

Serve `docs/` through localhost HTTP or HTTPS. Audio starts only after a click. Run `node tests/audio-engine.test.mjs` for DSP tests. The app needs a current browser supporting AudioWorklet. Install through your browser when available; otherwise use it as a normal web app.

## Build Android

Use JDK17+, Gradle9.6.0, Android platform36/build-tools36.0.0 and AGP9.4.0. With the SDK already installed and its applicable license accepted:

`gradle :app:assembleDebug :app:lintDebug`

The read-only GitHub Actions workflow verifies its hosted toolchain, runs tests/lint and produces `SOU1-preview-apk`. Debug builds are development-signed; they are not Play Store releases. Hosted builds currently use different debug signing certificates, so a newly downloaded preview cannot normally update-install over an earlier preview. Uninstalling removes app-local settings. Use the PWA if preserving those settings is important. No signing credentials are stored here.

Run `sh tests/run.sh` for Java DSP tests, `sh tests/run-environment.sh` for weather tests and `node tests/ui-contract.test.mjs` for UI data-flow contracts. The script can use the JDK compiler module when a standalone `javac` launcher is absent.

## Licensing and provenance

AGPL-3.0-only. See LICENSE. All application DSP and interface code in this initial implementation is original. No Zeitgeist source history, private game files, third-party music, sample packs or external fonts are included. Java and JavaScript synthesis share the design but are not PCM-identical across implementations. Public source remains linked from the interface.


## MIDI export (0.2)

The MIDI panel exports its retained generated-note history (up to 512 events) as a type-1 `.mid` file with separate instrument tracks. Viewer visibility filters do not remove notes from the export. Live web export requests a fresh engine snapshot; stopping also retains the final snapshot before audio suspension. A new seed clears this history.

Timing is preserved in seconds using a fixed 120 BPM, 960-PPQ export grid; the original changing beat grid is not recorded. General MIDI programs approximate the custom synthesizer, and effects/weather are not MIDI notes. Captured drum pitches are preserved (the generator's high tom pitch49 also maps to GM crash cymbal49). MIDI 1.0 cannot identify overlapping identical channel/pitch notes independently: retriggers shorten earlier notes, same-tick duplicates coalesce, and cross-track collisions use a one-tick gap (adjacent-tick collisions coalesce). This prevents stuck notes on common players.

Browsers download the file locally. Android uses the system Create Document picker without storage permissions; it reports success only after the output stream closes. A cancelled picker preserves the score. Process death cancels a pending save rather than exporting a different snapshot.

Version0.2.0 uses versionCode2. CI produces an **unsigned release APK** for owner-controlled release signing; this artifact is not install-ready. The persistent release key and password must stay outside this repository. The old debug-signed preview cannot be upgraded in place with a new release certificate. The public download manifest remains pinned to the existing preview until a signed, verified replacement is deliberately published.
