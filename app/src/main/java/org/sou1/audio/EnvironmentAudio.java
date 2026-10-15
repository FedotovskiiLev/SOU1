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
    // Rain changes spectral weight and density, crossfading instead of switching.
    double rl = rainRandom() * 2 - 1, rr = rainRandom() * 2 - 1;
    rainL += rainPole * (rl - rainL);
    rainR += rainPole * (rr - rainR);
    double bright = .055 * light + .085 * steady + .09 * heavy;
    double body = .025 * light + .07 * steady + .16 * heavy;
    double left = bright * (rl - rainL) + body * rainL;
    double right = bright * (rr - rainR) + body * rainR;
    if (--gustCountdown <= 0) {
      gustTarget = .25 + .75 * windRandom();
      gustCountdown = (int) (sampleRate * (1.5 + windRandom() * 4));
    }
    gust += (gustTarget - gust) / sampleRate;
    windL += windPole * (windRandom() * 2 - 1 - windL);
    windR += windPole * (windRandom() * 2 - 1 - windR);
    windDcL += dcPole * (windL - windDcL);
    windDcR += dcPole * (windR - windDcR);
    double wg = wind * gust * .38;
    left += wg * (windL - windDcL); right += wg * (windR - windDcR);
    // The independent clock runs even with rain off. Soft 3–7 second rolls,
    // separated by 6–15 seconds, never an impulsive lightning crack.
    if (rollAge >= rollLength && --thunderCountdown <= 0) {
      rollAge = 0; rollLength = (int) (sampleRate * (3 + 4 * thunderRandom()));
      thunderCountdown = (int) (sampleRate * (6 + 9 * thunderRandom()));
    }
    double tn = thunderRandom() * 2 - 1;
    rumbleL += thunderPole * (tn - rumbleL);
    rumbleR += thunderPole * (.8 * tn + .2 * (thunderRandom() * 2 - 1) - rumbleR);
    rumbleDcL += dcPole * (rumbleL - rumbleDcL);
    rumbleDcR += dcPole * (rumbleR - rumbleDcR);
    if (rollAge < rollLength) {
      double phase = (double) rollAge++ / rollLength;
      double envelope = 16 * phase * phase * (1 - phase) * (1 - phase);
      double tg = thunder * envelope * .65;
      left += tg * (rumbleL - rumbleDcL); right += tg * (rumbleR - rumbleDcR);
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
