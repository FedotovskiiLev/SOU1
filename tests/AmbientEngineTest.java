// SPDX-License-Identifier: AGPL-3.0-only
import java.util.Arrays;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;

/** Dependency-free DSP regression checks. Run with tests/run.sh. */
public final class AmbientEngineTest {
    private static int checks;
    public static void main(String[] args) {
        determinism();
        fadesAndControls();
        validation();
        for (int rate : new int[] {8000, 44100, 48000, 96000, 192000}) levels(rate);
        System.out.println("PASS: " + checks + " DSP checks");
    }
    private static void require(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    private static void determinism() {
        AmbientEngine a = new AmbientEngine(8000, 0), b = new AmbientEngine(8000, 0);
        a.start(); b.start();
        short[] x = new short[16000], y = new short[16000];
        a.render(x, 0, 8000);
        for (int i = 0; i < 8000; i += 100) b.render(y, i * 2, 100);
        require(Arrays.equals(x, y), "render chunk size independence");
        AmbientEngine c = new AmbientEngine(8000, 1);
        c.start(); c.render(y, 0, 8000);
        require(!Arrays.equals(x, y), "different seeds must differ");
        for (int i = 0; i < 30; i++) {
            a.render(x, 0, 8000); b.render(y, 0, 8000);
            require(Arrays.equals(x, y), "deterministic event sequencing");
        }
    }
    private static void fadesAndControls() {
        AmbientEngine a = new AmbientEngine(8000, 17), b = new AmbientEngine(8000, 17);
        float[] x = new float[16000], y = new float[16000];
        a.render(x, 0, 8000);
        for (float v : x) require(v == 0, "initial silence");
        a.start(); b.start();
        a.render(x, 0, 8000); b.render(y, 0, 8000);
        require(Arrays.equals(x, y), "silent render must not advance musical time");
        require(x[0] == 0 && x[1] == 0, "zero first sample");
        a.setParameters(new Parameters(1, 1, 1));
        a.render(x, 0, 1); b.render(y, 0, 1);
        require(Math.abs(x[0] - y[0]) < .0001, "smoothed control boundary");
        a.stop();
        a.render(x, 0, 8000); a.render(x, 0, 8000); a.render(x, 0, 1);
        require(a.isSilent(), "fade reaches silence");
        a.render(x, 0, 8000);
        for (float v : x) require(v == 0, "complete stop silence");
        a.start(); a.render(x, 0, 8000);
        require(!a.isSilent() && rms(x) > .0001, "restart produces sound");
        a.stop(); a.render(x, 0, 100); a.start(); a.render(x, 0, 100);
        require(!a.isSilent(), "rapid stop/start resumes");
        Parameters p = new Parameters(Double.NaN, Double.POSITIVE_INFINITY, -2);
        require(p.intensity == .5 && p.brightness == .45 && p.motion == 0, "invalid controls sanitized");
    }
    private static void validation() {
        expectFailure(() -> new AmbientEngine(0, 1));
        expectFailure(() -> new AmbientEngine(192001, 1));
        AmbientEngine a = new AmbientEngine(8000, 1);
        expectFailure(() -> a.render((short[]) null, 0, 1));
        expectFailure(() -> a.render(new short[4], 0, Integer.MAX_VALUE));
        expectFailure(() -> a.render(new short[4], -1, 1));
        expectFailure(() -> a.render(new float[4], 3, 1));
        expectFailure(() -> a.setParameters(null));
        short[] out = {123, 123, 123, 123, 123, 123};
        a.render(out, 2, 1);
        require(out[0] == 123 && out[1] == 123 && out[4] == 123 && out[5] == 123, "range guards");
    }
    private static void expectFailure(Runnable task) {
        boolean failed = false;
        try { task.run(); } catch (IllegalArgumentException e) { failed = true; }
        require(failed, "invalid argument rejected");
    }
    private static void levels(int rate) {
        AmbientEngine engine = new AmbientEngine(rate, 123456789);
        engine.start();
        float[] buffer = new float[1024];
        double peak = 0, energy = 0, sum = 0, maxDelta = 0;
        float lastL = 0, lastR = 0;
        // Ten musical minutes at low sample rate; 20 seconds at each other rate.
        long frames = (long) rate * (rate == 8000 ? 600 : 20);
        long rendered = 0;
        while (rendered < frames) {
            int count = (int) Math.min(512, frames - rendered);
            if (rendered % (512 * 71) == 0)
                engine.setParameters(new Parameters((rendered / 512) % 2, 1, 1, (rendered / 512) % 2));
            engine.render(buffer, 0, count);
            for (int i = 0; i < count * 2; i += 2) {
                float l = buffer[i], r = buffer[i + 1];
                if (!Float.isFinite(l) || !Float.isFinite(r)) throw new AssertionError("non-finite PCM");
                peak = Math.max(peak, Math.max(Math.abs(l), Math.abs(r)));
                energy += l * l + r * r;
                sum += l + r;
                maxDelta = Math.max(maxDelta, Math.max(Math.abs(l - lastL), Math.abs(r - lastR)));
                lastL = l; lastR = r;
            }
            rendered += count;
        }
        double rms = Math.sqrt(energy / (2 * frames));
        require(peak < .85, "headroom at " + rate);
        require(rms > .005 && rms < .2, "useful RMS at " + rate);
        require(Math.abs(sum / (2 * frames)) < .001, "DC rejection at " + rate);
        require(maxDelta < .1, "no discontinuity at " + rate);
        System.out.printf("%d Hz: %.1fs, peak %.4f, RMS %.4f, delta %.4f%n", rate, frames / (double) rate, peak, rms, maxDelta);
    }
    private static double rms(float[] x) {
        double sum = 0;
        for (float v : x) sum += v * v;
        return Math.sqrt(sum / x.length);
    }
}
