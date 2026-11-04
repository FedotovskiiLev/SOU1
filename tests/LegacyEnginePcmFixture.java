// SPDX-License-Identifier: AGPL-3.0-only
import java.security.MessageDigest;
import java.util.HexFormat;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;

/** Frozen legacy PCM fixture producer; this compiles against the pre-change engine. */
public final class LegacyEnginePcmFixture {
    private LegacyEnginePcmFixture() { }
    static Parameters parameters(boolean drums, boolean weather, int style) {
        return new Parameters(.82,.68,.61,.43,.8,.4,.9,.65,
                .65,.55,.35,.2,.15,.6,weather ? 2 : 0,weather ? .3 : 0,
                weather ? .2 : 0,weather ? .4 : 0,style,137,24,true,drums,.8,.7,.6,.5,.4,
                .4,.6,.7,.8,.8,.9,.37);
    }
    private static void word(MessageDigest hash, int value) {
        hash.update((byte) value); hash.update((byte) (value >>> 8));
        hash.update((byte) (value >>> 16)); hash.update((byte) (value >>> 24));
    }
    static String fixture(int rate, int scenario) throws Exception {
        AmbientEngine engine = new AmbientEngine(rate, scenario == 3 ? 0L : 0xfedcba98L);
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        float[] floats = new float[256]; short[] shorts = new short[256];
        engine.setParameters(scenario == 0 ? Parameters.DEFAULT : parameters(scenario != 1, scenario >= 2, scenario));
        for (int i = 0; i < 17; i++) { engine.render(floats, 2, 123); for (float v : floats) word(hash, Float.floatToRawIntBits(v)); }
        engine.start();
        for (int i = 0; i < 900; i++) {
            if (i == 170) engine.setParameters(parameters(scenario != 1, true, 3));
            if (i == 240) engine.reseed(813);
            if (i == 330) engine.setParameters(parameters(false, true, 1));
            if (i == 390) engine.setParameters(parameters(scenario != 1, false, 2));
            if (i == 490) engine.stop();
            if (i == 510) engine.start();
            if (i == 650) { engine.reset(); engine.start(); }
            if (i == 790) engine.stop();
            if ((i & 1) == 0) {
                engine.render(floats, 2, 123);
                for (float v : floats) word(hash, Float.floatToRawIntBits(v));
            } else {
                engine.render(shorts, 2, 123);
                for (short v : shorts) word(hash, v);
            }
        }
        hash.update(engine.getScoreSnapshot().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        word(hash, (int) engine.getFrame()); word(hash, (int) engine.getNoteOnCount());
        word(hash, (int) engine.getNoteOffCount()); word(hash, (int) engine.getDroppedNotes());
        word(hash, engine.getActiveVoiceCount()); word(hash, engine.getActiveDrumVoiceCount());
        return rate + " " + scenario + " " + HexFormat.of().formatHex(hash.digest());
    }
    public static void main(String[] args) throws Exception {
        for (int rate : new int[]{8000,44100,48000,96000,192000})
            for (int scenario = 0; scenario < 4; scenario++) System.out.println(fixture(rate, scenario));
    }
}
