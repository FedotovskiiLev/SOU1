// SPDX-License-Identifier: AGPL-3.0-only
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicReference;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
import org.sou1.audio.LiveDrumPool;

/** Pure JVM integration tests. Synthetic PCM, no Android/device or asset-load claims. */
public final class RecordedDrumEngineTest {
    private static int checks;
    private static final String[] IDS = {"kick","snare","closed-hat","toms","short-clash"};
    private static void check(boolean value, String description) {
        checks++; if (!value) throw new AssertionError(description);
    }
    static LiveDrumPool.Bank bank(int rate) {
        float[][] pcm = new float[6][rate / 2];
        for (int j=0;j<pcm.length;j++) for(int i=0;i<pcm[j].length;i++)
            pcm[j][i] = (float) ((((i*13+j*11)%97)-48)/61.0);
        LiveDrumPool.Instrument[] instruments = new LiveDrumPool.Instrument[5];
        for(int i=0;i<5;i++) {
            LiveDrumPool.Zone[] zones;
            if(i==3) zones = new LiveDrumPool.Zone[]{zone(3,45,45),zone(4,47,47),zone(5,49,49)};
            else if(i==1) zones = new LiveDrumPool.Zone[]{zone(1,0,127),zone(2,0,127)};
            else zones = new LiveDrumPool.Zone[]{zone(i,0,127)};
            instruments[i] = new LiveDrumPool.Instrument(IDS[i],.6+i/20.0,true,
                    i==2||i==4 ? "metal" : null,zones);
        }
        return new LiveDrumPool.Bank(rate,pcm,instruments);
    }
    private static LiveDrumPool.Zone zone(int sample,int low,int high) {
        return new LiveDrumPool.Zone(sample,low,high,0,1);
    }
    static Parameters parameters(boolean enabled, boolean wet, int gains) {
        return new Parameters(.82,.68,.61,.43,wet?.8:0,wet?.4:0,wet?.9:.5,wet?.65:0,
            0,0,0,0,0,.6,wet?2:0,wet?.3:0,wet?.2:0,wet?.4:0,
            2,137,24,false,enabled,gains==0?.8:.1,gains==0?.7:.2,gains==0?.6:.3,
            gains==0?.5:.4,gains==0?.4:.5,0,0,0,0,.8,.9,.37);
    }
    private static LiveDrumPool pool(AmbientEngine engine) throws Exception {
        Field f=AmbientEngine.class.getDeclaredField("recordedDrums");f.setAccessible(true);
        return (LiveDrumPool)f.get(engine);
    }
    private static void hit(AmbientEngine engine,int layer,int pitch,long duration,double velocity,double pan) throws Exception {
        Method m=AmbientEngine.class.getDeclaredMethod("noteOn",long.class,int.class,int.class,long.class,double.class,double.class);
        m.setAccessible(true);m.invoke(engine,engine.getFrame(),layer,pitch,duration,velocity,pan);
    }
    private static void render(AmbientEngine engine,int frames) {
        float[] output=new float[256];
        while(frames>0){int count=Math.min(128,frames);engine.render(output,0,count);frames-=count;
            for(int i=0;i<count*2;i++)check(Float.isFinite(output[i])&&Math.abs(output[i])<.85,"finite shared-limited PCM");}
    }
    private static void legacy(Path fixtures) throws Exception {
        for(String line:Files.readAllLines(fixtures)) {
            String[] parts=line.split(" ");
            check(line.equals(LegacyEnginePcmFixture.fixture(Integer.parseInt(parts[0]),Integer.parseInt(parts[1]))),
                "frozen pre-change PCM and score fixture "+parts[0]+"/"+parts[1]);
        }
        AmbientEngine a=new AmbientEngine(8000,71),b=new AmbientEngine(8000,71,null);
        a.start();b.start();float[] x=new float[256],y=new float[256];
        for(int i=0;i<100;i++){a.render(x,0,128);b.render(y,0,128);check(Arrays.equals(x,y),"null bank retains old path");}
    }
    private static void disabledIdentity() {
        for(int rate:new int[]{8000,44100,48000})for(boolean wet:new boolean[]{false,true}){
            AmbientEngine old=new AmbientEngine(rate,7311),recorded=new AmbientEngine(rate,7311,bank(rate));
            Parameters p=wet?LegacyEnginePcmFixture.parameters(false,true,1):Parameters.DEFAULT;
            old.setParameters(p);recorded.setParameters(p);old.start();recorded.start();
            float[] a=new float[256],b=new float[256];short[] c=new short[256],d=new short[256];
            for(int i=0;i<500;i++){
                if(i==200){old.reseed(81);recorded.reseed(81);}
                if(i==350){old.stop();recorded.stop();}
                if((i&1)==0){old.render(a,0,128);recorded.render(b,0,128);check(Arrays.equals(a,b),"disabled float PCM exact");}
                else{old.render(c,0,128);recorded.render(d,0,128);check(Arrays.equals(c,d),"disabled short PCM exact");}
                check(old.getNoteOnCount()==recorded.getNoteOnCount(),"disabled event counters");
            }
            check(old.getScoreSnapshot().equals(recorded.getScoreSnapshot()),"disabled score export exact");
        }
    }
    private static void eventsAndRouting() throws Exception {
        int rate=8000;AmbientEngine old=new AmbientEngine(rate,91),engine=new AmbientEngine(rate,91,bank(rate));
        Parameters p=LegacyEnginePcmFixture.parameters(true,true,2);old.setParameters(p);engine.setParameters(p);
        old.start();engine.start();float[] a=new float[256],b=new float[256];double difference=0;
        for(int i=0;i<3000;i++){old.render(a,0,128);engine.render(b,0,128);
            for(int j=0;j<a.length;j++)difference+=Math.abs(a[j]-b[j]);
            check(engine.getActiveDrumVoiceCount()<=16,"fixed recorded cap");
            check(engine.getActiveVoiceCount()<=p.polyphony,"independent melodic cap");}
        check(difference>1,"recorded bank changes sound");
        check(old.getScoreSnapshot().equals(engine.getScoreSnapshot()),"all generated score fields unchanged, including tom pitch and gate");
        check(pool(engine).getStats().getUnmapped()==0,"all generated tom pitches matched");
        check(pool(engine).getStats().getAccepted()>100,"recorded drum events reached pool");
        // Force each tom pitch, then compare exact internal pool output to its independent reference.
        for(int pitch:new int[]{45,47,49}){
            AmbientEngine e=new AmbientEngine(rate,7,bank(rate));e.setParameters(parameters(true,false,0));
            e.render(new float[0],0,0);hit(e,8,pitch,19,.8,.25);
            LiveDrumPool reference=new LiveDrumPool(rate,bank(rate));reference.trigger(8,pitch,.8,.25);
            double[] gains={1,1,1,1,1};
            for(int frame=0;frame<40;frame++){pool(e).next(gains);reference.next(gains);
                check(pool(e).getOutputL()==reference.getOutputL()&&pool(e).getOutputR()==reference.getOutputR(),"exact tom pitch routing");}
            check(e.getScoreSnapshot().contains(",8.0,"+pitch+".0,19.0,0.8]"),"score retains pitch and duration");
        }
        AmbientEngine e=new AmbientEngine(rate,7,bank(rate));e.setParameters(parameters(true,false,0));e.render(new float[0],0,0);
        for(int i=0;i<20;i++)hit(e,6,38,1,.8,.5);
        check(e.getActiveDrumVoiceCount()==16&&e.getNoteOnCount()==16&&e.getDroppedNotes()==4,"accepted/dropped counters reflect bounded pool");
        check(e.getActiveVoiceCount()==0,"drums never consume melodic voices");
        hit(e,8,46,1,.8,.5);check(e.getDroppedNotes()==5,"unmapped pitch does not fall back to synthesis");
    }
    private static void controls() throws Exception {
        for(int rate:new int[]{8000,44100,48000}){
            AmbientEngine e=new AmbientEngine(rate,91,bank(rate));Parameters enabled=parameters(true,true,0),disabled=parameters(false,true,0);
            e.setParameters(enabled);e.start();render(e,rate);check(e.getActiveDrumVoiceCount()>0,"live recorded hits");
            LiveDrumPool pool=pool(e);long accepted=pool.getStats().getAccepted();
            e.stop();render(e,1);check(!e.isSilent()&&pool.getActiveVoices()>0,"ordinary stop preserves 50 ms tail");
            e.start();render(e,1);check(pool.getStats().getAccepted()==accepted&&pool.getActiveVoices()>0,"restart during fade does not reset/retrigger pool");
            e.setParameters(disabled);check(pool.isEnabled(),"control thread only publishes target");
            render(e,1);check(!pool.isEnabled(),"disable applied on rendering thread before score");
            render(e,(int)Math.round(rate*.05));check(e.getActiveDrumVoiceCount()==0,"disable releases within 50 ms");
            check(pool.getStats().getAccepted()==accepted,"disabled controls emit no hits");
            e.setParameters(enabled);render(e,rate);check(pool.getStats().getAccepted()>accepted,"enable resumes");
            long before=e.getNoteOnCount();e.reseed(99);e.reseed(100);render(e,(int)Math.ceil(rate*.08));
            check(e.getScore().seed==100&&e.isPlayingRequested()&&e.getParameters()==enabled,"coalesced live reseed preserves targets/transport");
            check(e.getNoteOnCount()>=before&&pool.getStats().getAccepted()<accepted,"reseed clears pool/RR, not accumulated engine counters");
            e.stop();render(e,rate*3);check(e.isSilent()&&e.getActiveDrumVoiceCount()==0,"stop drains recorded pool");
            check(e.getNoteOnCount()==e.getNoteOffCount(),"each accepted one-shot retires once");
            float[] zero=new float[256];e.render(zero,0,128);for(float v:zero)check(v==0,"stopped output exact silence");
            e.reseed(101);check(e.getScore().seed==101&&e.isSilent(),"silent reseed applies immediately");
            e.reset();check(e.getFrame()==0&&e.getNoteOnCount()==0&&e.getNoteOffCount()==0&&e.getDroppedNotes()==0,"reset diagnostics");
            check(e.getParameters()==enabled&&!e.isPlayingRequested()&&pool.getStats().getAccepted()==0,"reset keeps targets and clears pool stats");
            e.start();render(e,1);check(e.getActiveDrumVoiceCount()>0,"reset can restart");
            e.stop();render(e,1);check(e.isSilent()&&e.getActiveDrumVoiceCount()==0,"one-frame stop cannot freeze tails");
            e.start();render(e,1);check(e.getActiveDrumVoiceCount()==0,"restart cannot resurrect stopped drum tails");
        }
    }
    private static void immutableSharedBank() {
        int rate=8000;LiveDrumPool.Bank bank=bank(rate);
        AmbientEngine a=new AmbientEngine(rate,91,bank),b=new AmbientEngine(rate,91,bank);
        Parameters p=parameters(true,true,0);a.setParameters(p);b.setParameters(p);a.start();b.start();
        float[] x=new float[16000],y=new float[16000];a.render(x,0,8000);
        for(int at=0;at<8000;at+=100)b.render(y,at*2,100);
        check(Arrays.equals(x,y),"shared immutable bank has independent voices/RR and chunk-independent PCM");
        try{new AmbientEngine(44100,1,bank);throw new AssertionError("rate mismatch accepted");}catch(IllegalArgumentException expected){checks++;}
    }
    private static void concurrentControls() throws Exception {
        AmbientEngine e=new AmbientEngine(8000,91,bank(8000));Parameters on=parameters(true,true,0),off=parameters(false,false,1);
        AtomicReference<Throwable> failure=new AtomicReference<>();
        Thread control=new Thread(()->{try{for(int i=0;i<100000;i++){e.setParameters((i&1)==0?on:off);if((i&3)==0)e.stop();else e.start();}}catch(Throwable t){failure.set(t);}},"controls");
        control.start();float[] out=new float[256];
        for(int i=0;i<2000;i++){e.render(out,0,128);check(e.getActiveDrumVoiceCount()<=16,"concurrent controls keep pool bounded");for(float v:out)check(Float.isFinite(v)&&Math.abs(v)<.85,"concurrent finite PCM");}
        control.join();check(failure.get()==null,"control producer completed");e.setParameters(off);e.stop();render(e,24000);
        check(e.isSilent()&&e.getActiveDrumVoiceCount()==0,"final control snapshot converges");
    }
    @SuppressWarnings("deprecation")
    private static void allocations() {
        java.lang.management.ThreadMXBean generic=ManagementFactory.getThreadMXBean();
        if(!(generic instanceof com.sun.management.ThreadMXBean bean)||!bean.isThreadAllocatedMemorySupported()){
            System.out.println("SKIP render allocation counter: JVM does not expose it");return;
        }
        bean.setThreadAllocatedMemoryEnabled(true);
        AmbientEngine e=new AmbientEngine(8000,91,bank(8000));Parameters on=parameters(true,true,0),off=parameters(false,true,1);
        float[] out=new float[256];e.setParameters(on);e.start();
        for(int i=0;i<10000;i++)e.render(out,0,128);
        long id=Thread.currentThread().getId(),before=bean.getThreadAllocatedBytes(id);
        for(int i=0;i<5000;i++){
            if(i%101==0)e.setParameters((i%202==0)?off:on);
            if(i%257==0)e.reseed(i);
            if(i%331==0)e.stop();else if(i%331==2)e.start();
            if(i%997==0){e.reset();e.start();}
            e.render(out,0,128);
        }
        long bytes=bean.getThreadAllocatedBytes(id)-before;
        check(bytes==0,"no allocations in warmed render/control/reset/reseed loop, got "+bytes);
        System.out.println("PASS render allocation counter: "+bytes+" bytes across 640000 frames");
    }
    private static void vectors(Path dir) throws IOException {
        for(int rate:new int[]{8000,44100,48000})for(boolean wet:new boolean[]{false,true}){
            AmbientEngine engine=new AmbientEngine(rate,7311,bank(rate));engine.setParameters(parameters(true,wet,0));engine.start();
            int total=rate*6;ByteBuffer bytes=ByteBuffer.allocate(total*8).order(ByteOrder.LITTLE_ENDIAN);
            int[] boundaries={rate,rate*2,rate*9/4,rate*3,total};int boundary=0;
            float[] out=new float[256];
            for(int at=0;at<total;){
                if(at==rate)engine.setParameters(parameters(true,wet,1));
                if(at==rate*2)engine.setParameters(parameters(false,wet,1));
                if(at==rate*9/4)engine.setParameters(parameters(true,wet,1));
                if(at==rate*3)engine.stop();
                while(boundaries[boundary]<=at)boundary++;
                int frames=Math.min(128,boundaries[boundary]-at);engine.render(out,0,frames);
                for(int i=0;i<frames*2;i++)bytes.putFloat(out[i]);at+=frames;
            }
            String name=rate+"-"+(wet?"wet":"dry");Files.write(dir.resolve(name+".f32"),bytes.array());
            Files.writeString(dir.resolve(name+".json"),engine.getScoreSnapshot());
        }
    }
    public static void main(String[] args) throws Exception {
        if(args.length==2&&args[0].equals("vectors")){vectors(Path.of(args[1]));return;}
        legacy(Path.of(args[0]));disabledIdentity();eventsAndRouting();controls();immutableSharedBank();concurrentControls();allocations();
        System.out.println("PASS: "+checks+" native recorded-engine integration checks");
    }
}
