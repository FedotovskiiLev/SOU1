// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

/**
 * Original, sample-free ambient synthesis. One rendering thread owns DSP state;
 * start/stop/setParameters may be called by a control thread. Rendering allocates
 * no objects. Equal seed, rate, controls and render schedule produce equal PCM.
 * Output is stereo; offsets are in samples and lengths are in stereo frames.
 */
public final class AmbientEngine {
    public static final double FADE_SECONDS = 2.0;
    private static final int TABLE_SIZE = 4096;
    private static final double[] SINE = new double[TABLE_SIZE + 1];
    private static final int[] SCALE = {0, 2, 4, 7, 9};
    static {
        for (int i = 0; i <= TABLE_SIZE; i++)
            SINE[i] = StrictMath.sin(i * 2.0 * StrictMath.PI / TABLE_SIZE);
    }

    /** Immutable, finite, clamped control snapshot. Invalid values use defaults. */
    public static final class Parameters {
        public static final Parameters DEFAULT = new Parameters(.5, .45, .35);
        public final double intensity, brightness, motion, timbre;
        public Parameters(double intensity, double brightness, double motion) {
            this(intensity, brightness, motion, .5);
        }
        public Parameters(double intensity, double brightness, double motion, double timbre) {
            this.intensity = clamp(intensity, .5);
            this.brightness = clamp(brightness, .45);
            this.motion = clamp(motion, .35);
            this.timbre = clamp(timbre, .5);
        }
        private static double clamp(double v, double fallback) {
            return Double.isNaN(v) || Double.isInfinite(v) ? fallback
                    : Math.max(0, Math.min(1, v));
        }
    }

    private final int sampleRate;
    private final Voice[] pads = new Voice[6];
    private final Voice[] notes = new Voice[3];
    private final double[] delayL, delayR;
    private final double smoothing, dcPole, damping;
    private volatile Parameters parameters = Parameters.DEFAULT;
    private volatile boolean requestedPlaying;
    private double intensity = .5, brightness = .45, motion = .35, timbre = .5;
    private double fade, driftPhase, filteredL, filteredR;
    private double previousL, previousR, dcL, dcR, outputL, outputR;
    private int delayPositionL, delayPositionR, nextNoteVoice;
    private long randomState, noteCountdown;

    private static final class Voice {
        double phase, age, duration, frequency, panL, panR;
    }

