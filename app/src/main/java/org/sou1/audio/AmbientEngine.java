// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

/**
 * Original event-scored, sample-free ambient synthesis. One rendering thread
 * owns DSP state; start/stop/setParameters may be called by a control thread.
 * Rendering allocates no objects. Equal seed, rate, controls and render schedule
 * produce equal PCM. Offsets are samples; render lengths are stereo frames.
 */
public final class AmbientEngine {
    public static final double FADE_SECONDS = 2.0;
    private static final int TABLE_SIZE = 4096;
    private static final double[] SINE = new double[TABLE_SIZE + 1];
    private static final int[][] CHORDS = {{50, 57, 62, 64}, {53, 57, 60, 64}, {55, 57, 62, 65}};
    private static final int[] MOTIF = {2, 1, 3, -1, 1, 0, -1, 2};
    static {
        for (int i = 0; i <= TABLE_SIZE; i++)
            SINE[i] = StrictMath.sin(i * 2.0 * StrictMath.PI / TABLE_SIZE);
    }

    /** Immutable, finite, clamped control snapshot. Invalid values use defaults. */
    public static final class Parameters {
        public static final Parameters DEFAULT = new Parameters(.5, .45, .35);
        public final double intensity, brightness, motion, timbre, warmth, strength, width, wash;
        public final double pad, pluck, bell, texture, pulse, evolution, rain, thunder, wind;
        public final int rainType;
        /** Allocated with the control snapshot, never on the sample path. */
        public final EnvironmentAudio.Parameters environment;
        private final double[] layers;
        public Parameters(double intensity, double brightness, double motion) {
            this(intensity, brightness, motion, .5);
        }
        public Parameters(double intensity, double brightness, double motion, double timbre) {
            this(intensity, brightness, motion, timbre, 0, 0, .5, 0);
        }
        public Parameters(double intensity, double brightness, double motion, double timbre,
                          double warmth, double strength, double width, double wash) {
            this(intensity, brightness, motion, timbre, warmth, strength, width, wash,
                    .65, .55, .35, .20, .15, 0, 0, 0, 0, 0);
        }
        public Parameters(double intensity, double brightness, double motion, double timbre,
                          double warmth, double strength, double width, double wash,
                          double pad, double pluck, double bell, double texture, double pulse,
                          double evolution, int rainType, double rain, double thunder, double wind) {
            this.intensity = clamp(intensity, .5);
            this.brightness = clamp(brightness, .45);
            this.motion = clamp(motion, .35);
            this.timbre = clamp(timbre, .5);
            this.warmth = clamp(warmth, 0);
            this.strength = clamp(strength, 0);
            this.width = clamp(width, .5);
            this.wash = clamp(wash, 0);
            this.pad = clamp(pad, .65);
            this.pluck = clamp(pluck, .55);
            this.bell = clamp(bell, .35);
            this.texture = clamp(texture, .20);
            this.pulse = clamp(pulse, .15);
            this.evolution = clamp(evolution, 0);
            this.rainType = Math.max(0, Math.min(3, rainType));
            this.rain = clamp(rain, 0);
            this.thunder = clamp(thunder, 0);
            this.wind = clamp(wind, 0);
            layers = new double[] {this.pad, this.pluck, this.bell, this.texture, this.pulse};
            environment = new EnvironmentAudio.Parameters(this.rainType, this.rain, this.thunder, this.wind);
        }
        private static double clamp(double v, double fallback) {
            return Double.isNaN(v) || Double.isInfinite(v) ? fallback
                    : Math.max(0, Math.min(1, v));
        }
    }

    /** Scalar events avoid allocations and allow hours of score-only testing. */
    public interface NoteSink {
        void noteOn(long frame, int instrument, int pitch, long durationFrames,
                    double velocity, double pan);
    }

