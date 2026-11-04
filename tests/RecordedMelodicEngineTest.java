// SPDX-License-Identifier: AGPL-3.0-only
import java.lang.management.ManagementFactory;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
import org.sou1.audio.DevelopmentConfig;
import org.sou1.audio.DevelopmentScore;
import org.sou1.audio.LiveMelodicPool;
import org.sou1.audio.NativeMelodicBankLoader;

/** Actual bundled WAVs on JVM. No Android AudioTrack, device or listening claim. */
public final class RecordedMelodicEngineTest {
    private static int checks;
    private static long renderedFrames;
    private static final Method NOTE;
    private static final Field POOL, GAINS;
    static {
        try {
            NOTE=AmbientEngine.class.getDeclaredMethod("noteOn",long.class,int.class,int.class,long.class,double.class,double.class);
            NOTE.setAccessible(true);
            POOL=AmbientEngine.class.getDeclaredField("recordedMelodies");POOL.setAccessible(true);
            GAINS=AmbientEngine.class.getDeclaredField("melodicGains");GAINS.setAccessible(true);
        } catch(ReflectiveOperationException e) { throw new ExceptionInInitializerError(e); }
    }
    private static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
    private static Parameters parameters(int limit,boolean melody,int phase,boolean events) {
        return new Parameters(.82,.68,.61,.43,.3,.2,.7,.25,.65,.55,.35,.20,.15,.8,2,0,0,0,
                0,phase==0?112:phase==1?180:72,limit,melody,false,.8,.7,.6,.5,.4,
                events?.15:0,events?.6:0,events?1:0,events?.35:0,.85,.85,.37);
    }
    private static double render(AmbientEngine engine,int frames) {
        float[] buffer=new float[256];double energy=0;
        while(frames>0){int n=Math.min(128,frames);engine.render(buffer,0,n);frames-=n;renderedFrames+=n;
            for(int i=0;i<n*2;i++){float v=buffer[i];check(Float.isFinite(v)&&Math.abs(v)<.85,"finite bounded PCM");energy+=v*v;}
            check(engine.getActiveVoiceCount()<=32,"shared sampler/fallback capacity <=32");
        }return energy;
    }
    private static void trigger(AmbientEngine e,int layer,int pitch,double gate,double velocity,double pan)throws Exception {
        NOTE.invoke(e,e.getFrame(),layer,pitch,Math.round(gate*e.getSampleRate()),velocity,pan);
    }
    private static AmbientEngine isolated(int rate,LiveMelodicPool.Bank bank,int limit,boolean melody) {
        AmbientEngine e=new AmbientEngine(rate,7311,null,bank,true);
        e.setParameters(parameters(limit,melody,0,false));e.start();e.render(new float[2],0,1);return e;
    }
    private static void coverage(LiveMelodicPool.Bank bank,String preset) {
        int[][] ranges={{45,74},{57,88},{48,88},{62,86},{33,52}};
        LiveMelodicPool p=new LiveMelodicPool(bank,32);
        for(int layer=0;layer<5;layer++)for(int pitch=ranges[layer][0];pitch<=ranges[layer][1];pitch++)for(double v:new double[]{0,.01,.3,.5,.8,1}){
            p.reset();boolean accepted=p.trigger(layer,pitch,1,v,.5);
            boolean mapped=!preset.equals("chamber-flute")||layer!=1||(pitch>=60&&pitch<=78);
            check(accepted==mapped&&p.unmapped==(mapped?0:1),"actual bank range/velocity coverage: "+preset+"/"+layer+"/"+pitch+"/"+v);
        }
    }
    private static void routes(int rate,LiveMelodicPool.Bank bank,String preset)throws Exception {
        AmbientEngine e=isolated(rate,bank,32,true);LiveMelodicPool reference=new LiveMelodicPool(bank,32);
        int[] pitches={57,72,76,74,38};
        for(int layer=0;layer<5;layer++){
            double gate=.25+layer*.1,velocity=.31+layer*.1,pan=.13+layer*.17;
            trigger(e,layer,pitches[layer],gate,velocity,pan);reference.trigger(layer,pitches[layer],gate,velocity,pan);
        }
        check(e.getRecordedMelodicAcceptedCount()==5&&e.getMelodicFallbackCount()==0,"five original events routed to sampler");
        LiveMelodicPool actual=(LiveMelodicPool)POOL.get(e);float[] one=new float[2];
        for(int frame=0;frame<rate;frame++){
            e.render(one,0,1);reference.next((double[])GAINS.get(e),true);
            check(actual.outputL==reference.outputL&&actual.outputR==reference.outputR,"exact original pitch/gate/velocity/pan sampler route");
        }
        for(int limit:new int[]{8,16,24,32}){
            e=isolated(rate,bank,limit,true);
            for(int n=0;n<50;n++)trigger(e,0,57,10,.5,.5);
            check(e.getActiveVoiceCount()==limit&&e.getRecordedMelodicAcceptedCount()==limit,"live polyphony selection "+limit);
            check(e.getRecordedMelodicDroppedCount()==50-limit&&e.getRecordedMelodicUnmappedCount()==0&&e.getMelodicFallbackCount()==0,"full capacity drops never fall back");
            e.setParameters(parameters(8,true,0,false));render(e,rate/10);
            check(e.getActiveVoiceCount()<=8,"polyphony reduction fades excess voices");
        }
        e=isolated(rate,bank,32,false);
        trigger(e,1,57,10,.5,.5);trigger(e,2,76,10,.5,.5);
        for(int layer:new int[]{0,3,4})trigger(e,layer,pitches[layer],10,.5,.5);
        check(e.getRecordedMelodicAcceptedCount()==3&&e.getRecordedMelodicDroppedCount()==2&&e.getMelodicFallbackCount()==0,"Melody mute excludes only1/2 without missing-range fallback");
        e.stop();e.render(one,0,0);trigger(e,1,57,10,.5,.5);
        check(e.getRecordedMelodicDroppedCount()==3&&e.getRecordedMelodicUnmappedCount()==0,"disabled pool never falls back");
        e=isolated(rate,bank,32,true);
        for(int layer=0;layer<5;layer++)trigger(e,layer,pitches[layer],10,.5,.5);
        e.setParameters(parameters(32,false,0,false));render(e,rate/10);
        check(e.getActiveRecordedMelodicVoiceCount()==3,"mute releases current lead/reply without clearing pad/texture/bass");
        if(preset.equals("chamber-flute")){
            e=isolated(rate,bank,8,true);trigger(e,1,57,10,.5,.3);trigger(e,1,88,10,.6,.7);
            check(e.getRecordedMelodicUnmappedCount()==2&&e.getMelodicFallbackCount()==2&&e.getRecordedMelodicAcceptedCount()==0,"flute missing pitches produce explicit oscillator fallback");
            for(int i=0;i<20;i++)trigger(e,0,57,10,.5,.5);
            check(e.getActiveVoiceCount()==8&&e.getActiveRecordedMelodicVoiceCount()==6,"sampler+fallback share one voice budget");
            check(e.getMelodicFallbackCount()==2&&e.getRecordedMelodicDroppedCount()==14,"full mixed pool cannot add fallback");
            String history=e.getScoreSnapshot();check(history.contains("[1.0,1.0,57.0,")&&history.contains("[1.0,1.0,88.0,"),"fallback retains original MIDI pitch");
            e.setParameters(parameters(8,false,0,false));render(e,rate/10);
            check(e.getActiveVoiceCount()<=6,"fallback lead mute releases legacy oscillator voices");
            e=isolated(rate,bank,32,true);
            for(int i=0;i<16;i++)trigger(e,1,57,10,.5,.5);
            for(int i=0;i<16;i++)trigger(e,0,57,10,.5,.5);
            check(e.getActiveVoiceCount()==32&&e.getActiveRecordedMelodicVoiceCount()==16,"full mixed sampler/fallback budget established");
            e.setParameters(parameters(8,true,0,false));render(e,rate/10);
            check(e.getActiveVoiceCount()==8&&e.getActiveRecordedMelodicVoiceCount()==8,"polyphony decrease accounts for both pools and converges within80ms");
            e.setParameters(parameters(32,true,0,false));render(e,1);
            check(e.getActiveVoiceCount()==8,"polyphony reincrease does not resurrect retired fallback/sampler tails");
        }
    }
    private static void historyAndSound(int rate,LiveMelodicPool.Bank bank,String preset,DevelopmentConfig config) {
        AmbientEngine e=new AmbientEngine(rate,7311,null,bank,config),old=new AmbientEngine(rate,7311,null,null,true,config);
        DevelopmentScore direct=new DevelopmentScore(rate,7311,config);DevelopingEngineTest.History history=new DevelopingEngineTest.History();
        e.start();old.start();float[] a=new float[256],b=new float[256];long different=0;double energy=0;
        for(int phase=0;phase<3;phase++){
            Parameters p=parameters(32,phase!=2,phase,true);e.setParameters(p);old.setParameters(p);
            for(int left=rate*4;left>0;){int n=Math.min(128,left);left-=n;e.render(a,0,n);old.render(b,0,n);renderedFrames+=n;
                for(int j=0;j<n*2;j++){check(Float.isFinite(a[j])&&Math.abs(a[j])<.85,"bounded real-bank rendered PCM");if(a[j]!=b[j])different++;energy+=a[j]*a[j];}
                check(e.getActiveVoiceCount()<=32,"fixed shared voice capacity");
            }
            direct.advanceTo(e.getFrame()-1,p,history);
            check(e.getScoreSnapshot().equals(history.json(7311,e.getFrame(),rate)),"history remains exact generated event stream including mute/full drops");
            check(e.getScoreSnapshot().equals(old.getScoreSnapshot()),"bank selection never changes MIDI history");
            check(e.getDevelopmentScore().config==config,"config identity retained");
        }
        check(different>rate&&energy>1,"real bank nonzero PCM and different from old oscillator PCM");
        if(!preset.equals("chamber-flute"))check(e.getRecordedMelodicUnmappedCount()==0&&e.getMelodicFallbackCount()==0,"full palettes cover every emitted development range");
        check(e.getRecordedMelodicAcceptedCount()>10,"native engine consumes actual melodic bank");
        System.out.println("PASS real engine "+preset+" "+rate+" config="+config.canonicalKey()+" changedSamples="+different+" mapped="+e.getRecordedMelodicAcceptedCount()+" unmapped="+e.getRecordedMelodicUnmappedCount()+" fallback="+e.getMelodicFallbackCount()+" dropped="+e.getRecordedMelodicDroppedCount());
    }
    private static void lifecycle(int rate,LiveMelodicPool.Bank bank) {
        AmbientEngine e=new AmbientEngine(rate,91,null,bank,true);Parameters p=parameters(32,true,0,true);e.setParameters(p);e.start();render(e,rate*3);
        DevelopmentScore score=e.getDevelopmentScore();
        for(int round=0;round<3;round++){
            long tick=score.tick,count=score.eventCount;double elapsed=score.elapsedFrames;
            e.stop();render(e,rate/10);
            check(score.tick==tick&&score.eventCount==count&&score.elapsedFrames==elapsed,"pause does not advance score");
            check(e.getActiveRecordedMelodicVoiceCount()==0,"stop sampler tails finish within50ms");
            e.start();render(e,1);check(score.tick-tick<=1,"restart has no catch-up burst");render(e,rate);
            long accepted=e.getRecordedMelodicAcceptedCount();e.reseed(101+round);e.reseed(111+round);render(e,rate/10);
            check(score.seed==111+round&&e.getRecordedMelodicAcceptedCount()>=accepted,"coalesced reseed preserves lifetime routing counters");
            DevelopmentScore direct=new DevelopmentScore(rate,111+round);DevelopingEngineTest.History expected=new DevelopingEngineTest.History();direct.advanceTo(e.getFrame()-1,p,expected);
            check(e.getScoreSnapshot().equals(expected.json(111+round,e.getFrame(),rate)),"reseed exact fresh history");
            e.stop();render(e,rate*3);check(e.isSilent()&&e.getActiveRecordedMelodicVoiceCount()==0,"stop reaches exact silence without sampler tails");
            check(e.getNoteOnCount()==e.getNoteOffCount(),"sample note retirement totals balance after stop");
            long frame=e.getFrame();float[] silence=new float[256];Arrays.fill(silence,1);e.render(silence,0,128);
            for(float v:silence)check(v==0,"exact silence");check(e.getFrame()==frame,"silent transport pauses");
            e.reseed(211+round);check(score.seed==211+round&&e.getActiveRecordedMelodicVoiceCount()==0,"silent reseed clears sampler immediately");
            e.reset();check(e.getRecordedMelodicAcceptedCount()==0&&e.getRecordedMelodicDroppedCount()==0&&e.getRecordedMelodicUnmappedCount()==0&&e.getMelodicFallbackCount()==0,"reset clears routing counters");
            check(e.getActiveVoiceCount()==0&&e.getScoreSnapshot().contains("\"events\":[]"),"reset clears voices/history");
            e.start();render(e,1);e.stop();render(e,1);check(e.isSilent()&&e.getActiveRecordedMelodicVoiceCount()==0,"one-frame stop clears frozen sample tail");
            e.start();render(e,rate*3);
        }
    }
    private static void chunking(int rate,LiveMelodicPool.Bank bank) {
        AmbientEngine a=new AmbientEngine(rate,91,null,bank,true),b=new AmbientEngine(rate,91,null,bank,true);
        Parameters p=parameters(24,true,0,true);a.setParameters(p);b.setParameters(p);a.start();b.start();
        float[] x=new float[rate*4],y=new float[rate*4];a.render(x,0,rate*2);
        for(int at=0;at<rate*2;){int n=Math.min(97,rate*2-at);b.render(y,at*2,n);at+=n;}
        check(Arrays.equals(x,y)&&a.getScoreSnapshot().equals(b.getScoreSnapshot()),"sampled PCM/history independent of render block partition");
    }
    @SuppressWarnings("deprecation")
    private static void allocation(int rate,LiveMelodicPool.Bank bank) {
        java.lang.management.ThreadMXBean generic=ManagementFactory.getThreadMXBean();
        if(!(generic instanceof com.sun.management.ThreadMXBean bean)||!bean.isThreadAllocatedMemorySupported())throw new AssertionError("allocation counter unavailable; cannot claim pass");
        bean.setThreadAllocatedMemoryEnabled(true);
        AmbientEngine e=new AmbientEngine(rate,91,null,bank,true);Parameters a=parameters(32,true,0,true),b=parameters(8,false,1,true);float[] out=new float[256];e.setParameters(a);e.start();
        for(int i=0;i<2500;i++)e.render(out,0,128);
        long id=Thread.currentThread().getId();bean.getThreadAllocatedBytes(id);long before=bean.getThreadAllocatedBytes(id),start=System.nanoTime();
        for(int i=0;i<2000;i++){
            if(i%101==0)e.setParameters(i%202==0?a:b);
            if(i%257==0)e.reseed(i);
            if(i%331==0)e.stop();else if(i%331==2)e.start();
            if(i%997==0){e.reset();e.start();}e.render(out,0,128);
        }
        long bytes=bean.getThreadAllocatedBytes(id)-before;double seconds=(System.nanoTime()-start)/1e9;
        check(bytes==0,"actual JVM hot-path allocated bytes="+bytes);
        System.out.println("PASS actual JVM melodic engine "+rate+" allocation="+bytes+" bytes over256000 frames including controls/reseed/stop/reset; seconds="+seconds);
    }
    @SuppressWarnings("deprecation")
    private static void sustainedAllocation(int rate,LiveMelodicPool.Bank bank)throws Exception {
        AmbientEngine e=isolated(rate,bank,32,true);
        for(int i=0;i<32;i++)trigger(e,i%2==0?0:3,i%2==0?57:74,120,.5,.5);
        check(e.getActiveRecordedMelodicVoiceCount()==32,"32 sustained sampled voices admitted");
        float[] buffer=new float[256];for(int i=0;i<1000;i++)e.render(buffer,0,128);
        java.lang.management.ThreadMXBean generic=ManagementFactory.getThreadMXBean();
        if(!(generic instanceof com.sun.management.ThreadMXBean bean)||!bean.isThreadAllocatedMemorySupported())throw new AssertionError("sustained allocation counter unavailable");
        bean.setThreadAllocatedMemoryEnabled(true);long id=Thread.currentThread().getId();bean.getThreadAllocatedBytes(id);
        long before=bean.getThreadAllocatedBytes(id),start=System.nanoTime();
        for(int i=0;i<4000;i++)e.render(buffer,0,128);
        long bytes=bean.getThreadAllocatedBytes(id)-before;double seconds=(System.nanoTime()-start)/1e9;
        check(bytes==0&&e.getActiveRecordedMelodicVoiceCount()==32,"full32voice engine zero hot allocations");
        System.out.println("PASS sustained32voice JVM engine "+rate+" allocation="+bytes+" bytes over512000 frames; seconds="+seconds+" realtimeRatio="+(512000.0/rate/seconds));
    }
    private static void nullIdentity() {
        for(boolean developing:new boolean[]{false,true}){
            AmbientEngine a=new AmbientEngine(8000,31,null,developing),b=new AmbientEngine(8000,31,null,null,developing),c=new AmbientEngine(8000,31,null,null,developing,DevelopmentConfig.DEFAULT);
            Parameters p=parameters(24,true,0,true);a.setParameters(p);b.setParameters(p);c.setParameters(p);a.start();b.start();c.start();float[] x=new float[256],y=new float[256],z=new float[256];
            for(int i=0;i<100;i++){a.render(x,0,128);b.render(y,0,128);c.render(z,0,128);check(Arrays.equals(x,y)&&Arrays.equals(x,z),"null melodic bank keeps old PCM identity");}
            check(a.getScoreSnapshot().equals(b.getScoreSnapshot())&&a.getScoreSnapshot().equals(c.getScoreSnapshot()),"null melodic history identity");
        }
    }
    public static void main(String[] args)throws Exception {
        Path assets=Path.of(args[0]);nullIdentity();
        DevelopmentConfig selected=new DevelopmentConfig(11,6,5,7,7,7,"modulating",1);
        for(int rate:new int[]{44100,48000})for(String preset:new String[]{"chamber","piano-room","chamber-flute"}){
            NativeMelodicBankLoader.Prepared prepared=NativeMelodicBankLoader.prepare(preset,rate,p->Files.newInputStream(assets.resolve(p)));
            LiveMelodicPool.Bank bank=prepared.bank;coverage(bank,preset);routes(rate,bank,preset);historyAndSound(rate,bank,preset,DevelopmentConfig.DEFAULT);historyAndSound(rate,bank,preset,selected);chunking(rate,bank);
            if(preset.equals("chamber")){lifecycle(rate,bank);allocation(rate,bank);sustainedAllocation(rate,bank);}
            try{new AmbientEngine(rate==44100?48000:44100,1,null,bank,true);throw new AssertionError("mismatched bank rate admitted");}catch(IllegalArgumentException expected){checks++;}
        }
        System.out.println("PASS recorded melodic engine: "+checks+" checks, "+renderedFrames+" renderedframes; real 44.1/48kHz banks, exact events/routing, polyphony/mute, lifecycle, fallback and JVM allocation. No Android-device validation.");
    }
}
