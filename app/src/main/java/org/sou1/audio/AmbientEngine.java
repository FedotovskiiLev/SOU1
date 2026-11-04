// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

/**
 * Original event-scored ambient synthesis, optionally using prepared acoustic banks.
 * The original constructors retain the sample-free path unchanged. One rendering thread
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
    private static final int[] SCALE = {0, 2, 3, 5, 7, 8, 10};
    private static final int[] COUNTER_MOTIF = {4, 2, 0, 2}, SIMPLE_MOTIF = {0,0,2,2,4,4,2,0};
    private static final int[][] MOTIFS = {{0,2,1,4,3,2,1,0},{0,1,3,2,4,2,1,0},{4,2,3,1,2,0,1,0},{0,3,2,1,4,5,2,0},
            {2,0,1,3,4,2,3,0},{0,1,2,4,3,5,4,2},{4,3,1,2,0,2,1,0},{0,2,4,3,1,2,5,4}};
    private static final int[] RHYTHMS = {0x77,0xdd,0xb7,0xed,0x6f,0xf5,0xd7,0xbd}, FORM = {0,0,1,0,1,2,1,3};
    private static final int[][] ARPS = {{0,1,2},{0,2,1},{1,0,2},{1,2,0},{2,0,1},{2,1,0}};
    private static final int[][] PROGRESSIONS = {{0,5,3,4,0,3,4,0}, {0,3,6,2,5,1,4,0}, {0,5,2,6,3,0,4,0}, {0,2,5,3,0,6,4,0}};
    static {
        for (int i = 0; i <= TABLE_SIZE; i++)
            SINE[i] = StrictMath.sin(i * 2.0 * StrictMath.PI / TABLE_SIZE);
    }

    /** Immutable, finite, clamped control snapshot. Invalid values use defaults. */
    public static final class Parameters {
        public static final Parameters DEFAULT = new Parameters(.5, .45, .35);
        public final double intensity, brightness, motion, timbre, warmth, strength, width, wash;
        public final double pad, pluck, bell, texture, pulse, evolution, rain, thunder, wind;
        public final int rainType, composition, polyphony;
        public final double bpm, kick, snare, hihat, toms, cymbal;
        public final double ambient, counterpoint, rhythmic, arpeggio, density, complexity, swing;
        public final boolean melodyEnabled, drumsEnabled;
        private final double[] drums;
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
            this(intensity, brightness, motion, timbre, warmth, strength, width, wash,
                    pad, pluck, bell, texture, pulse, evolution, rainType, rain, thunder, wind,
                    0, 72, 16, true, false, .65, .4, .3, .35, .2);
        }
        public Parameters(double intensity, double brightness, double motion, double timbre,
                          double warmth, double strength, double width, double wash,
                          double pad, double pluck, double bell, double texture, double pulse,
                          double evolution, int rainType, double rain, double thunder, double wind,
                          int composition, double bpm, int polyphony, boolean melodyEnabled, boolean drumsEnabled,
                          double kick, double snare, double hihat, double toms, double cymbal) {
            this(intensity, brightness, motion, timbre, warmth, strength, width, wash,
                    pad, pluck, bell, texture, pulse, evolution, rainType, rain, thunder, wind,
                    composition, bpm, polyphony, melodyEnabled, drumsEnabled, kick, snare, hihat, toms, cymbal,
                    legacyWeight(composition, 0), legacyWeight(composition, 1), legacyWeight(composition, 2), legacyWeight(composition, 3), .5, .5, 0);
        }
        /** Explicit style weights take precedence over the legacy migration hint. */
        public Parameters(double intensity, double brightness, double motion, double timbre,
                          double warmth, double strength, double width, double wash,
                          double pad, double pluck, double bell, double texture, double pulse,
                          double evolution, int rainType, double rain, double thunder, double wind,
                          int composition, double bpm, int polyphony, boolean melodyEnabled, boolean drumsEnabled,
                          double kick, double snare, double hihat, double toms, double cymbal,
                          double ambient, double counterpoint, double rhythmic, double arpeggio,
                          double density, double complexity, double swing) {
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
            this.composition = Math.max(0, Math.min(3, composition));
            this.ambient = clamp(ambient, 1); this.counterpoint = clamp(counterpoint, 0);
            this.rhythmic = clamp(rhythmic, 0); this.arpeggio = clamp(arpeggio, 0);
            this.density = clamp(density, .5); this.complexity = clamp(complexity, .5); this.swing = clamp(swing, 0);
            this.bpm = Double.isFinite(bpm) ? Math.max(30, Math.min(180, Math.round(bpm))) : 72;
            this.polyphony = polyphony == 8 || polyphony == 24 || polyphony == 32 ? polyphony : 16;
            this.melodyEnabled = melodyEnabled;
            this.drumsEnabled = drumsEnabled;
            this.kick = clamp(kick, .65); this.snare = clamp(snare, .4);
            this.hihat = clamp(hihat, .3); this.toms = clamp(toms, .35); this.cymbal = clamp(cymbal, .2);
            drums = new double[] {this.kick, this.snare, this.hihat, this.toms, this.cymbal};
            layers = new double[] {this.pad, this.pluck, this.bell, this.texture, this.pulse};
            environment = new EnvironmentAudio.Parameters(this.rainType, this.rain, this.thunder, this.wind);
        }
        public static double legacyWeight(int composition, int style) {
            return Math.max(0, Math.min(3, composition)) == style ? 1 : 0;
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
     * 0 pad, 1 pluck, 2 bell, 3 texture, 4 pulse, and 5..9 drum kit.
     * Each event includes an exact
     * note-off duration. Evolution zero visits three related harmonies in the
     * first three hours. The unsigned 32-bit LCG matches JavaScript Math.imul.
     */
    public static final class EventScore {
        public final int rate;
        public long seed;
        public long next, step, chordAge, padAt, textureAt, melodyAt, chordChanges, eventCount;
        public int chord;
        private int state;
        private long tick, variant;
        private double beatNext;
        private int lastBass = 38, lastTop = 69;
        private final int[] compositionChord = new int[4];
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
            chord = 0; tick = 0; beatNext = 0; lastBass = 38; lastTop = 69;
            variant = (((int) seed ^ 0x9e3779b9) * 0x9e3779b1) & 0xffffffffL;
        }
        public void reseed(long seed) { this.seed = seed & 0xffffffffL; reset(); }
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
        /** Knob-only composition: four additive style weights share one musical clock. */
        public void advanceTo(long frame, Parameters p, NoteSink sink) {
            if (p == null || sink == null) throw new IllegalArgumentException("parameters and note sink required");
            double ambient = p.ambient, counterpoint = p.counterpoint, rhythmic = p.rhythmic, arpeggio = p.arpeggio;
            double drive = Math.max(counterpoint, Math.max(rhythmic, arpeggio));
            double density = p.density, complexity = p.complexity, swing = p.swing;
            double norm = StrictMath.sqrt(Math.max(1, ambient + counterpoint + rhythmic + arpeggio));
            while (Math.round(beatNext) <= frame) {
                long at = Math.round(beatNext), currentTick = tick++, bar = currentTick / 8;
                int beat = (int) (currentTick % 8);
                long phrase = bar / 8;
                double seconds = 60 / p.bpm;
                int root = 50 + (int) (seed % 6);
                int[] progression = PROGRESSIONS[(int) ((variant >>> 20) % 4)];
                double ratio = ambient / Math.max(.001, ambient + drive);
                int chordSpan = 1 + (int) StrictMath.floor(3 * ratio);
                double ambientBeats = 3600 / seconds * StrictMath.pow(16 * seconds / 3600, p.evolution);
                int ambientChord = (int) (StrictMath.floor(currentTick * .5 / ambientBeats + 1e-9) % 3);
                int chordDegree = drive == 0 ? (ambientChord == 0 ? 0 : ambientChord == 1 ? 2 : 3)
                        : progression[(int) ((bar / chordSpan) % 8)];
                boolean changed = chordDegree != chord;
                if (changed) { chord = chordDegree; chordChanges++; }
                int chordSize = drive == 0 ? 4 : 3;
                for (int j = 0; j < chordSize; j++) compositionChord[j] = drive == 0
                        ? CHORDS[ambientChord][j] + (int) (seed % 6) : root + degree(chordDegree + j * 2);
                if ((beat == 0 && bar % chordSpan == 0) || (drive == 0 && changed)) {
                    for (int j = 0; j < chordSize; j++) {
                        int n = compositionChord[j];
                        while (n > 70) n -= 12; while (n < 50) n += 12;
                        emitWeighted(sink, at, 0, n, (3.3 + 10.7 * ratio) * seconds,
                                (.53 + .12 * random()) * (ambient + drive * .55), norm);
                    }
                    int bass = compositionChord[0] - 12;
                    while (bass - lastBass > 7) bass -= 12; while (bass - lastBass < -7) bass += 12;
                    while (bass < 33) bass += 12; while (bass > 52) bass -= 12;
                    lastBass = bass;
                    emitWeighted(sink, at, 4, bass, (1.6 + 1.9 * ratio) * seconds, .72 * Math.max(ambient, drive), norm);
                }
                if (currentTick % 32 == 0) emitWeighted(sink, at, 3, compositionChord[1] + 12,
                        12 * seconds, .32 * Math.max(ambient, drive * .4), norm);
                double chance = (((int) (currentTick + 1) * ((int) variant | 1)) & 0xffffffffL) / 4294967296.0;
                boolean activeBeat = chance < .2 + .8 * density;
                if (p.melodyEnabled) {
                    int section = complexity < .25 ? 0 : FORM[(int) (phrase % 8)];
                    int rotation = (int) StrictMath.floor((((variant >>> 4) % 8) + section * 2) * complexity * 2);
                    int motifIndex = (int) ((currentTick + rotation) % 8);
                    int motif = complexity < .25 ? SIMPLE_MOTIF[motifIndex] : MOTIFS[(int) ((variant + section) % 8)][motifIndex];
                    int direction = complexity > .5 && (((variant >>> 7) & 1) ^ (section == 2 ? 1 : 0)) != 0 ? -1 : 1;
                    int chordTone = (int) ((beat / 2 + (variant >>> 9) % 3 + section) % 3) * 2;
                    int d = chordDegree + (beat % 2 == 0 ? chordTone : direction * motif);
                    if (section == 3 && bar % 8 == 7 && beat >= 6) d = chordDegree;
                    int top = root + 12 + degree(d);
                    while (top > 86) top -= 12; while (top < 62) top += 12;
                    if (top - lastTop > 9 && top - 12 >= 60) top -= 12;
                    if (lastTop - top > 9 && top + 12 <= 86) top += 12;
                    if (ambient > 0) {
                        if (currentTick % 8 == ((variant >>> 12) & 3) * 2 && activeBeat) {
                            emitWeighted(sink, at, 1, top, 2.6 * seconds, .58 * ambient, norm); lastTop = top;
                        }
                        if (currentTick % 16 == 6 + ((variant >>> 14) & 3) * 2 && activeBeat)
                            emitWeighted(sink, at, 2, compositionChord[2] + 12, 4 * seconds, .4 * ambient, norm);
                    }
                    if (counterpoint > 0 && activeBeat) {
                        emitWeighted(sink, at, 1, top, (beat == 7 ? .85 : .43) * seconds,
                                (.58 + (beat % 2 == 0 ? .12 : 0)) * counterpoint, norm); lastTop = top;
                        if (beat % 2 == (complexity > .4 ? ((variant >>> 10) & 1) : 0))
                            emitWeighted(sink, at, 2, root + degree(chordDegree + COUNTER_MOTIF[
                                    (int) ((beat / 2 + section + (variant >>> 11) % 4) % 4)]), .88 * seconds, .42 * counterpoint, norm);
                        if (beat == 4) emitWeighted(sink, at, 4, compositionChord[2] - 12, 1.7 * seconds, .58 * counterpoint, norm);
                    }
                    if (rhythmic > 0) {
                        if (activeBeat && (((complexity < .25 ? 0x55 : RHYTHMS[(int) ((variant + section) % 8)]) & (1 << beat)) != 0)) {
                            emitWeighted(sink, at, 1, top, .38 * seconds, .72 * rhythmic, norm); lastTop = top;
                        }
                        if (beat % 2 == 0) emitWeighted(sink, at, 4, compositionChord[0] - 12, .65 * seconds, .72 * rhythmic, norm);
                        if (beat == 6 && activeBeat) emitWeighted(sink, at, 2, compositionChord[2] + 12, .8 * seconds, .4 * rhythmic, norm);
                    }
                    if (arpeggio > 0 && activeBeat) {
                        int[] order = ARPS[complexity < .25 ? 0 : (int) ((variant + section) % 6)];
                        int n = compositionChord[order[(int) ((currentTick + phrase / 2) % 3)]]
                                + ((currentTick + ((variant >>> 15) & 3)) % 4 == 3 && complexity > .35 ? 24 : 12);
                        emitWeighted(sink, at, 1, n, .7 * seconds, (.52 + .18 * random()) * arpeggio, norm); lastTop = n;
                        if (beat == 4) emitWeighted(sink, at, 2, top, 1.8 * seconds, .4 * arpeggio, norm);
                    }
                }
                if (p.drumsEnabled) {
                    if (beat == 0 || beat == 4 || (rhythmic > .4 && beat == 5 && complexity > .4))
                        emitWeighted(sink, at, 5, 36, .25 * seconds, .82, norm);
                    if (beat == 2 || beat == 6) emitWeighted(sink, at, 6, 38, .22 * seconds, .66, norm);
                    if (chance < .35 + .65 * density) emitWeighted(sink, at, 7, 42, .12 * seconds, beat % 2 == 0 ? .45 : .27, norm);
                    if (bar % 8 == 7 && beat >= 5 && complexity > .35) emitWeighted(sink, at, 8, 45 + (7 - beat) * 2, .3 * seconds, .55, norm);
                    if (bar % 8 == 0 && beat == 0) emitWeighted(sink, at, 9, 49, 1.8 * seconds, .42, norm);
                }
                // Alternating eighth lengths sum to exactly one beat.
                beatNext += rate * seconds * (.5 + (currentTick % 2 == 0 ? 1 : -1) * .22 * swing);
                next = Math.round(beatNext); step = tick;
            }
        }
        private void emitWeighted(NoteSink sink, long frame, int instrument, int pitch, double seconds,
                                  double velocity, double norm) {
            if (velocity > 0) emit(sink, frame, instrument, pitch, seconds, Math.min(1, velocity / norm));
        }
        private static int degree(int d) { return SCALE[Math.floorMod(d, 7)] + 12 * Math.floorDiv(d, 7); }
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
    private final DrumVoice[] drumVoices = new DrumVoice[12];
    // Constructor-only bank selection. Never publish the mutable, render-owned pool.
    private final LiveDrumPool recordedDrums;
    private final LiveMelodicPool recordedMelodies;
    private final boolean synthesizedBed, evolvingTimbre;
    private final EventScore score;
    private final DevelopmentScore developmentScore;
    private final EnvironmentAudio environment;
    private final RecordedWeather recordedWeather;
    private final NoteHistory noteHistory = new NoteHistory();
    /** Generated score events, including notes suppressed by voice limits or mix levels. */
    public String getScoreSnapshot() { return noteHistory.json(sampleRate); }
    private static final class NoteHistory {
        private final double[][] events = new double[512][5];
        private int start, count;
        private long clock, seed;
        synchronized void clear(long newSeed) { start = count = 0; clock = 0; seed=newSeed & 0xffffffffL; }
        synchronized void clock(long frame) { clock = frame; }
        synchronized void add(long frame, int instrument, int pitch, long duration, double velocity) {
            int index = (start + count) % events.length;
            if (count == events.length) start = (start + 1) % events.length; else count++;
            double[] e = events[index]; e[0]=frame; e[1]=instrument; e[2]=pitch; e[3]=duration; e[4]=velocity;
            clock = frame;
        }
        String json(int rate) {
            double[][] copy = new double[512][5];
            int length; long snapshotFrame, snapshotSeed;
            synchronized(this) {
                length=count; snapshotFrame=clock; snapshotSeed=seed;
                for(int i=0;i<length;i++) System.arraycopy(events[(start+i)%events.length],0,copy[i],0,5);
            }
            StringBuilder out = new StringBuilder(32768);
            out.append("{\"seed\":").append(snapshotSeed).append(",\"frame\":").append(snapshotFrame).append(",\"rate\":").append(rate).append(",\"events\":[");
            for (int i=0;i<length;i++) {
                if(i>0) out.append(','); out.append('[');
                double[] e=copy[i];
                for(int j=0;j<5;j++){ if(j>0)out.append(',');out.append(e[j]); }
                out.append(']');
            }
            return out.append("]}").toString();
        }
    }
    private final NoteSink noteSink = this::noteOn;
    private final double[] layerGains = {.65, .55, .35, .20, .15};
    private final double[] drumGains = {.65, .4, .3, .35, .2};
    private final double[] melodicGains = new double[5];
    private final double smoothing, drumSmoothing, dcPole;
    private final double noisePole;
    private double evolution;
    private volatile Parameters parameters = Parameters.DEFAULT;
    private volatile boolean requestedPlaying;
    private double intensity = .5, brightness = .45, motion = .35, timbre = .5;
    private double melodyGain = 1, drumsGain;
    private boolean reseeding;
    private double seedGain = 1;
    private long pendingSeed;
    private int voiceLimit = 16;
    private int drumState;
    private double fade, previousL, previousR, dcL, dcR, outputL, outputR;
    private long frame, noteOnCount, noteOffCount, droppedNotes;
    // Lifetime routing totals survive pool tail resets/reseeds; engine.reset clears them.
    private long recordedMelodicAccepted, recordedMelodicDropped, recordedMelodicUnmapped, melodicFallbacks;

    private static final class Voice {
        boolean active, off;
        double phase, phaseB, phaseC, frequency, velocity, panL, panR, filtered, noiseLow;
        int noiseState;
        long age, duration, release;
        int retire;
        int instrument, midi;
    }

    private static final class DrumVoice {
        boolean active, off;
        int instrument;
        long age, duration, release;
        double phase, phaseB, velocity, panL, panR, low, noise;
    }

    public AmbientEngine(int sampleRate) { this(sampleRate, 1); }
    public AmbientEngine(int sampleRate, long seed) { this(sampleRate, seed, null); }

    /**
     * Opt-in recorded percussion. The immutable bank must already contain PCM at
     * this exact rate; decoding/preparation and pool compilation happen before
     * rendering. Null keeps the original procedural drum path bit-for-bit.
     * Bank selection cannot change while the engine is rendering.
     */
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank) {
        this(sampleRate, seed, drumBank, false);
    }

    /** Score selection is fixed for the session; existing constructors preserve the original score. */
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank, boolean developing) {
        this(sampleRate, seed, drumBank, null, developing, null);
    }

    /** Prepared bank selection is fixed per session. Null melody keeps the old PCM path. */
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank,
                         LiveMelodicPool.Bank melodicBank, boolean developing) {
        this(sampleRate, seed, drumBank, melodicBank, developing, null);
    }

    /** New native sessions use the developing score, with default configuration when null. */
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank,
                         LiveMelodicPool.Bank melodicBank, DevelopmentConfig developmentConfig) {
        this(sampleRate, seed, drumBank, melodicBank, true, developmentConfig);
    }

    /** No decode, PCM copy or table preparation occurs here or during rendering. */
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank,
                         LiveMelodicPool.Bank melodicBank, boolean developing,
                         DevelopmentConfig developmentConfig) {
        this(sampleRate, seed, drumBank, melodicBank, developing, developmentConfig, false, false);
    }

    /** Explicit hybrid palettes retain synthesis for pad/texture/bass; legacy constructors stay unchanged. */
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank,
                         LiveMelodicPool.Bank melodicBank, boolean developing,
                         DevelopmentConfig developmentConfig, boolean synthesizedBed, boolean evolvingTimbre) {
        this(sampleRate, seed, drumBank, melodicBank, developing, developmentConfig, synthesizedBed, evolvingTimbre, null);
    }
    public AmbientEngine(int sampleRate, long seed, LiveDrumPool.Bank drumBank,
                         LiveMelodicPool.Bank melodicBank, boolean developing,
                         DevelopmentConfig developmentConfig, boolean synthesizedBed, boolean evolvingTimbre, RecordedWeather.Bank weatherBank) {
        if (sampleRate < 8000 || sampleRate > 192000)
            throw new IllegalArgumentException("sampleRate must be 8000..192000");
        this.sampleRate = sampleRate;
        this.synthesizedBed = synthesizedBed;
        this.evolvingTimbre = evolvingTimbre;
        noisePole = 1 - StrictMath.exp(-2 * StrictMath.PI * 1100 / sampleRate);
        if (melodicBank != null && melodicBank.sampleRate != sampleRate)
            throw new IllegalArgumentException("melodic bank sampleRate must match engine");
        recordedMelodies = melodicBank == null ? null : new LiveMelodicPool(melodicBank, 32);
        if (recordedMelodies != null) recordedMelodies.setVoiceLimit(voiceLimit);
        recordedDrums = drumBank == null ? null : new LiveDrumPool(sampleRate, drumBank);
        if (recordedDrums != null) recordedDrums.setEnabled(parameters.drumsEnabled);
        macros = new MacroBus(sampleRate);
        score = new EventScore(sampleRate, seed);
        developmentScore = developing ? new DevelopmentScore(sampleRate, seed,
                developmentConfig == null ? DevelopmentConfig.DEFAULT : developmentConfig) : null;
        noteHistory.clear(seed);
        environment = new EnvironmentAudio(sampleRate, seed);
        recordedWeather = weatherBank == null ? null : new RecordedWeather(sampleRate, seed, weatherBank);
        smoothing = 1.0 - StrictMath.exp(-1.0 / (sampleRate * 1.5));
        drumSmoothing = 1.0 - StrictMath.exp(-1.0 / (sampleRate * .05));
        dcPole = StrictMath.exp(-2.0 * StrictMath.PI * 12.0 / sampleRate);
        for (int i = 0; i < voices.length; i++) voices[i] = new Voice();
        for (int i = 0; i < drumVoices.length; i++) drumVoices[i] = new DrumVoice();
        drumState = (int) seed ^ 0x7f4a7c15;
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
    public DevelopmentScore getDevelopmentScore() { return developmentScore; }
    public int getActiveVoiceCount() {
        int n = recordedMelodies == null ? 0 : recordedMelodies.getActiveVoices();
        for (Voice v : voices) if (v.active) n++;
        return n;
    }
    public int getActiveRecordedMelodicVoiceCount() { return recordedMelodies == null ? 0 : recordedMelodies.getActiveVoices(); }
    public long getRecordedMelodicAcceptedCount() { return recordedMelodicAccepted; }
    /** Muted/disabled/full-pool events, never oscillator fallbacks. */
    public long getRecordedMelodicDroppedCount() { return recordedMelodicDropped; }
    /** Missing pitch/velocity mappings only. */
    public long getRecordedMelodicUnmappedCount() { return recordedMelodicUnmapped; }
    /** Missing mappings successfully admitted to the legacy oscillator pool. */
    public long getMelodicFallbackCount() { return melodicFallbacks; }
    public int getActiveDrumVoiceCount() {
        if (recordedDrums != null) return recordedDrums.getActiveVoices();
        int n = 0; for (DrumVoice v : drumVoices) if (v.active) n++; return n;
    }

    /** Audio-thread operation: coalesced reseeds fade out in at most 80ms.
     * Transport, control targets and the service's session timer are unchanged. */
    public void reseed(long seed) {
        pendingSeed = seed & 0xffffffffL;
        reseeding = true;
        if (fade == 0) { seedGain = 0; applyReseed(); }
    }
    private void applyReseed() {
        noteHistory.clear(pendingSeed);
        score.reseed(pendingSeed);
        if (recordedWeather != null) { recordedWeather.reseed(pendingSeed); if (requestedPlaying) recordedWeather.start(); }
        if (developmentScore != null) developmentScore.reseed(pendingSeed);
        frame = 0;
        for (Voice v : voices) { if (v.active && !v.off) noteOffCount++; v.active = false; }
        for (DrumVoice v : drumVoices) { if (v.active && !v.off) noteOffCount++; v.active = false; }
        clearRecordedDrums();
        clearRecordedMelodies();
        drumState = (int) pendingSeed ^ 0x7f4a7c15;
        // Weather clocks and the shared space tail continue across musical reseeds.
        reseeding = false;
    }

    /** Use from the audio thread only. True once the fade has reached silence. */
    public boolean isSilent() { return fade == 0.0 && !requestedPlaying; }

    /** Rendering-thread reset: clears voices and tails, preserves control targets. */
    public void reset() {
        requestedPlaying = false;
        fade = 0;
        frame = 0;
        score.reset();
        if (developmentScore != null) developmentScore.reset();
        noteHistory.clear(score.seed);
        for (Voice v : voices) v.active = false;
        for (DrumVoice v : drumVoices) v.active = false;
        if (recordedDrums != null) {
            recordedDrums.reset();
            recordedDrums.setEnabled(parameters.drumsEnabled);
        }
        if (recordedMelodies != null) {
            recordedMelodies.reset();
            recordedMelodies.setEnabled(false);
            recordedMelodies.setMelodyEnabled(parameters.melodyEnabled);
            recordedMelodies.setVoiceLimit(parameters.polyphony);
        }
        recordedMelodicAccepted = recordedMelodicDropped = recordedMelodicUnmapped = melodicFallbacks = 0;
        drumState = (int) score.seed ^ 0x7f4a7c15;
        reseeding = false;
        seedGain = 1;
        environment.reset();
        if (recordedWeather != null) recordedWeather.reset();
        macros.reset();
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
        noteHistory.clock(frame);
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
        noteHistory.clock(frame);
    }

    /** Publish one coherent control/transport snapshot for the entire block. */
    private void prepareEnvironment(Parameters target, boolean playing) {
        environment.setParameters(target.environment);
        if (playing) environment.start(); else environment.stop();
        if (recordedWeather != null) { recordedWeather.setParameters(target.environment); if (playing) recordedWeather.start(); else recordedWeather.stop(); }
        if (recordedMelodies != null) {
            recordedMelodies.setEnabled(playing);
            recordedMelodies.setMelodyEnabled(target.melodyEnabled);
            recordedMelodies.setVoiceLimit(target.polyphony);
        }
        if (recordedDrums != null) {
            // Control calls only publish volatile targets; pool writes stay here.
            recordedDrums.setEnabled(target.drumsEnabled);
            if (!playing) recordedDrums.stop();
        }
    }

    private static void checkRange(int length, int offset, int frames) {
        if (length < 0 || offset < 0 || frames < 0 || offset > length
                || frames > (length - offset) / 2)
            throw new IllegalArgumentException("invalid stereo buffer range");
    }

    private void noteOn(long at, int instrument, int pitch, long duration,
                        double velocity, double pan) {
        noteHistory.add(at, instrument, pitch, duration, velocity);
        if (instrument >= 5) {
            if (recordedDrums == null) drumOn(instrument - 5, duration, velocity, pan);
            else if (recordedDrums.trigger(instrument, pitch, velocity, pan)) noteOnCount++;
            else droppedNotes++;
            return;
        }
        boolean melodicFallback = false;
        if (recordedMelodies != null && !(synthesizedBed && (instrument == 0 || instrument == 3 || instrument == 4))) {
            // Sampler and missing-range oscillator fallbacks share one melodic budget.
            if (getActiveVoiceCount() >= voiceLimit) {
                recordedMelodicDropped++; droppedNotes++; return;
            }
            long unmappedBefore = recordedMelodies.unmapped;
            if (recordedMelodies.trigger(instrument, pitch, duration / (double) sampleRate, velocity, pan)) {
                recordedMelodicAccepted++; noteOnCount++; return;
            }
            if (recordedMelodies.unmapped == unmappedBefore) {
                recordedMelodicDropped++; droppedNotes++; return;
            }
            recordedMelodicUnmapped++;
            melodicFallback = true;
            // Only an actual missing mapping can take the original-pitch fallback.
        }
        Voice v = null;
        int active = recordedMelodies == null ? 0 : recordedMelodies.getActiveVoices();
        for (int i = 0; i < voices.length; i++) {
            if (voices[i].active) active++;
            else if (v == null) v = voices[i];
        }
        if (v == null || active >= voiceLimit) { droppedNotes++; return; }
        v.active = true;
        v.off = false;
        v.retire = 0;
        v.phase = v.phaseB = v.phaseC = v.filtered = v.noiseLow = 0;
        v.noiseState = (int) (score.seed + noteOnCount * 1664525);
        v.age = 0;
        v.duration = duration;
        v.release = Math.round(sampleRate * (instrument == 0 ? 4 : instrument == 3 ? 2 : .3));
        v.instrument = instrument;
        v.frequency = 440 * StrictMath.pow(2, (pitch - 69) / 12.0);
        v.midi = pitch;
        v.velocity = velocity;
        v.panL = StrictMath.sqrt(1 - pan);
        v.panR = StrictMath.sqrt(pan);
        noteOnCount++;
        if (melodicFallback) melodicFallbacks++;
    }

    private void drumOn(int instrument, long duration, double velocity, double pan) {
        if (instrument < 0 || instrument >= 5) return;
        DrumVoice v = null;
        for (DrumVoice candidate : drumVoices) if (!candidate.active) { v = candidate; break; }
        if (v == null) { droppedNotes++; return; } // Separate fixed pool never steals a melodic voice.
        v.active = true; v.off = false; v.instrument = instrument; v.age = 0;
        v.duration = Math.max(1, duration); v.release = Math.max(1, Math.round(sampleRate * .08)); v.phase = v.phaseB = v.low = v.noise = 0;
        v.velocity = velocity;
        v.panL = StrictMath.sqrt(1 - pan); v.panR = StrictMath.sqrt(pan);
        noteOnCount++;
    }
    private double noise() {
        drumState = drumState * 1664525 + 1013904223;
        return (drumState & 0xffffffffL) / 2147483648.0 - 1;
    }
    private void next(Parameters target, boolean playing) {
        intensity += smoothing * (target.intensity - intensity);
        brightness += smoothing * (target.brightness - brightness);
        motion += smoothing * (target.motion - motion);
        timbre += smoothing * (target.timbre - timbre);
        evolution += smoothing * (target.evolution - evolution);
        for (int i = 0; i < layerGains.length; i++) {
            layerGains[i] += smoothing * (target.layers[i] - layerGains[i]);
            drumGains[i] += drumSmoothing * (target.drums[i] - drumGains[i]);
        }
        double muteSmooth = 1.0 / (sampleRate * .025);
        melodyGain += muteSmooth * ((target.melodyEnabled ? 1 : 0) - melodyGain);
        drumsGain += muteSmooth * ((target.drumsEnabled ? 1 : 0) - drumsGain);
        if (voiceLimit != target.polyphony) {
            voiceLimit = target.polyphony;
            int allowed = voiceLimit - (recordedMelodies == null ? 0 : recordedMelodies.getActiveVoices());
            for (Voice v : voices) if (v.active && v.retire == 0 && --allowed < 0)
                v.retire = Math.max(1, (int) (sampleRate * .08));
        }
        if (reseeding) {
            seedGain = Math.max(0, seedGain - 1.0 / (sampleRate * .08));
            if (seedGain < 1e-12 || (!playing && fade == 0)) { seedGain = 0; applyReseed(); }
        } else seedGain = Math.min(1, seedGain + 1.0 / (sampleRate * .08));
        if (!playing && fade == 0) { outputL = outputR = 0; return; }
        if (developmentScore != null) {
            if (playing) developmentScore.advanceTo(frame, target, noteSink);
            else { developmentScore.beatNext++; developmentScore.next = Math.round(developmentScore.beatNext); }
        } else if (playing) score.advanceTo(frame, target, noteSink);
        else { score.beatNext++; score.next = Math.round(score.beatNext); }
        final double tone = 1 - StrictMath.exp(-2 * StrictMath.PI * (900 + brightness * 4200) / sampleRate);
        double left = 0, right = 0;
        for (int i = 0; i < voices.length; i++) {
            Voice v = voices[i];
            if (!v.active) continue;
            if ((v.instrument == 1 || v.instrument == 2) && !target.melodyEnabled && !v.off) {
                v.duration = v.age; v.release = Math.min(v.release, Math.max(1, Math.round(sampleRate * .08)));
            }
            if (v.age >= v.duration && !v.off) { v.off = true; noteOffCount++; }
            if (v.age >= v.duration + v.release) { v.active = false; continue; }
            double t = v.age / (double) sampleRate, p = v.phase;
            int k = v.instrument;
            double morph = evolvingTimbre ? evolution : 0;
            double attack = k == 0 ? 3 : k == 3 ? 5 : k == 2 ? .04 : k == 1 ? .025 + .01 * morph : .05;
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
                value = (sine(p) * .76 + sine(v.phaseB) * .24 + h2 * (.10 + .11 * brightness) + h3 * .035)
                        * (.86 + .14 * sine(t * .055)) * .075;
            else if (k == 1)
                value = (sine(p) + h2 * .24 + h3 * .08 + sine(v.phaseB) * .16)
                        * StrictMath.exp(-t / (.65 + .7 * timbre)) * .19;
            else if (k == 2) {
                double metallic = v.frequency * 2.71 < sampleRate * .45 ? sine(v.phaseB) : 0;
                value = (sine(p) * StrictMath.exp(-t / 2.8)
                        + metallic * .18 * StrictMath.exp(-t / .8)) * .15;
            } else if (k == 3)
                value = (sine(p) + sine(v.phaseB) * .5) * (.6 + .4 * sine(t * .11)) * .04;
            else value = (sine(p) + h2 * .15) * StrictMath.exp(-t / .65) * .17;
            if (morph > 0) {
                // Identical bounded spectral motion to the browser voice path.
                double clock = frame / (double) sampleRate, seedPhase = (score.seed % 997) / 997.0;
                double a = .5 + .5 * sine(clock * (.025 + .035 * motion) + seedPhase + v.midi * .007 + k * .19);
                double b = .5 + .5 * sine(clock * .047 + seedPhase * .73 + v.midi * .013);
                double h4 = v.frequency * 4 < sampleRate * .45 ? sine(p * 4) : 0;
                double h5 = v.frequency * 5 < sampleRate * .45 ? sine(p * 5) : 0;
                v.noiseState = v.noiseState * 1664525 + 1013904223;
                v.noiseLow += noisePole * ((v.noiseState & 0xffffffffL) / 2147483648.0 - 1 - v.noiseLow);
                double fundamental = sine(p), body = sine(v.phaseC), rich;
                if (k == 0)
                    rich = (fundamental * (.57 + .13 * a) + sine(v.phaseB) * (.19 + .10 * b)
                            + h2 * (.04 + .42 * a) + h3 * (.015 + .22 * b) + h4 * (.015 + .12 * a * (1 - b))
                            + h5 * .05 * b + v.noiseLow * .05) * (.86 + .14 * sine(t * .055)) * .075;
                else if (k == 1)
                    rich = (fundamental * (.62 + .12 * a) + sine(v.phaseB) * (.12 + .08 * b) + body * .25
                            + h2 * (.18 + .12 * b) + h3 * (.04 + .06 * a) + v.noiseLow * .055)
                            * StrictMath.exp(-t / (.65 + .7 * timbre)) * .19;
                else if (k == 2) {
                    double metallic = v.frequency * 2.71 < sampleRate * .45 ? sine(v.phaseB) : 0;
                    rich = ((fundamental * .70 + body * .25 + h2 * .13 * a) * StrictMath.exp(-t / 2.8)
                            + metallic * .07 * StrictMath.exp(-t / .8) + v.noiseLow * .035 * StrictMath.exp(-t / 1.2)) * .15;
                } else if (k == 3)
                    rich = (fundamental * (.65 + .2 * b) + sine(v.phaseB) * (.34 + .18 * a)
                            + h2 * (.08 + .12 * (1 - a)) + h3 * .09 * b + v.noiseLow * .08) * (.6 + .4 * sine(t * .11)) * .04;
                else rich = (fundamental * (.75 + .1 * a) + body * .20 + h2 * (.1 + .12 * b)
                            + h3 * .04 + v.noiseLow * .025) * StrictMath.exp(-t / .65) * .17;
                value += morph * (rich - value);
            }
            // Gentle per-voice lowpass rounds the additive attack spectra.
            v.filtered += tone * (value - v.filtered);
            value = v.filtered;
            value *= envelope * v.velocity * layerGains[k] * ((k == 1 || k == 2) ? melodyGain : 1);
            if (v.retire > 0) {
                value *= v.retire / Math.max(1.0, sampleRate * .08);
                if (--v.retire == 0) { if (!v.off) noteOffCount++; v.active = false; }
            }
            left += value * v.panL;
            right += value * v.panR;
            double increment = v.frequency * (1 + .0015 * motion * sine(t * .23)) / sampleRate;
            v.phase = wrap(v.phase + increment);
            v.phaseB = wrap(v.phaseB + increment * (k == 2 ? 2.71 : 1.003));
            v.phaseC = wrap(v.phaseC + increment * .5);
            v.age++;
        }
        for (DrumVoice v : drumVoices) {
            if (!v.active) continue;
            if (!target.drumsEnabled && !v.off) v.duration = Math.min(v.duration, v.age);
            if (v.age >= v.duration && !v.off) { v.off = true; noteOffCount++; }
            if (v.age >= v.duration + v.release) { v.active = false; continue; }
            double t = v.age / (double) sampleRate;
            double n = noise();
            v.low += .12 * (n - v.low);
            // Smoothed noise and finite raised-cosine edges keep every hit bounded.
            v.noise += .55 * (n - v.noise);
            int k = v.instrument;
            double frequency, value;
            if (k == 0) {
                frequency = 46 + 90 * StrictMath.exp(-t * 30);
                value = sine(v.phase) * StrictMath.exp(-t * 7) * .30;
            } else if (k == 1) {
                frequency = 175;
                value = (sine(v.phase) * .32 + (v.noise - v.low) * .68) * StrictMath.exp(-t * 16) * .23;
            } else if (k == 2) {
                frequency = 3100;
                value = (v.noise - v.low) * StrictMath.exp(-t * 42) * .14;
            } else if (k == 3) {
                frequency = 86 + 42 * StrictMath.exp(-t * 20);
                value = (sine(v.phase) + sine(v.phaseB) * .15) * StrictMath.exp(-t * 9) * .22;
            } else {
                frequency = Math.min(sampleRate * .12, 2700);
                value = ((v.noise - v.low) * .8 + sine(v.phase) * .12 + sine(v.phaseB) * .08)
                        * StrictMath.exp(-t * 2.2) * .12;
            }
            double attack = Math.min(1, t / .004);
            double end = v.off ? Math.max(0, 1 - (v.age - v.duration) / (double) v.release) : 1;
            value *= attack * attack * (3 - 2 * attack) * end * end * (3 - 2 * end)
                    * v.velocity * drumGains[k] * drumsGain;
            left += value * v.panL; right += value * v.panR;
            v.phase = wrap(v.phase + frequency / sampleRate);
            v.phaseB = wrap(v.phaseB + frequency * 1.413 / sampleRate);
            v.age++;
        }
        if (recordedMelodies != null) {
            for (int i = 0; i < melodicGains.length; i++)
                melodicGains[i] = layerGains[i] * ((i == 1 || i == 2) ? melodyGain : 1);
            int before = recordedMelodies.getActiveVoices();
            recordedMelodies.next(melodicGains, playing, evolvingTimbre ? evolution : 0, frame, score.seed);
            // Sample release/finite tails retire independently of the exported gate.
            noteOffCount += before - recordedMelodies.getActiveVoices();
            left += recordedMelodies.outputL;
            right += recordedMelodies.outputR;
        }
        left *= 1 + intensity * 1.4;
        right *= 1 + intensity * 1.4;
        if (recordedWeather == null) environment.next();
        else { recordedWeather.next(); environment.outputL = recordedWeather.outputL; environment.outputR = recordedWeather.outputR; }
        if (recordedDrums == null) {
            macros.process(left + environment.outputL, right + environment.outputR, target);
        } else {
            int before = recordedDrums.getActiveVoices();
            recordedDrums.next(drumGains);
            // One-shots retire at their natural/choked/released end, not the
            // score gate. The original event duration remains in score export.
            noteOffCount += before - recordedDrums.getActiveVoices();
            double level = 1 + intensity * 1.4;
            macros.process(left + environment.outputL + recordedDrums.getOutputL() * level,
                    right + environment.outputR + recordedDrums.getOutputR() * level, target);
        }
        left = macros.left;
        right = macros.right;
        dcL = left - previousL + dcPole * dcL;
        dcR = right - previousR + dcPole * dcR;
        previousL = left;
        previousR = right;
        outputL = .85 * dcL / (1 + Math.abs(dcL)) * fade * seedGain;
        outputR = .85 * dcR / (1 + Math.abs(dcR)) * fade * seedGain;
        double fadeStep = 1.0 / (FADE_SECONDS * sampleRate);
        fade = playing ? Math.min(1, fade + fadeStep) : Math.max(0, fade - fadeStep);
        if (fade < 1e-12 && !playing) {
            fade = 0;
            // Even a one-frame start/stop must not freeze a sample tail that
            // could return on restart after the transport has become silent.
            if (recordedDrums != null && recordedDrums.getActiveVoices() != 0) clearRecordedDrums();
            if (recordedMelodies != null && recordedMelodies.getActiveVoices() != 0) clearRecordedMelodies();
        }
        frame++;
    }

    private void clearRecordedMelodies() {
        if (recordedMelodies != null) {
            noteOffCount += recordedMelodies.getActiveVoices();
            recordedMelodies.reset(); // Keeps this block's enable, melody and limit states.
        }
    }

    private void clearRecordedDrums() {
        if (recordedDrums != null) {
            noteOffCount += recordedDrums.getActiveVoices();
            recordedDrums.reset(); // Preserves the block snapshot's enable state.
        }
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
        /** Clear delay tails in place; control smoothing remains continuous. */
        public void reset() {
            warmth = strength = wash = 0; width = .5;
            lowL = lowR = left = right = 0;
            for (int i = 0; i < lines.length; i++) {
                java.util.Arrays.fill(lines[i], 0); pos[i] = 0; filtered[i] = 0;
            }
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
