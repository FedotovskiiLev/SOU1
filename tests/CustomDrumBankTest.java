// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.sou1.audio.NativeDrumBankLoader.*;
/** Actual packaged WAV parity and selector/budget checks, not device qualification. */
public final class CustomDrumBankTest {
    private static int assertions, exactHashes, samples, cases;
    private static long frames, exactFrames;
    private static double maxError;
    @FunctionalInterface private interface Throwing { void run() throws Exception; }
    private static void check(boolean yes, String why) { assertions++; if (!yes) throw new AssertionError(why); }
    private static void eq(Object actual, Object expected, String why) { check(actual.equals(expected), why + ": " + actual + " != " + expected); }
    private static void same(double actual, double expected, String why) { check(Double.doubleToLongBits(actual) == Double.doubleToLongBits(expected), why); }
    private static void near(double actual, double expected, double tolerance, String why) { check(Double.isFinite(actual) && Math.abs(actual - expected) <= tolerance, why); }
    private static void rejects(Throwing action) throws Exception { try { action.run(); } catch (IOException | IllegalArgumentException expected) { assertions++; return; } throw new AssertionError("Invalid request accepted"); }
    private static String text(DataInputStream in) throws IOException { int length = in.readInt(); if (length < 0 || length > 4096) throw new IOException("Fixture text"); byte[] b = new byte[length]; in.readFully(b); return new String(b, StandardCharsets.UTF_8); }
    private static float[][] pcm(LiveDrumPool.Bank bank) throws Exception { Field f = LiveDrumPool.Bank.class.getDeclaredField("samples"); f.setAccessible(true); return (float[][]) f.get(bank); }
    private static Map<String, String> mixed() { Map<String, String> m = new LinkedHashMap<>(); m.put("kick","fsa-distkit"); m.put("snare","fsa-synthkit"); m.put("hihat","fsa-x0xproc2"); m.put("toms","guigui-soft"); m.put("cymbal","guigui-dynamic"); return m; }
    @SuppressWarnings("unchecked")
    private static Map<String, String> wrongValue() {
        Map<String, Object> bad = new LinkedHashMap<>(); bad.put("kick", Integer.valueOf(4));
        return (Map<String, String>) (Map<?, ?>) bad;
    }
    private static void invalid() throws Exception {
        final int[] opens = {0}; AssetReader never = path -> { opens[0]++; throw new AssertionError("Unexpected I/O"); };
        String key = customSelectionKey("vcsl", mixed()); eq(parseCustomSelection(key).key,key,"Roundtrip");
        for (String kit : supportedKits()) { eq(customSelectionKey(kit,Collections.emptyMap()),kit,"Default key"); eq(customSelectionKey(kit,Collections.singletonMap("kick",kit)),kit,"Base override canonicalizes"); }
        for (String kit : new String[] {null,"","procedural","../vcsl","https://x","VCSL"}) rejects(() -> prepareCustom(kit,mixed(),48000,never));
        for (String k : new String[] {null,"","procedural", "custom-v1|vcsl|inherit|inherit|inherit|inherit|inherit", "custom-v1|vcsl|vcsl|fsa-distkit|inherit|inherit|inherit", key+"|extra",key+"\0"}) rejects(() -> prepareSelection(k,48000,never));
        for (String role : new String[] {"unknown","closed-hat","",null}) rejects(() -> prepareCustom("vcsl",Collections.singletonMap(role,"vcsl"),48000,never));
        for (String kit : new String[] {"procedural","","../vcsl",null}) rejects(() -> prepareCustom("vcsl",Collections.singletonMap("kick",kit),48000,never));
        rejects(() -> prepareCustom("vcsl",null,48000,never));
        rejects(() -> prepareCustom("vcsl",wrongValue(),48000,never));
        Map<String, String> changing = mixed(); CustomSelection snapshot = normalizeCustomSelection("vcsl",changing);
        changing.put("kick","vcsl"); eq(snapshot.overrides.get("kick"),"fsa-distkit","Input map copied");
        Map<String, String> reversed = new LinkedHashMap<>(); for (int i=CUSTOM_ROLES.size()-1;i>=0;i--) reversed.put(CUSTOM_ROLES.get(i),mixed().get(CUSTOM_ROLES.get(i)));
        eq(customSelectionKey("vcsl",reversed),key,"Map insertion order independent");
        for (int rate : new int[] {0,7999,192001,Integer.MAX_VALUE}) rejects(() -> prepareSelection(key,rate,never));
        for (Budgets budgets : new Budgets[] {new Budgets(0,16<<20,16<<20,16<<20),new Budgets(12<<20,0,16<<20,16<<20),new Budgets(12<<20,16<<20,0,16<<20),new Budgets(12<<20,16<<20,16<<20,0)}) rejects(() -> prepareSelection(key,48000,never,budgets));
        check(opens[0]==0,"Invalid selectors and caps fail before any I/O");
        CustomSelection s = parseCustomSelection(key);
        try { s.overrides.clear(); throw new AssertionError("Mutable overrides"); } catch (UnsupportedOperationException expected) { assertions++; }
        try { s.resolvedKits.clear(); throw new AssertionError("Mutable resolved kits"); } catch (UnsupportedOperationException expected) { assertions++; }
        Thread.currentThread().interrupt(); try { rejects(() -> prepareSelection(key,48000,never)); check(Thread.currentThread().isInterrupted(),"Interrupt retained"); } finally { Thread.interrupted(); }
    }
    private static void defaults(Path docs) throws Exception {
        AssetReader reader = path -> Files.newInputStream(docs.resolve(path));
        for (String kit : supportedKits()) {
            Prepared original=prepare(kit,48000,reader), inherited=prepareSelection(kit,48000,reader);
            check(inherited.report.selection==null&&inherited.report.memory==null,"Original report path unchanged");
            eq(inherited.report.instrumentBanks,original.report.instrumentBanks,"Original provenance");
            check(Arrays.deepEquals(pcm(inherited.bank),pcm(original.bank)),"Default PCM exact");
            for (int i=0;i<original.report.converted.size();i++) eq(inherited.report.converted.get(i).pcmSha256,original.report.converted.get(i).pcmSha256,"Default hashes exact");
        }
    }
    private static void parity(Path docs, Path fixture) throws Exception {
        try (DataInputStream in = new DataInputStream(Files.newInputStream(fixture))) {
            eq(text(in),"sou1.custom-drum-vectors.v1","Schema"); int count=in.readInt();check(count==10,"Ten mixed bank/rate cases");
            for (int n=0;n<count;n++) {
                String key=text(in);int rate=in.readInt(); final int[] opened={0},closed={0};
                AssetReader reader=path->{opened[0]++;return new FilterInputStream(Files.newInputStream(docs.resolve(path))){ @Override public void close()throws IOException{closed[0]++;super.close();}};};
                Prepared result=prepareSelection(key,rate,reader);Report r=result.report;LiveDrumPool.Bank b=result.bank;
                eq(r.selection.key,key,"Selection");check(opened[0]==closed[0],"Source streams closed");
                check(r.encodedBytes==in.readInt(),"Encoded sum");check(r.sourceDecodedBytes==in.readInt(),"Decoded sum");check(r.sourceMappedBytes==in.readInt(),"Mapped sum");check(r.preparedBytes==in.readInt(),"Prepared size");near(r.preparedPeak,in.readDouble(),2e-7,"Peak");
                check(r.banks.size()==in.readInt(),"Source count");for(Source s:r.banks){eq(s.id,text(in),"Source ID");eq(s.manifest,text(in),"Manifest");eq(s.sha256,text(in),"Manifest hash");eq(s.sourceCommit,text(in),"Commit");}
                for(String id:Arrays.asList("kick","snare","closed-hat","toms","short-clash"))eq(r.instrumentBanks.get(id),text(in),"Instrument provenance");
                for(String role:CUSTOM_ROLES){RoleSource s=r.roleSources.get(role);eq(s.kit,text(in),"Role kit");eq(s.id,text(in),"Role bank");eq(s.manifest,text(in),"Role manifest");eq(s.sha256,text(in),"Role hash");eq(s.sourceCommit,text(in),"Role commit");}
                check(b.getSampleCount()==in.readInt(),"Sample count");float[][] pcm=pcm(b);
                for(int i=0;i<b.getSampleCount();i++) {
                    Conversion c=r.converted.get(i);int length=in.readInt();check(c.frames==length&&pcm[i].length==length,"Frames");check(c.sourceRate==in.readInt(),"Rate");check((c.pitch==null?-1:c.pitch)==in.readInt(),"Pitch");near(c.step,in.readDouble(),2e-15,"Step");near(c.peak,in.readDouble(),2e-7,"Sample peak");String hash=text(in);samples++;if(c.pcmSha256.equals(hash))exactHashes++;
                    check(r.sampleOrigins.get(i).size()==in.readInt(),"Origin count");for(SampleOrigin s:r.sampleOrigins.get(i)){eq(s.role,text(in),"Origin role");eq(s.kit,text(in),"Origin kit");eq(s.bankId,text(in),"Origin bank");eq(s.manifest,text(in),"Origin manifest");eq(s.manifestSha256,text(in),"Origin manifest hash");eq(s.sourceCommit,text(in),"Origin commit");eq(s.sampleId,text(in),"Origin sample");eq(s.file,text(in),"Origin file");eq(s.sha256,text(in),"Origin WAV hash");check(s.sourceRate==in.readInt()&&s.rootNote==in.readInt(),"Origin rate/root");}
                    for(int j=0;j<length;j++){float expected=in.readFloat(),actual=pcm[i][j];double error=Math.abs((double)expected-actual);maxError=Math.max(maxError,error);frames++;if(Float.floatToRawIntBits(expected)==Float.floatToRawIntBits(actual))exactFrames++;if(!Float.isFinite(actual)||error>2e-7)throw new AssertionError("PCM differs: "+key+" sample "+i+" frame "+j+" error "+error);}
                }
                check(in.readInt()==5&&b.getInstrumentCount()==5,"Five roles");for(int i=0;i<5;i++){LiveDrumPool.Instrument instrument=b.getInstrument(i);eq(instrument.id,text(in),"Instrument order");same(instrument.gain,in.readDouble(),"Gain");eq(instrument.chokeGroup==null?"":instrument.chokeGroup,text(in),"Choke");check(instrument.getZoneCount()==in.readInt(),"Zone count");for(int j=0;j<instrument.getZoneCount();j++){LiveDrumPool.Zone z=instrument.getZone(j);check(z.sampleIndex==in.readInt()&&z.keyLow==in.readInt()&&z.keyHigh==in.readInt(),"Zone/index/key order");same(z.velocityLow,in.readDouble(),"Velocity low");same(z.velocityHigh,in.readDouble(),"Velocity high");}}
                check(r.memory.publicationCopyBytes==r.preparedBytes&&r.memory.transientPcmBytesUpperBound>=2*r.preparedBytes,"Native immutable-bank copy budgeted");
                try{r.sampleOrigins.get(0).clear();throw new AssertionError("Mutable origins");}catch(UnsupportedOperationException expected){assertions++;}
                LiveDrumPool pool=new LiveDrumPool(rate,b);for(int[] event:new int[][]{{5,36},{6,38},{7,42},{8,45},{8,47},{8,49},{9,49}})check(pool.trigger(event[0],event[1],.8,.5),"Live role mapping");double[] gains={1,1,1,1,1};double energy=0;for(int f=0;f<rate/10;f++){pool.next(gains);energy+=pool.getOutputL()*pool.getOutputL();}check(energy>0&&pool.getStats().getUnmapped()==0,"Mixed pool output");
                cases++;System.out.println("Custom native parity: "+key+" @ "+rate);
            }
            check(in.read()==-1,"Fixture fully consumed");
        }
    }
    public static void main(String[] args)throws Exception{Path docs=Path.of(args[0]);invalid();defaults(docs);parity(docs,Path.of(args[1]));System.out.println("Custom drums PASS: "+assertions+" assertions, "+cases+" cases, "+exactFrames+"/"+frames+" exact Float32 frames, "+exactHashes+"/"+samples+" exact hashes, maximum error "+maxError);}
}
