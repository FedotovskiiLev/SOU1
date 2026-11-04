// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import static org.sou1.audio.NativeDrumBankLoader.*;

/** Host/JDK preparation qualification only, not Android service/device playback. */
public final class NativeDrumBankLoaderTest {
    private static int assertions;
    private static long comparedFrames, equalFrames;
    private static int equalHashes, comparedSamples;
    private static double maxError;
    private static final String HASH = String.join("", Collections.nCopies(64, "0"));
    private static final String COMMIT = HASH.substring(0, 40);
    @FunctionalInterface private interface Throwing { void run() throws Exception; }
    private static void check(boolean ok, String message) { assertions++; if (!ok) throw new AssertionError(message); }
    private static void rejects(Throwing work, String message) throws Exception {
        try { work.run(); } catch (IOException | IllegalArgumentException expected) { assertions++; return; }
        throw new AssertionError("Accepted invalid input: " + message);
    }
    private static String text(DataInputStream input) throws IOException {
        int length = input.readInt();
        if (length < 0 || length > 4096) throw new IOException("Fixture string bounds");
        byte[] bytes = new byte[length]; input.readFully(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }
    private static void equal(String actual, String expected, String message) { check(actual.equals(expected), message + ": " + actual + " != " + expected); }
    private static void same(double actual, double expected, String message) { check(Double.doubleToLongBits(actual) == Double.doubleToLongBits(expected), message); }
    private static void near(double actual, double expected, double tolerance, String message) { check(Double.isFinite(actual) && Math.abs(actual - expected) <= tolerance, message + ": " + actual + " != " + expected); }
    private static float[][] bankPcm(LiveDrumPool.Bank bank) throws Exception {
        // Test-only reflection: production bank exposes no mutable PCM array.
        Field field = LiveDrumPool.Bank.class.getDeclaredField("samples"); field.setAccessible(true);
        return (float[][]) field.get(bank);
    }
    private static String sha(byte[] bytes) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) hex.append(String.format("%02x", b & 255));
        return hex.toString();
    }
    private static String pcmSha(float[] samples) throws Exception {
        byte[] bytes = new byte[samples.length * 4];
        for (int i = 0; i < samples.length; i++) {
            int bits = Float.floatToRawIntBits(samples[i]);
            for (int b = 0; b < 4; b++) bytes[i * 4 + b] = (byte) (bits >>> (8 * b));
        }
        return sha(bytes);
    }

    private static final class TrackingReader implements AssetReader {
        final Path root;
        int opened, closed;
        String changedPath;
        int mode; // 1 flip, 2 short, 3 long, 4 failing read, 5 interrupt
        TrackingReader(Path root) { this.root = root; }
        @Override public InputStream open(String path) throws IOException {
            opened++;
            check(safePath(path) && path.startsWith("audio-kit/"), "Only relative package paths reach reader");
            byte[] data = Files.readAllBytes(root.resolve(path));
            if (path.equals(changedPath)) {
                if (mode == 1) data[data.length - 1] ^= 1;
                if (mode == 2) data = Arrays.copyOf(data, data.length - 1);
                if (mode == 3) data = Arrays.copyOf(data, data.length + 1);
            }
            return new FilterInputStream(new ByteArrayInputStream(data)) {
                @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                    if (path.equals(changedPath) && mode == 4) throw new IOException("Injected stream failure");
                    int n = super.read(bytes, offset, Math.min(length, 97));
                    if (path.equals(changedPath) && mode == 5) Thread.currentThread().interrupt();
                    return n;
                }
                @Override public void close() throws IOException { closed++; super.close(); }
            };
        }
    }

    private static void parity(Path docs, Path fixture) throws Exception {
        try (DataInputStream input = new DataInputStream(Files.newInputStream(fixture))) {
            equal(text(input), "sou1.native-drum-vectors.v1", "Fixture schema");
            int cases = input.readInt(); check(cases == 20, "All kits x two actual rates + endpoints");
            for (int n = 0; n < cases; n++) {
                String kit = text(input); int rate = input.readInt();
                TrackingReader reader = new TrackingReader(docs);
                Prepared prepared = prepare(kit, rate, reader);
                check(reader.opened == reader.closed, "All asset streams closed");
                Report report = prepared.report; LiveDrumPool.Bank bank = prepared.bank;
                equal(report.kit, kit, "Report kit"); check(report.sampleRate == rate && bank.sampleRate == rate, "Target rate");
                check(report.encodedBytes == input.readInt(), "Encoded budget exact");
                check(report.sourceDecodedBytes == input.readInt(), "Decoded budget exact");
                check(report.sourceMappedBytes == input.readInt(), "Mapped budget exact");
                check(report.preparedBytes == input.readInt(), "Prepared budget exact");
                near(report.preparedPeak, input.readDouble(), 2e-7, "Prepared peak");
                check(report.banks.size() == input.readInt(), "Source bank count");
                for (Source source : report.banks) {
                    equal(source.id, text(input), "Source id"); equal(source.manifest, text(input), "Source manifest");
                    equal(source.sha256, text(input), "Source lock"); equal(source.sourceCommit, text(input), "Provenance commit");
                }
                for (String id : Arrays.asList("kick", "snare", "closed-hat", "toms", "short-clash")) equal(report.instrumentBanks.get(id), text(input), "Fallback/overlay provenance");
                int samples = input.readInt(); check(bank.getSampleCount() == samples && report.converted.size() == samples, "Sample count");
                float[][] pcm = bankPcm(bank); long byteCount = 0;
                for (int s = 0; s < samples; s++) {
                    Conversion converted = report.converted.get(s);
                    int frames = input.readInt(), sourceRate = input.readInt(), pitch = input.readInt();
                    check(bank.getSampleFrames(s) == frames && converted.frames == frames && converted.sampleIndex == s, "Sample frames/index");
                    check(converted.sourceRate == sourceRate && converted.targetRate == rate, "Conversion rates");
                    check((converted.pitch == null ? -1 : converted.pitch) == pitch, "Root-key materialization");
                    near(converted.step, input.readDouble(), 2e-15, "Pitch/resample ratio");
                    near(converted.peak, input.readDouble(), 2e-7, "Per-sample peak");
                    String expectedHash = text(input); comparedSamples++;
                    if (converted.pcmSha256.equals(expectedHash)) equalHashes++;
                    equal(converted.pcmSha256, pcmSha(pcm[s]), "Report native PCM hash");
                    for (int f = 0; f < frames; f++) {
                        float expected = input.readFloat(), actual = pcm[s][f];
                        double error = Math.abs((double) actual - expected); maxError = Math.max(maxError, error);
                        comparedFrames++;
                        if (Float.floatToRawIntBits(actual) == Float.floatToRawIntBits(expected)) equalFrames++;
                        if (!Float.isFinite(actual) || error > 2e-7) throw new AssertionError(kit + " " + rate + " sample " + s + " frame " + f + " differs: " + error);
                    }
                    byteCount += (long) frames * 4;
                }
                check(byteCount == report.preparedBytes, "Measured prepared memory");
                check(input.readInt() == 5 && bank.getInstrumentCount() == 5, "Exactly five live instruments");
                for (int i = 0; i < 5; i++) {
                    LiveDrumPool.Instrument instrument = bank.getInstrument(i);
                    equal(instrument.id, text(input), "Instrument order"); same(instrument.gain, input.readDouble(), "Original gain");
                    equal(instrument.chokeGroup == null ? "" : instrument.chokeGroup, text(input), "Choke group");
                    check(instrument.oneShot && instrument.getZoneCount() == input.readInt(), "One-shot zones");
                    for (int z = 0; z < instrument.getZoneCount(); z++) {
                        LiveDrumPool.Zone zone = instrument.getZone(z);
                        check(zone.sampleIndex == input.readInt() && zone.keyLow == input.readInt() && zone.keyHigh == input.readInt(), "Zone sample/key range");
                        same(zone.velocityLow, input.readDouble(), "Velocity lower inclusive bound");
                        same(zone.velocityHigh, input.readDouble(), "Velocity upper inclusive bound");
                    }
                }
                // Actual prepared PCM can drive the unchanged native pool without unmapped notes.
                LiveDrumPool pool = new LiveDrumPool(rate, bank);
                for (int[] event : new int[][] {{5,36},{6,38},{7,42},{8,45},{8,47},{8,49},{9,49}}) check(pool.trigger(event[0], event[1], .8, .5), "Prepared bank routes score drums");
                double[] gains = {1,1,1,1,1}; double energy = 0;
                for (int frame = 0; frame < rate / 10; frame++) { pool.next(gains); energy += pool.getOutputL() * pool.getOutputL(); }
                check(energy > 0 && pool.getStats().getUnmapped() == 0, "Prepared pool emits finite energy");
                try { report.banks.clear(); throw new AssertionError("Mutable reports"); } catch (UnsupportedOperationException expected) { assertions++; }
                try { report.converted.clear(); throw new AssertionError("Mutable reports"); } catch (UnsupportedOperationException expected) { assertions++; }
                try { report.instrumentBanks.clear(); throw new AssertionError("Mutable provenance"); } catch (UnsupportedOperationException expected) { assertions++; }
                System.out.println("Native/JS bank parity: " + kit + " " + rate + " Hz, " + samples + " samples");
            }
            check(input.read() == -1, "Complete fixture consumed");
        }
    }

    private static void failurePaths(Path docs) throws Exception {
        int[] opens = {0}; AssetReader never = path -> { opens[0]++; throw new AssertionError("Unexpected asset I/O"); };
        for (String kit : new String[] {null, "", "procedural", "../vcsl", "audio-kit/vcsl", "https://x/", "VCSL", "vcsl\0", "vcsl%2f"}) rejects(() -> prepare(kit, 48000, never), "closed kit id");
        for (int rate : new int[] {-1, 0, 7999, 192001, Integer.MAX_VALUE}) rejects(() -> prepare("vcsl", rate, never), "rate");
        for (Budgets limits : new Budgets[] {new Budgets(0,16<<20,16<<20,16<<20), new Budgets(12<<20,0,16<<20,16<<20), new Budgets(12<<20,16<<20,0,16<<20), new Budgets(12<<20,16<<20,16<<20,0)}) rejects(() -> prepare("vcsl", 48000, never, limits), "preflight budget");
        rejects(() -> new Budgets(13<<20,0,0,0), "raised encoded cap");
        rejects(() -> new Budgets(0,-1,0,0), "negative cap");
        check(opens[0] == 0, "All invalid requests rejected before I/O");
        for (String path : new String[] {"audio-kit/SOURCE_LOCK.json", "audio-kit/assets/cc0-mini/manifest.json", "audio-kit/assets/cc0-mini/marimba-c.wav", "audio-kit/assets/guigui-drums/snare-hard.wav"}) {
            for (int mode = 1; mode <= 5; mode++) {
                TrackingReader reader = new TrackingReader(docs); reader.changedPath = path; reader.mode = mode;
                try {
                    rejects(() -> prepare("guigui-dynamic", 48000, reader), "Corrupt/truncated/oversized/failing/interrupted asset");
                    if (mode == 5) check(Thread.currentThread().isInterrupted(), "Interrupted status retained");
                } finally { Thread.interrupted(); }
                check(reader.opened == reader.closed, "Failure closes every opened stream");
                if (path.endsWith("manifest.json")) check(reader.opened == 2, "Manifest rejected before any WAV");
            }
        }
        Thread.currentThread().interrupt();
        try { rejects(() -> prepare("vcsl", 48000, never), "Already interrupted"); check(Thread.currentThread().isInterrupted(), "Interrupt flag preserved"); }
        finally { Thread.interrupted(); }
        byte[] data = {1,2,3,4}; int[] closed = {0};
        AssetReader zeroReader = path -> new ByteArrayInputStream(data) {
            @Override public synchronized int read(byte[] b, int off, int length) { return 0; }
            @Override public void close() { closed[0]++; }
        };
        check(Arrays.equals(readVerified(zeroReader, "audio-kit/test.wav", 4, sha(data), 44), data), "Zero-length read makes bounded progress");
        check(closed[0] == 1, "Zero-read stream closed");
        for (String path : new String[] {"../x", "/x", "a/../x", "a/./x", "a//x", "a/", "http://x", "a\\x", "a%2fx", "a\0x", "é.wav"}) rejects(() -> readVerified(never, path, 4, sha(data), 44), "Path traversal/encoding");
        check(opens[0] == 0, "Unsafe paths never reach reader");
        try { supportedKits().clear(); throw new AssertionError("Mutable registry"); } catch (UnsupportedOperationException expected) { assertions++; }
        check(supportedKits().size() == 9, "Closed nine-kit registry");
    }

    private static SourceSpec replace(SourceSpec old, String path, List<SampleSpec> samples, List<InstrumentSpec> instruments) {
        return new SourceSpec(path, old.bytes, old.sha256, old.id, old.sourceCommit, samples, instruments);
    }
    private static void metadataBounds() throws Exception {
        SourceSpec base = NativeDrumCatalog.sources("vcsl").get(0);
        for (String path : Arrays.asList("../manifest.json", "assets/a/../manifest.json", "assets/a/%2e/manifest.json", "assets/a/test.json")) rejects(() -> preflight(Collections.singletonList(replace(base,path,base.samples,base.instruments)),48000,DEFAULT_BUDGETS), "Catalog manifest path");
        SampleSpec original = base.samples.get(0);
        for (SampleSpec sample : Arrays.asList(
                new SampleSpec(original.id,"../kick.wav",HASH,44,2,44100,60),
                new SampleSpec(original.id,"kick.wav",HASH,4*1024*1024+1,2,44100,60),
                new SampleSpec(original.id,"kick.wav",HASH,44,Integer.MAX_VALUE,44100,60),
                new SampleSpec(original.id,"kick.wav",HASH,44,2,7999,60),
                new SampleSpec(original.id,"kick.wav",HASH,44,2,44100,128))) {
            List<SampleSpec> samples = new ArrayList<>(base.samples); samples.set(0,sample);
            rejects(() -> preflight(Collections.singletonList(replace(base,base.path,samples,base.instruments)),48000,DEFAULT_BUDGETS), "Source metadata bounds");
        }
        List<SampleSpec> duplicate = new ArrayList<>(base.samples); duplicate.add(original);
        rejects(() -> preflight(Collections.singletonList(replace(base,base.path,duplicate,base.instruments)),48000,DEFAULT_BUDGETS), "Duplicate samples");
        List<InstrumentSpec> duplicateInstruments = new ArrayList<>(base.instruments); duplicateInstruments.add(base.instruments.get(0));
        rejects(() -> preflight(Collections.singletonList(replace(base,base.path,base.samples,duplicateInstruments)),48000,DEFAULT_BUDGETS), "Duplicate instruments");
        rejects(() -> preflight(Collections.singletonList(replace(base,base.path,base.samples,base.instruments.subList(1,base.instruments.size()))),48000,DEFAULT_BUDGETS), "Incomplete five instruments");
        List<SampleSpec> samples = Collections.singletonList(new SampleSpec("sample","sample.wav",HASH,244,100,44100,60));
        for (int variant=0; variant<7; variant++) {
            List<InstrumentSpec> definitions = new ArrayList<>();
            for (String id : Arrays.asList("kick","snare","closed-hat","toms","short-clash")) {
                ZoneSpec zone = new ZoneSpec(0, variant==0?0:60, variant==0?16:75, 0, 1, true);
                if(variant==2) zone=new ZoneSpec(1,60,60,0,1,false);
                if(variant==3) zone=new ZoneSpec(0,60,60,Double.NaN,1,false);
                if(variant==4) zone=new ZoneSpec(0,60,60,1,.5,false);
                List<ZoneSpec> zones = variant==6? Collections.nCopies(64,zone) : Collections.singletonList(zone);
                definitions.add(new InstrumentSpec(id,1,variant!=5,null,zones));
            }
            SourceSpec source = new SourceSpec("assets/test/manifest.json",44,HASH,"test",COMMIT,samples,definitions);
            rejects(() -> preflight(Collections.singletonList(source),48000,DEFAULT_BUDGETS), "Pitched range/sample count/zone limits");
        }
    }

    private static void le16(ByteArrayOutputStream out, int n) { out.write(n); out.write(n>>>8); }
    private static void le32(ByteArrayOutputStream out, int n) { le16(out,n); le16(out,n>>>16); }
    private static byte[] chunk(String tag, byte[] data, boolean pad) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); out.write(tag.getBytes(StandardCharsets.US_ASCII)); le32(out,data.length); out.write(data);
        if(pad&&(data.length&1)!=0)out.write(0); return out.toByteArray();
    }
    private static byte[] riff(byte[]... chunks) throws Exception {
        ByteArrayOutputStream payload = new ByteArrayOutputStream(); payload.write("WAVE".getBytes(StandardCharsets.US_ASCII));
        for(byte[] chunk:chunks)payload.write(chunk);
        ByteArrayOutputStream out=new ByteArrayOutputStream();out.write("RIFF".getBytes(StandardCharsets.US_ASCII));le32(out,payload.size());out.write(payload.toByteArray());return out.toByteArray();
    }
    private static byte[] fmt(int format,int channels,int rate,int bits) {
        ByteArrayOutputStream out=new ByteArrayOutputStream();le16(out,format);le16(out,channels);le32(out,rate);le32(out,rate*channels*bits/8);le16(out,channels*bits/8);le16(out,bits);return out.toByteArray();
    }
    private static void put32(byte[] bytes,int at,int n){for(int b=0;b<4;b++)bytes[at+b]=(byte)(n>>>(b*8));}
    private static void wavFailures() throws Exception {
        byte[] format=chunk("fmt ",fmt(1,1,44100,16),true), data=chunk("data",new byte[]{0,0,(byte)255,127,0,(byte)128},true);
        byte[] good=riff(format,data);
        float[] decoded=decodeWav(good,null,1024);
        check(Arrays.equals(decoded,new float[]{0,32767/32768f,-1}),"Exact PCM16 extrema, no normalization");
        check(Arrays.equals(decoded,decodeWav(riff(chunk("JUNK",new byte[]{1},true),data,format),null,1024)),"Padded ancillary chunks and fmt after data accepted");
        byte[] good24=riff(chunk("fmt ",fmt(1,1,48000,24),true),chunk("data",new byte[]{0,0,(byte)128,(byte)255,(byte)255,127,0,0,0},true));
        check(Arrays.equals(decodeWav(good24,null,1024),new float[]{-1,8388607/8388608f,0}),"Exact signed PCM24 conversion");
        List<byte[]> bad=new ArrayList<>();
        bad.add(Arrays.copyOf(good,good.length-1));bad.add(Arrays.copyOf(good,good.length+1));bad.add(riff(format,data,data));bad.add(riff(format,format,data));
        bad.add(riff(format,chunk("data",new byte[]{0,0,0},true)));bad.add(riff(format,chunk("data",new byte[]{0,0},true)));
        bad.add(riff(format,data,chunk("JUNK",new byte[]{1},false)));bad.add(riff(chunk("fmt ",new byte[15],true),data));
        bad.add(riff(chunk("fmt ",fmt(3,1,44100,16),true),data));bad.add(riff(chunk("fmt ",fmt(1,2,44100,16),true),data));
        bad.add(riff(chunk("fmt ",fmt(1,1,44100,32),true),data));bad.add(riff(chunk("fmt ",fmt(1,1,7999,16),true),data));
        bad.add(riff(chunk("fmt ",fmt(1,1,192001,16),true),data));bad.add(riff(format,chunk("JUNK",new byte[8],true)));
        byte[] wrong=good.clone();wrong[0]='X';bad.add(wrong);
        wrong=good.clone();put32(wrong,4,-1);bad.add(wrong);
        wrong=good.clone();put32(wrong,16,-1);bad.add(wrong);
        wrong=good.clone();wrong[32]=4;bad.add(wrong);
        wrong=good.clone();put32(wrong,28,88201);bad.add(wrong);
        wrong=good.clone();wrong[8]='X';bad.add(wrong);
        for(byte[] invalid:bad)rejects(()->decodeWav(invalid,null,1024),"RIFF corruption/format/shape");
        rejects(()->decodeWav(good,null,8),"Decoded budget before allocation");
        rejects(()->decodeWav(good,new SampleSpec("sample","sample.wav",HASH,good.length,4,44100,60),1024),"Manifest frame mismatch");
        rejects(()->decodeWav(good,new SampleSpec("sample","sample.wav",HASH,good.length,3,48000,60),1024),"Manifest sample rate mismatch");
        float[] source={0,1,-1,.5f,0};float[] saved=source.clone();float[] result=reconstruct(source,1);
        check(Arrays.equals(source,saved)&&!Arrays.equals(source,result),"Reconstruction is not normalized/identity bypass; source unchanged");
        for(double ratio:new double[]{0,.124999,8.000001,Double.NaN,Double.POSITIVE_INFINITY}) rejects(()->reconstruct(source,ratio),"Resampling ratio bounds");
        rejects(()->reconstruct(new float[]{Float.NaN,0},1),"Nonfinite reconstruction");
        rejects(()->reconstruct(new float[]{3,3},1),"Reconstruction range");
        CountDownLatch started=new CountDownLatch(1);AtomicReference<Throwable> outcome=new AtomicReference<>();
        Thread worker=new Thread(()->{try{started.countDown();reconstruct(new float[4*1024*1024],1);outcome.set(new AssertionError("Cancellation ignored"));}catch(Throwable failure){outcome.set(failure);}},"bank-test-worker");
        worker.start();started.await();worker.interrupt();worker.join(5000);
        check(!worker.isAlive()&&outcome.get() instanceof InterruptedIOException,"Long reconstruction cancellation bounded");
    }

    public static void main(String[] args) throws Exception {
        Path docs=Path.of(args[0]);failurePaths(docs);metadataBounds();wavFailures();parity(docs,Path.of(args[1]));
        System.out.println("PASS " + assertions + " API/bounds assertions; " + comparedFrames + " Float32 frames compared, " + equalFrames + " bit-exact; " + equalHashes + "/" + comparedSamples + " sample hashes identical; maximum absolute PCM error " + maxError);
    }
}
