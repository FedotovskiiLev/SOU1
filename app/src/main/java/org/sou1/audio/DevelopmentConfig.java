// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

import java.util.Map;

/**
 * Immutable setup-time score configuration. No Android or JSON dependency.
 * Bridge code must validate the closed schema before constructing a session;
 * fromMap accepts JSON-like scalar values and rejects unknown keys and coercion.
 * Native selector -1 means "seed" and native variation -1 means "auto".
 * These numeric sentinels are never accepted as JSON input values by fromMap.
 */
public final class DevelopmentConfig {
    public static final String TONIC = "tonic", MODE = "mode", METER = "meter";
    public static final String RHYTHM_FAMILY = "rhythmFamily", ARP_STRATEGY = "arpStrategy";
    public static final String DRUM_PATTERN = "drumPattern", HARMONY = "harmony", DRUM_VARIATION = "drumVariation";
    public static final int SEED = -1;
    public static final double AUTO_VARIATION = -1;
    public static final String AUTO = "auto", FIXED = "fixed", PROGRESSION = "progression", MODULATING = "modulating";
    public static final DevelopmentConfig DEFAULT = new DevelopmentConfig(SEED,SEED,SEED,SEED,SEED,SEED,AUTO,AUTO_VARIATION);
    public final int tonic, mode, meter, rhythmFamily, arpStrategy, drumPattern;
    public final String harmony;
    public final double drumVariation;
    /** Native semantic identity, not a JSON wire format. Equivalent configs have equal keys. */
    public final String key;

