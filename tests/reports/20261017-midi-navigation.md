# MIDI navigation correction

Root implemented ten instrument colors and labeled filters for generated events, native two-axis scrolling with a viewport-sized canvas, pitch range 0–127, time ruler, manual horizontal browsing and explicit follow-playhead return. Vertical browsing remains stable while following time. History remains bounded to 512 generated events; it is not a complete-session MIDI export.

Focused tests cover all instrument filters, extreme pitches, clipping, DPR allocation bounds, horizontal/vertical navigation, trimmed-history time anchoring, follow, seed reset including empty-to-empty, hidden-panel/mobile redraw. UI regression and AudioWorklet telemetry tests pass. Independent review findings addressed. Actual cloud Chrome tested vertical and horizontal wheel scrolling, manual-follow pause, follow return, note colors, filter toggle, playback and stop. No physical Android or touch-device qualification. Existing APK remains unchanged due signing incompatibility.