    public AmbientEngine(int sampleRate, long seed) {
        if (sampleRate < 8000 || sampleRate > 192000)
            throw new IllegalArgumentException("sampleRate must be 8000..192000");
        this.sampleRate = sampleRate;
        randomState = seed;
        smoothing = 1.0 - StrictMath.exp(-1.0 / (sampleRate * 1.5));
        dcPole = StrictMath.exp(-2.0 * StrictMath.PI * 12.0 / sampleRate);
        damping = 1.0 - StrictMath.exp(-2 * StrictMath.PI * 1800 / sampleRate);
        delayL = new double[(int) (sampleRate * .293) + 1];
        delayR = new double[(int) (sampleRate * .419) + 1];
        for (int i = 0; i < pads.length; i++) {
            Voice v = new Voice();
            pads[i] = v;
            renewPad(v);
            v.age = random() * v.duration; // distributed overlapping, soft swells
            v.phase = random();
        }
        for (int i = 0; i < notes.length; i++) {
            notes[i] = new Voice();
            notes[i].duration = 1;
            notes[i].age = 1;
        }
        noteCountdown = sampleRate * 3L;
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

    /** Use from the audio thread only. True once the fade has reached silence. */
    public boolean isSilent() { return fade == 0.0 && !requestedPlaying; }

    public void render(short[] stereo, int offsetSamples, int frameCount) {
        checkRange(stereo == null ? -1 : stereo.length, offsetSamples, frameCount);
        Parameters target = parameters;
        boolean playing = requestedPlaying;
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
        for (int i = 0; i < frameCount; i++) {
            next(target, playing);
            stereo[offsetSamples++] = (float) outputL;
            stereo[offsetSamples++] = (float) outputR;
        }
    }

    private static void checkRange(int length, int offset, int frames) {
        if (length < 0 || offset < 0 || frames < 0 || offset > length
                || frames > (length - offset) / 2)
            throw new IllegalArgumentException("invalid stereo buffer range");
    }

    private void next(Parameters target, boolean playing) {
        intensity += smoothing * (target.intensity - intensity);
        brightness += smoothing * (target.brightness - brightness);
        motion += smoothing * (target.motion - motion);
        timbre += smoothing * (target.timbre - timbre);
        if (!playing && fade == 0) { outputL = outputR = 0; return; }
        double left = 0, right = 0;
        driftPhase = wrap(driftPhase + (.008 + .017 * motion) / sampleRate);
        double drift = sine(driftPhase);
        double colour = .2 + timbre * 1.6;
        for (Voice v : pads) {
            if (v.age >= v.duration) renewPad(v);
            // Raised-cosine envelope and its derivative are zero at voice recycling.
            double envelope = .5 - .5 * sine(v.age / v.duration + .25);
            double fundamental = sine(v.phase);
            double harmonic = sine(v.phase * 2) * (.06 + .19 * brightness) * colour
                    + sine(v.phase * 3) * (.015 + .065 * brightness) * colour
                    + sine(v.phase * 4) * .035 * timbre * brightness;
            double value = (fundamental + harmonic) * envelope * .095;
            left += value * v.panL;
            right += value * v.panR;
            v.phase = wrap(v.phase + v.frequency * (1 + drift * .0012 * motion) / sampleRate);
            v.age += (0.75 + motion * .5) / sampleRate;
        }
        if (--noteCountdown <= 0) {
            Voice v = notes[nextNoteVoice];
            nextNoteVoice = (nextNoteVoice + 1) % notes.length;
            v.age = 0;
            v.duration = 7 + random() * 5;
            v.frequency = frequency(60 + SCALE[(int) (random() * SCALE.length)]);
            setPan(v);
            noteCountdown = (long) ((8 + random() * 9) * sampleRate / (.7 + .6 * motion));
        }
        for (Voice v : notes) {
            if (v.age >= v.duration) continue;
            double envelope = .5 - .5 * sine(v.age / v.duration + .25);
            double value = sine(v.phase) * envelope * envelope * (.012 + intensity * .028);
            left += value * v.panL;
            right += value * v.panR;
            v.phase = wrap(v.phase + v.frequency / sampleRate);
            v.age += 1.0 / sampleRate;
        }
        double echoL = delayL[delayPositionL], echoR = delayR[delayPositionR];
        // Fixed-pole damping: same time constant at every supported sample rate.
        filteredL += damping * (echoL - filteredL);
        filteredR += damping * (echoR - filteredR);
        delayL[delayPositionL] = left + filteredR * .58;
        delayR[delayPositionR] = right + filteredL * .58;
        if (++delayPositionL == delayL.length) delayPositionL = 0;
        if (++delayPositionR == delayR.length) delayPositionR = 0;
        left = (left + echoL * .28) * (.30 + intensity * .65);
        right = (right + echoR * .28) * (.30 + intensity * .65);
        dcL = left - previousL + dcPole * dcL;
        dcR = right - previousR + dcPole * dcR;
        previousL = left;
        previousR = right;
        outputL = .85 * dcL / (1 + Math.abs(dcL)) * fade;
        outputR = .85 * dcR / (1 + Math.abs(dcR)) * fade;
        double step = 1.0 / (FADE_SECONDS * sampleRate);
        fade = playing ? Math.min(1, fade + step) : Math.max(0, fade - step);
        if (fade < 1e-12 && !playing) fade = 0;
    }

    private void renewPad(Voice v) {
        v.age = 0;
        v.duration = 25 + random() * 28;
        int note = 36 + SCALE[(int) (random() * SCALE.length)] + (random() < .45 ? 12 : 0);
        v.frequency = frequency(note) * (1 + (random() - .5) * .0015);
        setPan(v);
    }
    private void setPan(Voice v) {
        double pan = .12 + .76 * random();
        v.panL = StrictMath.sqrt(1 - pan);
        v.panR = StrictMath.sqrt(pan);
    }
    private static double frequency(int midi) { return 440 * StrictMath.pow(2, (midi - 69) / 12.0); }
    private double random() {
        // SplitMix64: accepts every seed (including zero); no external randomness.
        long z = (randomState += 0x9e3779b97f4a7c15L);
        z = (z ^ (z >>> 30)) * 0xbf58476d1ce4e5b9L;
        z = (z ^ (z >>> 27)) * 0x94d049bb133111ebL;
        z ^= z >>> 31;
        return (z >>> 11) * 0x1.0p-53;
    }
    private static double wrap(double phase) { return phase - StrictMath.floor(phase); }
    private static double sine(double phase) {
        double position = wrap(phase) * TABLE_SIZE;
        int index = (int) position;
        return SINE[index] + (SINE[index + 1] - SINE[index]) * (position - index);
    }
}