    /**
     * Sample-clock composition shared with the web engine. Instruments are
     * 0 pad, 1 pluck, 2 bell, 3 texture, and 4 pulse. Each event includes an exact
     * note-off duration. Evolution zero visits three related harmonies in the
     * first three hours. The unsigned 32-bit LCG matches JavaScript Math.imul.
     */
    public static final class EventScore {
        public final int rate;
        public final long seed;
        public long next, step, chordAge, padAt, textureAt, melodyAt, chordChanges, eventCount;
        public int chord;
        private int state;
        public EventScore(int rate) { this(rate, 1); }
        public EventScore(int rate, long seed) {
            if (rate < 8000 || rate > 192000)
                throw new IllegalArgumentException("sampleRate must be 8000..192000");
            this.rate = rate;
            this.seed = seed & 0xffffffffL;
            reset();
        }
        public void reset() {
            state = (int) seed;
            next = step = chordAge = padAt = textureAt = melodyAt = chordChanges = eventCount = 0;
            chord = 0;
        }
        public double random() {
            state = state * 1664525 + 1013904223;
            return (state & 0xffffffffL) / 4294967296.0;
        }
        private void emit(NoteSink sink, long frame, int instrument, int pitch,
                          double seconds, double velocity) {
            eventCount++;
            sink.noteOn(frame, instrument, pitch, Math.round(seconds * rate),
                    velocity, .15 + .7 * random());
        }
        public void advanceTo(long frame, double evolution, NoteSink sink) {
            if (sink == null) throw new IllegalArgumentException("note sink required");
            double e = Parameters.clamp(evolution, 0);
            while (next <= frame) {
                long at = next;
                long chordLength = Math.round(rate * 3600.0 * StrictMath.exp(-5 * e));
                if (at - chordAge >= chordLength) {
                    chord = (chord + 1) % 3;
                    chordAge = at;
                    chordChanges++;
                    padAt = at;
                }
                int[] notes = CHORDS[chord];
                if (at >= padAt) {
                    for (int j = 0; j < 4; j++)
                        emit(sink, at, 0, notes[j], 26 - 10 * e, .65 + .12 * random());
                    padAt = at + Math.round(rate * (22 - 8 * e));
                }
                if (at >= textureAt) {
                    emit(sink, at, 3, notes[2] + 12, 32, .35);
                    textureAt = at + Math.round(rate * 29.0);
                }
                if (at >= melodyAt) {
                    int m = MOTIF[(int) (step % 8)];
                    if (m >= 0)
                        emit(sink, at, 1, notes[(m + (int) ((step / 32) % 2)) % 4] + 12,
                                3.8, .65 + .25 * random());
                    if (step % 4 == 2)
                        emit(sink, at, 2, notes[((int) step >> 2) % 4] + 24, 7,
                                .45 + .2 * random());
                    if (step % 2 == 0) emit(sink, at, 4, notes[0] + 12, 1.7, .5);
                    step++;
                    melodyAt = at + Math.round(rate * (step == 1 ? 3
                            : (18 - 16.4 * e) * (step % 8 == 0 ? 1.6 : 1)));
                }
                next = Math.min(Math.min(padAt, textureAt), Math.min(melodyAt, chordAge + chordLength));
            }
        }
    }

    private MacroBus macros;
    private final int sampleRate;
    private final Voice[] voices = new Voice[32];
    private final EventScore score;
    private final EnvironmentAudio environment;
    private final NoteSink noteSink = this::noteOn;
    private final double[] layerGains = {.65, .55, .35, .20, .15};
    private final double smoothing, dcPole;
    private volatile Parameters parameters = Parameters.DEFAULT;
    private volatile boolean requestedPlaying;
    private double intensity = .5, brightness = .45, motion = .35, timbre = .5;
    private double fade, previousL, previousR, dcL, dcR, outputL, outputR;
    private long frame, noteOnCount, noteOffCount, droppedNotes;

    private static final class Voice {
        boolean active, off;
        double phase, phaseB, frequency, velocity, panL, panR;
        long age, duration, release;
        int instrument, midi;
    }

    public AmbientEngine(int sampleRate) { this(sampleRate, 1); }
    public AmbientEngine(int sampleRate, long seed) {
        if (sampleRate < 8000 || sampleRate > 192000)
            throw new IllegalArgumentException("sampleRate must be 8000..192000");
        this.sampleRate = sampleRate;
        macros = new MacroBus(sampleRate);
        score = new EventScore(sampleRate, seed);
        environment = new EnvironmentAudio(sampleRate, seed);
        smoothing = 1.0 - StrictMath.exp(-1.0 / (sampleRate * 1.5));
        dcPole = StrictMath.exp(-2.0 * StrictMath.PI * 12.0 / sampleRate);
        for (int i = 0; i < voices.length; i++) voices[i] = new Voice();
    }

    public int getSampleRate() { return sampleRate; }
    public void start() { requestedPlaying = true; }
    public void stop() { requestedPlaying = false; }
    public boolean isPlayingRequested() { return requestedPlaying; }
    public void setParameters(Parameters parameters) {
        if (parameters == null) throw new IllegalArgumentException("parameters must not be null");
        this.parameters = parameters;
    }
    public Parameters getParameters() { return parameters; }
    /** Render-thread diagnostics. */
    public long getFrame() { return frame; }
    public long getNoteOnCount() { return noteOnCount; }
    public long getNoteOffCount() { return noteOffCount; }
    public long getDroppedNotes() { return droppedNotes; }
    public EventScore getScore() { return score; }

    /** Use from the audio thread only. True once the fade has reached silence. */
    public boolean isSilent() { return fade == 0.0 && !requestedPlaying; }

