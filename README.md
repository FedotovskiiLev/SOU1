# SOU1

An original ambient instrument for focus, study and quiet work. ASCII interface, an audio-reactive play button, four soundspaces and continuous controls for activity, brightness, motion and timbre.

- **PWA:** dependency-free Web Audio / AudioWorklet, local preferences and offline cache after first load.
- **Android:** the same bundled interface with native AudioTrack synthesis in a foreground media service. Android8+; no Internet, microphone or storage permissions.
- **Sound:** generated from oscillators and bounded delay lines, not streamed or sampled from recordings. Start quietly.
- **Privacy:** no accounts, analytics, recording or uploads.

## Development status

Early preview. DSP numerical/JVM/Node tests exist; a generated APK is not a claim of physical-device, listening or background-playback qualification. Browser playback can be suspended by the browser/OS. Android's notification can stop playback; audio-focus loss and headphone disconnect also stop it.

## Run web locally

Serve `docs/` through localhost HTTP or HTTPS. Audio starts only after a click. Run `node tests/audio-engine.test.mjs` for DSP tests. The app needs a current browser supporting AudioWorklet. Install through your browser when available; otherwise use it as a normal web app.

## Build Android

Use JDK17+, Gradle9.6.0, Android platform36/build-tools36.0.0 and AGP9.4.0. With the SDK already installed and its applicable license accepted:

`gradle :app:assembleDebug :app:lintDebug`

The read-only GitHub Actions workflow verifies its hosted toolchain, runs tests/lint and produces `SOU1-preview-apk`. Debug builds are development-signed; they are not Play Store releases. No signing credentials are stored here.

Run `sh tests/run.sh` for Java DSP tests. The script can use the JDK compiler module when a standalone `javac` launcher is absent.

## Licensing and provenance

AGPL-3.0-only. See LICENSE. All application DSP and interface code in this initial implementation is original. No Zeitgeist source history, private game files, third-party music, sample packs or external fonts are included. Java and JavaScript synthesis share the design but are not PCM-identical across implementations. Public source remains linked from the interface.
