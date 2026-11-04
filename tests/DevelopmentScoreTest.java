// SPDX-License-Identifier: AGPL-3.0-only
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
import org.sou1.audio.DevelopmentScore;
import java.io.BufferedOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

/** Pure JVM score tests. These are not Android-device or audio-output validation. */
public final class DevelopmentScoreTest {
    static void require(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static Parameters params(double ambient, double counter, double rhythmic, double arp,
            double bpm, double density, double complexity, double swing, double evolution,
            int polyphony, boolean melody, boolean drums) {
        return new Parameters(.5,.45,.35,.5,0,0,.5,0,.65,.55,.35,.2,.15,evolution,0,0,0,0,
                0,bpm,polyphony,melody,drums,.65,.4,.3,.35,.2,
                ambient,counter,rhythmic,arp,density,complexity,swing);
    }
    static Parameters preset(int style) {
        return params(style == 0 ? 1 : 0, style == 1 ? 1 : 0, style == 2 ? 1 : 0,
                style == 3 ? 1 : 0, 137,.8,.9,.37,.7,24,true,true);
    }
    static class Sink implements AmbientEngine.NoteSink {
        final int rate; final double[] occupied = new double[44];
        long count, hash = 1, previous = -1; int atCount, layers, maxAt, maxMelodic, maxDrums;
        Sink(int rate) { this.rate = rate; }
        public void noteOn(long at, int layer, int pitch, long duration, double velocity, double pan) {
            if (at < previous || layer < 0 || layer > 9 || pitch < 24 || pitch > 96 || duration < 1 || duration > rate * 32L)
                throw new AssertionError("event order/range");
            if (!(velocity >= .005 && velocity <= 1 && pan >= .15 && pan <= .85)) throw new AssertionError("event expression range");
            if (at != previous) atCount = 0;
            if (++atCount > 12) throw new AssertionError("bounded events per tick");
            previous = at; maxAt = Math.max(maxAt, atCount); count++; layers |= 1 << layer;
            hash = hash * 31 + at; hash = hash * 31 + layer; hash = hash * 31 + pitch; hash = hash * 31 + duration;
            hash = hash * 31 + Double.doubleToLongBits(velocity); hash = hash * 31 + Double.doubleToLongBits(pan);
            int begin = layer < 5 ? 0 : 32, end = layer < 5 ? 32 : 44, slot = -1, active = 0;
            for (int i = begin; i < end; i++) { if (occupied[i] <= at && slot < 0) slot = i; if (occupied[i] > at) active++; }
            if (slot < 0) throw new AssertionError("fixed score budget exceeded");
            occupied[slot] = (double) at + duration + Math.round(rate * (layer == 0 ? 4 : layer == 3 ? 2 : layer >= 5 ? .08 : .3));
            if (layer < 5) maxMelodic = Math.max(maxMelodic, active + 1); else maxDrums = Math.max(maxDrums, active + 1);
        }
    }
    static void fill(DevelopmentScore score, Parameters p, Sink sink, long end, int chunk) {
        if (chunk == 0) score.advanceTo(end, p, sink);
        else {
            for (long at = 0; at < end; at += chunk) score.advanceTo(at, p, sink);
            score.advanceTo(end, p, sink);
        }
    }
    static void expectInvalid(Runnable run, String message) {
        boolean threw = false;
        try { run.run(); } catch (IllegalArgumentException | IllegalStateException e) { threw = true; }
        require(threw, message);
    }
    static void unit() {
        for (int rate : new int[]{8000,44100,48000,96000,192000}) for (int style = 0; style < 4; style++) {
            Parameters p = preset(style); long end = 123L * rate - 1;
            DevelopmentScore one = new DevelopmentScore(rate,-1), split = new DevelopmentScore(rate,-1);
            Sink a = new Sink(rate), b = new Sink(rate);
            fill(one,p,a,end,0); fill(split,p,b,end,997);
            require(a.count == b.count && a.hash == b.hash && one.tick == split.tick && one.beatNext == split.beatNext, "chunk independence");
            require(one.next == Math.round(one.beatNext) && one.next > end && one.step == one.tick, "next/step diagnostics");
            require(a.maxMelodic <= p.polyphony && a.maxDrums <= 12, "voice admission budgets");
            one.reset(); Sink c = new Sink(rate); fill(one,p,c,end,0);
            require(a.count == c.count && a.hash == c.hash, "allocation-free reset restores exact replay");
            one.reseed(0xffffffffL); Sink d = new Sink(rate); fill(one,p,d,end,0);
            require(a.hash == d.hash && one.seed == 0xffffffffL, "unsigned 32-bit seed semantics");
        }
        Set<Integer> modes = new HashSet<>(), meters = new HashSet<>(), arps = new HashSet<>(), lengths = new HashSet<>();
        for (int seed = 0; seed < 128; seed++) {
            DevelopmentScore score = new DevelopmentScore(8000,seed);
            modes.add(score.mode); meters.add(score.meterTicks); arps.add(score.arpStrategy); lengths.add(score.motifLength);
        }
        require(modes.size() == 7 && meters.size() == 6 && arps.size() == 8 && lengths.size() == 6, "seed vocabulary coverage");
        Parameters slow = params(1,0,0,0,72,.5,.5,0,0,16,true,false);
        for (int seed = 0; seed < 65; seed++) {
            DevelopmentScore stable = new DevelopmentScore(8000,seed); Sink slowSink = new Sink(8000);
            stable.advanceTo(8000L*3599,slow,slowSink); require(stable.chord == 0 && stable.chordChanges == 0, "first ambient field");
            stable.advanceTo(8000L*7199,slow,slowSink); require(stable.chord == 2 && stable.chordChanges == 1, "second ambient field");
            stable.advanceTo(8000L*10800-1,slow,slowSink); require(stable.chord == 3 && stable.chordChanges == 2, "three distinct fields in first three hours");
        }
        Parameters silent = params(0,0,0,0,72,1,1,1,1,8,true,false);
        DevelopmentScore score = new DevelopmentScore(8000,91); Sink sink = new Sink(8000);
        score.advanceTo(8000L*60,silent,sink); require(sink.count == 0 && score.tick > 0, "zero weights silence score without clock reset");
        score.reset(); sink = new Sink(8000);
        score.advanceTo(8000L*180,params(1,0,0,0,72,1,1,0,1,16,false,false),sink);
        require((sink.layers & ((1 << 1) | (1 << 2))) == 0 && (sink.layers & 25) == 25, "ambient melody mute preserves pad/texture/pulse");
        score.reset(); sink = new Sink(8000);
        score.advanceTo(8000L*60,params(0,0,0,0,72,1,1,0,1,16,false,true),sink);
        require((sink.layers & 31) == 0 && (sink.layers & 992) != 0, "drums-only independent toggles");
        score.reset(); Sink paused = new Sink(8000); score.advanceTo(0,preset(1),paused);
        long tick = score.tick; double elapsed = score.elapsedFrames; double beat = score.beatNext;
        for (int i = 0; i < 16000; i++) { score.beatNext++; score.next = Math.round(score.beatNext); }
        score.advanceTo(Math.round(beat)+15999,preset(1),paused);
        require(score.tick == tick && score.elapsedFrames == elapsed, "stop fade shifts transport without advancing score");
        score.advanceTo(score.next,preset(1),paused); require(score.tick == tick + 1, "resume advances one tick without rewind/catch-up");
        score.reset(); score.tick = score.step = 2147483647L;
        score.bar = 2147483647L; score.phrase = 2147483647L; score.barTick = score.meterTicks - 1; score.phraseBar = score.phraseBars - 1;
        score.beatNext = 4294967309.25; score.next = Math.round(score.beatNext);
        score.advanceTo(score.next,preset(2),new Sink(8000));
        require(score.tick == 2147483648L && score.bar == 2147483648L && score.phrase == 2147483648L && score.next > 4294967309L, "64-bit clocks/counters cross int boundaries");
        expectInvalid(() -> new DevelopmentScore(7999,1), "reject low rate");
        expectInvalid(() -> new DevelopmentScore(192001,1), "reject high rate");
        DevelopmentScore invalid = new DevelopmentScore(8000,1);
        expectInvalid(() -> invalid.advanceTo(-2,preset(0),new Sink(8000)), "reject frame below sentinel");
        expectInvalid(() -> invalid.advanceTo(9007199254740992L,preset(0),new Sink(8000)), "JS-safe clock bound");
        invalid.advanceTo(-1,null,null); require(invalid.tick == 0, "pre-roll sentinel does not inspect unused parameters");
        expectInvalid(() -> invalid.advanceTo(0,null,new Sink(8000)), "reject missing parameters");
        invalid.beatNext = Double.NaN; expectInvalid(() -> invalid.advanceTo(0,preset(0),new Sink(8000)), "reject corrupt clock");
        invalid.beatNext = -1; expectInvalid(() -> invalid.advanceTo(0,preset(0),new Sink(8000)), "reject negative clock");
        System.out.println("PASS JVM score: reset/reseed, 64-bit bounds, chunking, mute/weights, transport continuity, vocabulary, event and voice budgets");
        allocation();
    }
    @SuppressWarnings("deprecation") // getId is also supported on Java 8/Android 26.
    static void allocation() {
        java.lang.management.ThreadMXBean base = ManagementFactory.getThreadMXBean();
        if (!(base instanceof com.sun.management.ThreadMXBean)) { System.out.println("SKIP allocation measurement: unsupported JVM"); return; }
        com.sun.management.ThreadMXBean bean = (com.sun.management.ThreadMXBean) base;
        if (!bean.isThreadAllocatedMemorySupported()) { System.out.println("SKIP allocation measurement: unsupported JVM"); return; }
        bean.setThreadAllocatedMemoryEnabled(true);
        DevelopmentScore score = new DevelopmentScore(192000,0xffffffffL);
        Parameters p = params(1,1,1,1,180,1,1,1,1,32,true,true);
        AmbientEngine.NoteSink sink = (at,k,n,d,v,pan) -> {};
        for (int i = 0; i < 40; i++) { score.reset(); score.advanceTo(192000L*600,p,sink); }
        long id = Thread.currentThread().getId(); bean.getThreadAllocatedBytes(id);
        long before = bean.getThreadAllocatedBytes(id);
        for (int i = 0; i < 20; i++) { score.reset(); score.advanceTo(192000L*600,p,sink); }
        long bytes = bean.getThreadAllocatedBytes(id) - before;
        require(bytes == 0, "score scheduling allocated " + bytes + " bytes after warmup");
        before = bean.getThreadAllocatedBytes(id);
        for (int i = 0; i < 100000; i++) score.advanceTo(score.next,p,sink);
        long perTick = bean.getThreadAllocatedBytes(id) - before;
        require(perTick == 0, "single-tick scheduling allocated " + perTick + " bytes after warmup");
        System.out.println("PASS JVM allocation: 0 bytes / 432020 ticks + 100000 single-tick calls after warmup (thread allocation counter)");
    }
    static String parameterJson(Parameters p) {
        return "{\"ambient\":"+p.ambient+",\"counterpoint\":"+p.counterpoint+",\"rhythmic\":"+p.rhythmic+",\"arpeggio\":"+p.arpeggio+
                ",\"bpm\":"+p.bpm+",\"density\":"+p.density+",\"complexity\":"+p.complexity+",\"swing\":"+p.swing+",\"evolution\":"+p.evolution+
                ",\"polyphony\":"+p.polyphony+",\"melodyEnabled\":"+p.melodyEnabled+",\"drumsEnabled\":"+p.drumsEnabled+"}";
    }
    static final class BinarySink extends Sink implements AutoCloseable {
        final DataOutputStream out;
        BinarySink(int rate, Path path) throws IOException { super(rate); out = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(path))); }
        @Override public void noteOn(long at,int k,int n,long d,double v,double pan) {
            super.noteOn(at,k,n,d,v,pan);
            try { out.writeLong(at); out.writeInt(k); out.writeInt(n); out.writeLong(d); out.writeDouble(v); out.writeDouble(pan); }
            catch (IOException e) { throw new IllegalStateException(e); }
        }
        public void close() throws IOException { out.close(); }
    }
    static int cases; static long vectorEvents;
    static void vector(Path dir, PrintWriter manifest, int rate, long seed, Parameters[] phases, long[] starts,
            long duration, int chunk, long shift) throws IOException {
        String name = String.format("case-%04d",cases++); DevelopmentScore score = new DevelopmentScore(rate,seed);
        score.beatNext += shift; score.next = Math.round(score.beatNext);
        try (BinarySink sink = new BinarySink(rate,dir.resolve(name+".bin"))) {
            for (int i = 0; i < phases.length; i++) {
                long begin = shift+starts[i], end = shift+(i+1 < phases.length ? starts[i+1] : duration)-1;
                if (chunk > 0) for (long frame = begin; frame < end; frame += chunk) score.advanceTo(frame,phases[i],sink);
                score.advanceTo(end,phases[i],sink);
            }
            StringBuilder phaseJson = new StringBuilder("[");
            for (int i = 0; i < phases.length; i++) {
                if (i != 0) phaseJson.append(','); phaseJson.append("{\"at\":").append(starts[i]).append(",\"p\":").append(parameterJson(phases[i])).append('}');
            }
            phaseJson.append(']');
            manifest.println("{\"name\":\""+name+"\",\"rate\":"+rate+",\"seed\":"+seed+",\"duration\":"+duration+",\"chunk\":"+chunk+",\"shift\":"+shift+
                    ",\"phases\":"+phaseJson+",\"result\":{\"count\":"+sink.count+",\"tick\":"+score.tick+",\"next\":"+score.next+",\"beatNext\":"+score.beatNext+
                    ",\"elapsedFrames\":"+score.elapsedFrames+",\"chordChanges\":"+score.chordChanges+",\"suppressedEvents\":"+score.suppressedEvents+
                    ",\"root\":"+score.root+",\"mode\":"+score.mode+",\"meterTicks\":"+score.meterTicks+",\"phraseBars\":"+score.phraseBars+
                    ",\"motifLength\":"+score.motifLength+",\"arpStrategy\":"+score.arpStrategy+",\"family\":"+score.family+"}}");
            vectorEvents += sink.count;
        }
    }
    static void vectors(Path dir) throws IOException {
        Files.createDirectories(dir);
        try (PrintWriter manifest = new PrintWriter(Files.newBufferedWriter(dir.resolve("cases.jsonl")))) {
            // Every style, 32 seeds, five rates; varied finite knobs, both mute toggles, all budgets.
            int[] rates = {8000,44100,48000,96000,192000}, budgets = {8,16,24,32};
            for (int rate : rates) for (int style = 0; style < 4; style++) for (int seed = 0; seed < 32; seed++) {
                Parameters p = params(style==0?1:0,style==1?1:0,style==2?1:0,style==3?1:0,
                        new int[]{30,72,137,180}[seed%4],(seed%5)/4.0,(seed%7)/6.0,(seed%3)/2.0,(seed%4)/3.0,
                        budgets[seed%4],seed%9!=0,seed%3!=0);
                vector(dir,manifest,rate,seed,new Parameters[]{p},new long[]{0},rate*96L,seed%2==0?0:997,0);
            }
            // Extra seeds cover every arpeggio/rhythm family and tonal root in parity, not only JVM tests.
            for (int seed = 32; seed < 128; seed++)
                vector(dir,manifest,8000,seed,new Parameters[]{preset(3)},new long[]{0},8000L*180,0,0);
            // Mixed weights, control thresholds and uint32 seeds, including signed and wrapped input seeds.
            long[] seeds = {-1,2147483648L,4294967295L,4294967296L,9007199254740991L};
            double[] edges = {0,.2,.25,.35,.5,.55,.65,.72,.75,.8,1};
            for (int mask = 0; mask < 16; mask++) for (int j = 0; j < edges.length; j++) {
                Parameters p = params((mask&1)!=0?.73:0,(mask&2)!=0?.91:0,(mask&4)!=0?.47:0,(mask&8)!=0?.62:0,
                        j%2==0?30:180,edges[(j+3)%edges.length],edges[j],j/10.0,(j%5)/4.0,budgets[j%4],true,j%2==0);
                vector(dir,manifest,rates[j%rates.length],seeds[j%seeds.length],new Parameters[]{p},new long[]{0},rates[j%rates.length]*180L,0,0);
            }
            // Controls change at arbitrary sample positions; no rewinding or dropped boundary tick.
            for (int rate : rates) for (int seed : new int[]{0,91,7311}) {
                Parameters[] p = {
                    params(1,0,0,0,30,.2,.1,0,0,8,true,false), params(.35,.8,.6,.4,180,1,1,1,1,32,true,true),
                    params(.35,.8,.6,.4,72,.5,.55,.37,.3,8,false,true), params(0,0,0,0,137,.8,.9,.5,.7,24,true,false),
                    params(0,0,0,1,30,.25,.25,0,0,16,true,true), params(1,1,1,1,180,1,1,1,1,32,true,true)
                };
                long[] starts = {0,rate*17L+13,rate*39L+71,rate*61L+3,rate*79L+19,rate*101L+1};
                vector(dir,manifest,rate,seed,p,starts,rate*137L,257,0);
                vector(dir,manifest,rate,seed,p,starts,rate*137L,0,0);
            }
            // Long-form score only, including >32-bit absolute frames and diverse harmony speeds.
            for (int style = 0; style < 4; style++) {
                Parameters p = params(style==0?1:0,style==1?1:0,style==2?1:0,style==3?1:0,137,.85,.95,.37,style==0?0:.8,32,true,true);
                vector(dir,manifest,192000,91+style,new Parameters[]{p},new long[]{0},192000L*10800,0,0);
            }
            vector(dir,manifest,192000,4294967295L,new Parameters[]{params(1,1,1,1,180,1,1,1,1,32,true,true)},new long[]{0},192000L*28800,0,0);
            vector(dir,manifest,8000,7311,new Parameters[]{preset(3)},new long[]{0},8000L*120,0,4294967313L);
        }
        System.out.println("PASS JVM wrote "+cases+" parity vectors / "+vectorEvents+" complete numerical events");
    }
    public static void main(String[] args) throws Exception {
        if (args.length == 2 && args[0].equals("vectors")) vectors(Paths.get(args[1])); else unit();
    }
}