    public DevelopmentConfig(int tonic, int mode, int meter, int rhythmFamily,
            int arpStrategy, int drumPattern, String harmony, double drumVariation) {
        this.tonic = selector(tonic,11,TONIC); this.mode = selector(mode,6,MODE); this.meter = selector(meter,5,METER);
        this.rhythmFamily = selector(rhythmFamily,7,RHYTHM_FAMILY); this.arpStrategy = selector(arpStrategy,7,ARP_STRATEGY);
        this.drumPattern = selector(drumPattern,7,DRUM_PATTERN); this.harmony = parseHarmony(harmony);
        if (drumVariation != AUTO_VARIATION && (!Double.isFinite(drumVariation) || drumVariation < 0 || drumVariation > 1))
            throw new IllegalArgumentException("drumVariation must be AUTO_VARIATION or finite 0..1");
        this.drumVariation = drumVariation == 0 ? 0 : drumVariation; // Canonicalize negative zero.
        key = "d1|"+tonic+'|'+mode+'|'+meter+'|'+rhythmFamily+'|'+arpStrategy+'|'+drumPattern+'|'+harmony+'|'
                +(this.drumVariation == AUTO_VARIATION ? "-1" : Double.toString(this.drumVariation));
    }
    private static int selector(int value,int max,String name) {
        if (value < SEED || value > max) throw new IllegalArgumentException(name+" must be SEED or 0.."+max);
        return value;
    }
    public static boolean isKnownKey(String key) {
        return TONIC.equals(key)||MODE.equals(key)||METER.equals(key)||RHYTHM_FAMILY.equals(key)
                ||ARP_STRATEGY.equals(key)||DRUM_PATTERN.equals(key)||HARMONY.equals(key)||DRUM_VARIATION.equals(key);
    }
    /** Strict JSON scalar selector parsing: no numeric strings, booleans, null or sentinel numbers. */
    public static int parseSelector(String key,Object value) {
        int max;
        if(TONIC.equals(key))max=11;else if(MODE.equals(key))max=6;else if(METER.equals(key))max=5;
        else if(RHYTHM_FAMILY.equals(key)||ARP_STRATEGY.equals(key)||DRUM_PATTERN.equals(key))max=7;
        else throw new IllegalArgumentException("unknown development selector: "+key);
        if("seed".equals(value))return SEED;
        if(!(value instanceof Number))throw new IllegalArgumentException(key+" must be seed or an integer");
        double number=((Number)value).doubleValue();
        if(!Double.isFinite(number)||number<0||number>max||number!=Math.floor(number))
            throw new IllegalArgumentException(key+" must be seed or an integer in 0.."+max);
        return (int)number;
    }
    public static String parseHarmony(Object value) {
        if(AUTO.equals(value)||FIXED.equals(value)||PROGRESSION.equals(value)||MODULATING.equals(value))return (String)value;
        throw new IllegalArgumentException("harmony must be auto, fixed, progression or modulating");
    }
    public static double parseDrumVariation(Object value) {
        if(AUTO.equals(value))return AUTO_VARIATION;
        if(!(value instanceof Number))throw new IllegalArgumentException("drumVariation must be auto or finite 0..1");
        double number=((Number)value).doubleValue();
        if(!Double.isFinite(number)||number<0||number>1)throw new IllegalArgumentException("drumVariation must be auto or finite 0..1");
        return number==0?0:number;
    }
    public static DevelopmentConfig fromMap(Map<String,?> input) {
        if(input==null)throw new IllegalArgumentException("config must be an object");
        for(String key:input.keySet())if(!isKnownKey(key))throw new IllegalArgumentException("unknown development config key: "+key);
        return new DevelopmentConfig(value(input,TONIC),value(input,MODE),value(input,METER),value(input,RHYTHM_FAMILY),
                value(input,ARP_STRATEGY),value(input,DRUM_PATTERN),input.containsKey(HARMONY)?parseHarmony(input.get(HARMONY)):AUTO,
                input.containsKey(DRUM_VARIATION)?parseDrumVariation(input.get(DRUM_VARIATION)):AUTO_VARIATION);
    }
    private static int value(Map<String,?> input,String key) { return input.containsKey(key)?parseSelector(key,input.get(key)):SEED; }
    /** Versioned native Intent/preferences value; always fewer than 256 characters. */
    public String canonicalKey() { return key; }
    /** Strict canonical decode. Unknown versions, extra tokens, whitespace and alternative spellings are rejected. */
    public static DevelopmentConfig parseKey(String key) {
        if(key==null||key.length()==0||key.length()>256)throw new IllegalArgumentException("invalid development config key length");
        String[] parts=key.split("\\|",-1);
        if(parts.length!=9||!"d1".equals(parts[0]))throw new IllegalArgumentException("invalid development config key version or token count");
        try {
            DevelopmentConfig value=new DevelopmentConfig(Integer.parseInt(parts[1]),Integer.parseInt(parts[2]),Integer.parseInt(parts[3]),
                    Integer.parseInt(parts[4]),Integer.parseInt(parts[5]),Integer.parseInt(parts[6]),parts[7],Double.parseDouble(parts[8]));
            if(!value.key.equals(key))throw new IllegalArgumentException("non-canonical development config key");
            return value;
        } catch(NumberFormatException invalid) { throw new IllegalArgumentException("invalid development config key number",invalid); }
    }
    private static String selectorJson(int n) { return n==SEED?"\"seed\"":Integer.toString(n); }
    /** Eight canonical fields in JS schema order. Numeric spellings may differ from JSON.stringify. */
    public String toJson() {
        return "{\"tonic\":"+selectorJson(tonic)+",\"mode\":"+selectorJson(mode)+",\"meter\":"+selectorJson(meter)
                +",\"rhythmFamily\":"+selectorJson(rhythmFamily)+",\"arpStrategy\":"+selectorJson(arpStrategy)
                +",\"drumPattern\":"+selectorJson(drumPattern)+",\"harmony\":\""+harmony+"\",\"drumVariation\":"
                +(drumVariation==AUTO_VARIATION?"\"auto\"":Double.toString(drumVariation))+"}";
    }
    @Override public boolean equals(Object other) { return other instanceof DevelopmentConfig && key.equals(((DevelopmentConfig)other).key); }
    @Override public int hashCode() { return key.hashCode(); }
    @Override public String toString() { return toJson(); }
}
