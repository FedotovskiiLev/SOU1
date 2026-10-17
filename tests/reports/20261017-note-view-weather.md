# Generated-note viewer, fixed-cell ASCII, thunder revision

Local development checkpoint; not an installed APK or published web release.

- The MIDI panel observes actual generated score events in the JS worklet and native Java engine. It does not run a second score generator or export a MIDI file. History is bounded to 512 events; the view shows a 30-second window. Events may be suppressed by voice limits or mix controls, so the display is not an assertion that every note is audible.
- Reseed invalidates history; replies carry seed identity. Stop retains bounded history without keeping the native DSP engine alive solely for display. Browser requests require an active audio context and one request at a time. Native formatting occurs outside the short snapshot lock.
- ASCII glyphs use individually positioned canvas cells; Android fallback font metrics cannot expand an entire text row. The cloud desktop browser and a 393px iframe viewport were visually inspected. This is not Android WebView or physical-phone qualification.
- Thunder has a 3ms attack, short decaying crack, two early reflections and seven delayed rolling envelopes. Rain and wind RNG/control separation remains. The same arithmetic is implemented in Java and JavaScript.

Validation: existing JS DSP, score/composition/parity, weather, balance and UI suites passed locally. Focused history/detachment/reset/clip/DPR tests and the real worklet adapter score callback passed. Native synthesis and composition tests passed; the added native note-history reset/seed check passed. Weather Java/JS maximum observed sample difference across five sample rates was 1.80e-15. These automated metrics do not establish subjective naturalness of the sound.

Remaining: Android SDK APK compilation/lint, actual installed APK input/layout/audio/background checks and signing continuity. The bundled downloadable APK and version metadata are deliberately unchanged; they do not contain this checkpoint. No new key or access was created.