    /** Rendering-thread reset: clears voices and tails, preserves control targets. */
    public void reset() {
        requestedPlaying = false;
        fade = 0;
        frame = 0;
        score.reset();
        for (Voice v : voices) v.active = false;
        environment.reset();
        macros = new MacroBus(sampleRate);
        outputL = outputR = previousL = previousR = dcL = dcR = 0;
        noteOnCount = noteOffCount = droppedNotes = 0;
    }

    public void render(short[] stereo, int offsetSamples, int frameCount) {
        checkRange(stereo == null ? -1 : stereo.length, offsetSamples, frameCount);
        Parameters target = parameters;
        boolean playing = requestedPlaying;
        prepareEnvironment(target, playing);
        for (int i = 0; i < frameCount; i++) {
            next(target, playing);
            stereo[offsetSamples++] = (short) Math.round(outputL * 32767.0);
            stereo[offsetSamples++] = (short) Math.round(outputR * 32767.0);
        }
    }

    public void render(float[] stereo, int offsetSamples, int frameCount) {
        checkRange(stereo == null ? -1 : stereo.length, offsetSamples, frameCount);
        Parameters target = parameters;
        boolean playing = requestedPlaying;
        prepareEnvironment(target, playing);
        for (int i = 0; i < frameCount; i++) {
            next(target, playing);
            stereo[offsetSamples++] = (float) outputL;
            stereo[offsetSamples++] = (float) outputR;
        }
    }

    /** Publish one coherent control/transport snapshot for the entire block. */
    private void prepareEnvironment(Parameters target, boolean playing) {
        environment.setParameters(target.environment);
        if (playing) environment.start(); else environment.stop();
    }

    private static void checkRange(int length, int offset, int frames) {
        if (length < 0 || offset < 0 || frames < 0 || offset > length
                || frames > (length - offset) / 2)
            throw new IllegalArgumentException("invalid stereo buffer range");
    }

    private void noteOn(long at, int instrument, int pitch, long duration,
                        double velocity, double pan) {
        Voice v = null;
        for (int i = 0; i < voices.length; i++) {
            if (!voices[i].active) { v = voices[i]; break; }
        }
        if (v == null) { droppedNotes++; return; }
        v.active = true;
        v.off = false;
        v.phase = v.phaseB = 0;
        v.age = 0;
        v.duration = duration;
        v.release = Math.round(sampleRate * (instrument == 0 ? 4 : instrument == 3 ? 6 : .8));
        v.instrument = instrument;
        v.frequency = 440 * StrictMath.pow(2, (pitch - 69) / 12.0);
        v.midi = pitch;
        v.velocity = velocity;
        v.panL = StrictMath.sqrt(1 - pan);
        v.panR = StrictMath.sqrt(pan);
        noteOnCount++;
    }

    private void next(Parameters target, boolean playing) {
        intensity += smoothing * (target.intensity - intensity);
        brightness += smoothing * (target.brightness - brightness);
        motion += smoothing * (target.motion - motion);
        timbre += smoothing * (target.timbre - timbre);
        for (int i = 0; i < layerGains.length; i++)
            layerGains[i] += smoothing * (target.layers[i] - layerGains[i]);
        if (!playing && fade == 0) { outputL = outputR = 0; return; }
        if (playing) score.advanceTo(frame, target.evolution, noteSink);
        double left = 0, right = 0;
        for (int i = 0; i < voices.length; i++) {
            Voice v = voices[i];
            if (!v.active) continue;
            if (v.age >= v.duration && !v.off) { v.off = true; noteOffCount++; }
            if (v.age >= v.duration + v.release) { v.active = false; continue; }
            double t = v.age / (double) sampleRate, p = v.phase;
            int k = v.instrument;
            double attack = k == 0 ? 3 : k == 3 ? 5 : k == 2 ? .025 : k == 1 ? .012 : .08;
            double envelope = Math.min(1, t / attack);
            envelope = envelope * envelope * (3 - 2 * envelope);
            if (v.off) {
                double r = Math.max(0, 1 - (v.age - v.duration) / (double) v.release);
                envelope *= r * r * (3 - 2 * r);
            }
            // Each additive partial stays below 45% of the sample rate.
            double h2 = v.frequency * 2 < sampleRate * .45 ? sine(p * 2) : 0;
            double h3 = v.frequency * 3 < sampleRate * .45 ? sine(p * 3) : 0;
            double value;
            if (k == 0)
                value = (sine(p) + h2 * (.12 + .13 * brightness) + h3 * .045)
                        * (.86 + .14 * sine(t * .055)) * .075;
            else if (k == 1)
                value = (sine(p) + h2 * .4 + h3 * .18)
                        * StrictMath.exp(-t / (.65 + .7 * timbre)) * .19;
            else if (k == 2) {
                double metallic = v.frequency * 2.71 < sampleRate * .45 ? sine(v.phaseB) : 0;
                value = (sine(p) * StrictMath.exp(-t / 2.8)
                        + metallic * .45 * StrictMath.exp(-t / .8)) * .15;
            } else if (k == 3)
                value = (sine(p) + sine(v.phaseB) * .5) * (.6 + .4 * sine(t * .11)) * .04;
            else value = (sine(p) + h2 * .15) * StrictMath.exp(-t / .32) * .17;
            value *= envelope * v.velocity * layerGains[k];
            left += value * v.panL;
            right += value * v.panR;
            double increment = v.frequency * (1 + .0005 * motion * sine(t * .13)) / sampleRate;
            v.phase = wrap(v.phase + increment);
            v.phaseB = wrap(v.phaseB + increment * (k == 2 ? 2.71 : 1.003));
            v.age++;
        }
        left *= 1 + intensity * 1.4;
        right *= 1 + intensity * 1.4;
        environment.next();
        macros.process(left + environment.outputL, right + environment.outputR, target);
        left = macros.left;
        right = macros.right;
        dcL = left - previousL + dcPole * dcL;
        dcR = right - previousR + dcPole * dcR;
        previousL = left;
        previousR = right;
        outputL = .85 * dcL / (1 + Math.abs(dcL)) * fade;
        outputR = .85 * dcR / (1 + Math.abs(dcR)) * fade;
        double fadeStep = 1.0 / (FADE_SECONDS * sampleRate);
        fade = playing ? Math.min(1, fade + fadeStep) : Math.max(0, fade - fadeStep);
        if (fade < 1e-12 && !playing) fade = 0;
        frame++;
    }

