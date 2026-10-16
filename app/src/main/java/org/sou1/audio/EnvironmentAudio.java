// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

/** Original sample-free weather. One render thread owns DSP state. Controls may
 * be updated on another thread. No rendering allocations. Mix callers must
 * limit their final combined output. Reset must run on the rendering thread. */
public final class EnvironmentAudio {
    public static final class Parameters {
        public final int rainType;
        public final double rain, thunder, wind;
        public Parameters(int rainType, double rain, double thunder, double wind) {
            this.rainType = Math.max(0, Math.min(3, rainType));
            this.rain = clamp(rain, 0); this.thunder = clamp(thunder, 0); this.wind = clamp(wind, 0);
        }
    }
    private final int sampleRate, seed;
    private final double smoothing, rainPole, windPole, thunderPole, dcPole;
    private final double noiseScale, airPole, dropFast, dropSlow, dropDamp;
    private final double[] dropDrive = new double[24];
    private final double[] dropA = new double[24], dropB = new double[24], dropPan = new double[24], dropTone = new double[24], dropY = new double[24], dropZ = new double[24];
    private final double[] rollDelay = new double[7], rollDuration = new double[7], rollGain = new double[7];
    private int dropIndex;
    private double airL, airR, crackL, crackR, rainFineL, rainFineR;
    private volatile Parameters parameters = new Parameters(0, 0, 0, 0);
    private volatile boolean playing;
    private int rainState, windState, thunderState, gustCountdown, thunderCountdown, rollAge, rollLength;
    private double light, steady, heavy, wind, thunder, rainL, rainR, windL, windR, windDcL, windDcR;
    private double rumbleL, rumbleR, rumbleDcL, rumbleDcR, gust, gustTarget;
    public double outputL, outputR;
    public EnvironmentAudio(int sampleRate) { this(sampleRate, 1); }
    public EnvironmentAudio(int sampleRate, long seed) {
        if (sampleRate < 8000 || sampleRate > 192000) throw new IllegalArgumentException("sampleRate must be in 8000..192000");
        this.sampleRate = sampleRate; this.seed = (int) seed;
        smoothing = 1 - Math.exp(-1 / (sampleRate * .12));
        rainPole = 1 - Math.exp(-2 * Math.PI * 1500 / sampleRate);
        windPole = 1 - Math.exp(-2 * Math.PI * 280 / sampleRate);
        thunderPole = 1 - Math.exp(-2 * Math.PI * 95 / sampleRate);
        dcPole = 1 - Math.exp(-2 * Math.PI * 12 / sampleRate);
        noiseScale = Math.sqrt(sampleRate / 48000.0);
        airPole = 1 - Math.exp(-2 * Math.PI * 1800 / sampleRate);
        dropDamp = Math.exp(-1 / (sampleRate * .004));
        dropFast = Math.exp(-1 / (sampleRate * .0015));
        dropSlow = Math.exp(-1 / (sampleRate * .018));
        reset();
    }
    private static double clamp(double v, double old) { return Double.isNaN(v) || Double.isInfinite(v) ? old : Math.max(0, Math.min(1, v)); }
    private static double smooth(double v, double target, double c) { return Math.abs(v - target) < 1e-7 ? target : v + c * (target - v); }
    public void setParameters(int rainType, double rain, double thunder, double wind) {
        Parameters p = parameters;
        parameters = new Parameters(rainType, clamp(rain, p.rain), clamp(thunder, p.thunder), clamp(wind, p.wind));
    }
    public void setParameters(Parameters p) { if (p == null) throw new IllegalArgumentException("parameters required"); parameters = p; }
    public Parameters getParameters() { return parameters; }
    public void start() { playing = true; }
    public void stop() { playing = false; }
    public boolean isSilent() { return light == 0 && steady == 0 && heavy == 0 && thunder == 0 && wind == 0; }
    /** Immediate silent reset, preserving targets, stopping transport. */
    public void reset() {
        playing = false;
        rainState = seed ^ 0x51ed270b; windState = seed ^ 0x68bc21eb; thunderState = seed ^ 0x02e5be93;
        light = steady = heavy = wind = thunder = 0;
        rainL = rainR = windL = windR = windDcL = windDcR = 0;
        rumbleL = rumbleR = rumbleDcL = rumbleDcR = 0;
        java.util.Arrays.fill(dropDrive, 0); java.util.Arrays.fill(dropA, 0); java.util.Arrays.fill(dropB, 0); java.util.Arrays.fill(dropPan, 0);
        java.util.Arrays.fill(dropTone, 0); java.util.Arrays.fill(dropY, 0); java.util.Arrays.fill(dropZ, 0);
        java.util.Arrays.fill(rollDelay, 0); java.util.Arrays.fill(rollDuration, 0); java.util.Arrays.fill(rollGain, 0);
        dropIndex = 0; airL = airR = crackL = crackR = rainFineL = rainFineR = 0;
        gust = gustTarget = .5; gustCountdown = 0;
        thunderCountdown = (int) (sampleRate * 1.5); rollAge = rollLength = 0;
        outputL = outputR = 0;
    }
    private double rainRandom() { rainState = rainState * 1664525 + 1013904223; return (rainState & 0xffffffffL) / 4294967296.0; }
    private double windRandom() { windState = windState * 1664525 + 1013904223; return (windState & 0xffffffffL) / 4294967296.0; }
    private double thunderRandom() { thunderState = thunderState * 1664525 + 1013904223; return (thunderState & 0xffffffffL) / 4294967296.0; }
    public void next() {
    Parameters p = parameters; boolean on = playing; double c = smoothing;
    light = smooth(light, on && p.rainType == 1 ? p.rain : 0, c);
    steady = smooth(steady, on && p.rainType == 2 ? p.rain : 0, c);
    heavy = smooth(heavy, on && p.rainType == 3 ? p.rain : 0, c);
    wind = smooth(wind, on ? p.wind : 0, c);
    thunder = smooth(thunder, on ? p.thunder : 0, c);
    if (!on && isSilent()) { outputL = outputR = 0; return; }
    // Fine patter plus bounded, individually panned damped drop resonances.
    double rl = rainRandom() * 2 - 1, rr = rainRandom() * 2 - 1;
    rainL += rainPole * (rl - rainL);
    rainR += rainPole * (rr - rainR);
    rainFineL += airPole * (rl - rainFineL);
    rainFineR += airPole * (rr - rainFineR);
    double rainGain = light + steady + heavy;
    double density = rainGain > 0 ? (16 * light + 85 * steady + 240 * heavy) / rainGain : 16;
    if (rainRandom() < density / sampleRate) {
      int k = dropIndex; dropIndex = (k + 1) % 24;
      dropA[k] = dropB[k] = .45 + .55 * rainRandom();
      dropPan[k] = rainRandom();
      double angle = 2 * Math.PI * (650 + 2300 * rainRandom()) / sampleRate;
      dropTone[k] = 2 * dropDamp * Math.cos(angle);
      dropDrive[k] = 3 * (1 - dropDamp) * Math.sin(angle);
      // Resonance starts at zero, then receives a short noise excitation.
      dropY[k] = dropZ[k] = 0;
    }
    double dropsL = 0, dropsR = 0;
    for (int k = 0; k < 24; k++) {
      dropA[k] *= dropFast; dropB[k] *= dropSlow;
      double env = dropB[k] - dropA[k];
      double y = dropTone[k] * dropY[k] - dropDamp * dropDamp * dropZ[k] + dropDrive[k] * env * (k % 2 == 0 ? rl : rr);
      dropZ[k] = dropY[k]; dropY[k] = y;
      double drop = .6 * env * (k % 2 == 0 ? rainFineL : rainFineR) + y;
      dropsL += drop * (1 - dropPan[k]); dropsR += drop * dropPan[k];
    }
    double fine = .009 * light + .025 * steady + .055 * heavy;
    double body = .008 * light + .025 * steady + .07 * heavy;
    double left = noiseScale * (fine * (rainFineL - rainL) + body * rainL + .13 * rainGain * dropsL);
    double right = noiseScale * (fine * (rainFineR - rainR) + body * rainR + .13 * rainGain * dropsR);
    // Broad filtered air, not a sine-wave howl; slow asymmetric gusts.
    if (--gustCountdown <= 0) {
      gustTarget = .3 + .7 * windRandom();
      gustCountdown = (int) (sampleRate * (1.5 + windRandom() * 4));
    }
    gust += (gustTarget - gust) / sampleRate;
    double wl = windRandom() * 2 - 1, wr = windRandom() * 2 - 1;
    windL += windPole * (wl - windL);
    windR += windPole * (wr - windR);
    airL += airPole * (wl - airL); airR += airPole * (wr - airR);
    windDcL += dcPole * (windL - windDcL);
    windDcR += dcPole * (windR - windDcR);
    double wg = wind * gust * noiseScale;
    left += wg * (1.05 * (windL - windDcL) + .10 * gust * (airL - windL));
    right += wg * (1.05 * (windR - windDcR) + .10 * gust * (airR - windR));
    // A softened initial crack followed by seven delayed, overlapping rolls.
    // Independent RNG and clock: rain/wind controls never schedule thunder.
    if (rollAge >= rollLength && --thunderCountdown <= 0) {
      rollAge = 0; rollLength = (int) (sampleRate * 8);
      thunderCountdown = (int) (sampleRate * (6 + 9 * thunderRandom()));
      for (int k = 0; k < 7; k++) {
        rollDelay[k] = k == 0 ? 0 : k * .65 + thunderRandom() * .4;
        rollDuration[k] = 1.4 + thunderRandom() * 1.8;
        rollGain[k] = (1 - k * .10) * (.65 + .35 * thunderRandom());
      }
    }
    double tn = thunderRandom() * 2 - 1, tr = .8 * tn + .2 * (thunderRandom() * 2 - 1);
    rumbleL += thunderPole * (tn - rumbleL);
    rumbleR += thunderPole * (tr - rumbleR);
    crackL += rainPole * (tn - crackL); crackR += rainPole * (tr - crackR);
    rumbleDcL += dcPole * (rumbleL - rumbleDcL);
    rumbleDcR += dcPole * (rumbleR - rumbleDcR);
    if (rollAge < rollLength) {
      double age = rollAge++ / (double) sampleRate;
      double envelope = 0;
      for (int k = 0; k < 7; k++) {
        double x = (age - rollDelay[k]) / rollDuration[k];
        if (x > 0 && x < 1) envelope += rollGain[k] * 16 * x * (1 - x) * (1 - x) * (1 - x);
      }
      double x = age / .32;
      double crack = x < 1 ? 16 * x * (1 - x) * (1 - x) * (1 - x) : 0;
      double tg = thunder * noiseScale;
      left += tg * (1.8 * envelope * (rumbleL - rumbleDcL) + .19 * crack * (crackL - rumbleL));
      right += tg * (1.8 * envelope * (rumbleR - rumbleDcR) + .19 * crack * (crackR - rumbleR));
    }
    outputL = .45 * Math.tanh(left / .45); outputR = .45 * Math.tanh(right / .45);
  }
    public void render(float[] left, float[] right) { process(left, right, false); }
    public void mix(float[] left, float[] right) { process(left, right, true); }
    private void process(float[] left, float[] right, boolean add) {
        if (left == null || right == null || left == right || left.length != right.length)
            throw new IllegalArgumentException("distinct equal-length stereo channels required");
        for (int i = 0; i < left.length; i++) {
            next();
            if (add) { left[i] += (float) outputL; right[i] += (float) outputR; }
            else { left[i] = (float) outputL; right[i] = (float) outputR; }
        }
    }
}