    private static double wrap(double phase) { return phase - StrictMath.floor(phase); }
    private static double sine(double phase) {
        double position = wrap(phase) * TABLE_SIZE;
        int index = (int) position;
        return SINE[index] + (SINE[index + 1] - SINE[index]) * (position - index);
    }

    /** Original shared-bus tone and diffusion processor; public for numerical tests. */
    public static final class MacroBus {
        private final double smooth, tonePole, damp;
        private double warmth, strength, width = .5, wash, lowL, lowR;
        public double left, right;
        private final double[][] lines = new double[4][];
        private final int[] pos = new int[4];
        private final double[] filtered = new double[4];
        public MacroBus(int rate) {
            smooth = 1 - StrictMath.exp(-1.0 / (rate * .05));
            tonePole = 1 - StrictMath.exp(-2 * StrictMath.PI * 900 / rate);
            damp = 1 - StrictMath.exp(-2 * StrictMath.PI * 2600 / rate);
            double[] times = {.0311, .0437, .0593, .0719};
            for (int i = 0; i < 4; i++) lines[i] = new double[(int)(rate * times[i]) + 1];
        }
        public void process(double left, double right, Parameters target) {
            warmth += smooth * (target.warmth - warmth);
            strength += smooth * (target.strength - strength);
            width += smooth * (target.width - width);
            wash += smooth * (target.wash - wash);
            lowL += tonePole * (left - lowL);
            lowR += tonePole * (right - lowR);
            // Warmth darkens and gently saturates; strength adds compensated presence.
            left += .65 * warmth * (lowL - left);
            right += .65 * warmth * (lowR - right);
            left = left / (1 + warmth * Math.abs(left));
            right = right / (1 + warmth * Math.abs(right));
            left = (left + .6 * strength * (left - lowL)) / (1 + .3 * strength);
            right = (right + .6 * strength * (right - lowR)) / (1 + .3 * strength);
            // Odd soft nonlinearity supplies restrained original harmonics.
            left /= 1 + .8 * strength * Math.abs(left);
            right /= 1 + .8 * strength * Math.abs(right);
            for (int i = 0; i < 4; i++) filtered[i] += damp * (lines[i][pos[i]] - filtered[i]);
            double a = filtered[0], b = filtered[1], c = filtered[2], d = filtered[3];
            lines[0][pos[0]] = left * .25 + .36 * (a + b + c + d);
            lines[1][pos[1]] = right * .25 + .36 * (a - b + c - d);
            lines[2][pos[2]] = left * .25 + .36 * (a + b - c - d);
            lines[3][pos[3]] = right * .25 + .36 * (a - b - c + d);
            for (int i = 0; i < 4; i++) if (++pos[i] == lines[i].length) pos[i] = 0;
            double wet = .5 * wash;
            left = left * (1 - wet) + (a + c) * wet;
            right = right * (1 - wet) + (b + d) * wet;
            // 0 = mono, .5 = unchanged, 1 = twice the side signal with headroom compensation.
            if (width != .5) {
              double mid = (left + right) * .5, side = (left - right) * width;
              double gain = 1 / Math.max(1, width * 2);
              left = (mid + side) * gain; right = (mid - side) * gain;
            }
            this.left = left; this.right = right;
        }
    }
}
