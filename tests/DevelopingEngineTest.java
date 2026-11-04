// SPDX-License-Identifier: AGPL-3.0-only
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
import org.sou1.audio.DevelopmentScore;
import org.sou1.audio.LiveDrumPool;

/** Focused JVM wiring tests. Synthetic bank; no Android-device or listening claim. */
public final class DevelopingEngineTest {
    private static int checks;
    private static void check(boolean ok, String message) { checks++; if (!ok) throw new AssertionError(message); }
    static LiveDrumPool.Bank bank(int rate) {
        float[][] samples = new float[6][rate/2];
        for(int j=0;j<samples.length;j++)for(int i=0;i<samples[j].length;i++) samples[j][i]=(float)((((i*13+j*11)%97)-48)/61.0);
        String[] ids={"kick","snare","closed-hat","toms","short-clash"};
        LiveDrumPool.Instrument[] instruments=new LiveDrumPool.Instrument[5];
        for(int i=0;i<5;i++){
            LiveDrumPool.Zone[] zones=i==3?new LiveDrumPool.Zone[]{zone(3,45,45),zone(4,47,47),zone(5,49,49)}:
                i==1?new LiveDrumPool.Zone[]{zone(1,0,127),zone(2,0,127)}:new LiveDrumPool.Zone[]{zone(i,0,127)};
            instruments[i]=new LiveDrumPool.Instrument(ids[i],.6+i/20.0,true,i==2||i==4?"metal":null,zones);
        }
        return new LiveDrumPool.Bank(rate,samples,instruments);
    }
    static LiveDrumPool.Zone zone(int sample,int low,int high){return new LiveDrumPool.Zone(sample,low,high,0,1);}
    static Parameters knobs(int phase, boolean drums) {
        return new Parameters(.82,.68,.61,.43,.3,.2,.7,.25,.65,.55,.35,.20,.15,.8,2,.12,.05,.07,
                0,phase==0?112:phase==1?180:72,phase==2?8:24,phase!=2,drums,.8,.7,.6,.5,.4,
                .15,.6,1,.35,.85,.85,.37);
    }
    static double render(AmbientEngine engine,int frames){
        float[] out=new float[256];double energy=0;
        while(frames>0){int n=Math.min(128,frames);engine.render(out,0,n);frames-=n;
            for(int i=0;i<n*2;i++){float v=out[i];if(!Float.isFinite(v)||Math.abs(v)>=.85)throw new AssertionError("finite bounded PCM");energy+=v*v;}
            check(engine.getActiveVoiceCount()<=32&&engine.getActiveDrumVoiceCount()<=16,"fixed runtime voice pools");
        }
        return energy;
    }
    static final class History implements AmbientEngine.NoteSink {
        final double[][] values=new double[512][5];int first,count;long total;int layers;
        public void noteOn(long frame,int layer,int pitch,long gate,double velocity,double pan){
            int i=(first+count)%512;if(count==512)first=(first+1)%512;else count++;
            double[] row=values[i];row[0]=frame;row[1]=layer;row[2]=pitch;row[3]=gate;row[4]=velocity;total++;layers|=1<<layer;
        }
        String json(long seed,long frame,int rate){
            StringBuilder s=new StringBuilder("{\"seed\":").append(seed&0xffffffffL).append(",\"frame\":").append(frame).append(",\"rate\":").append(rate).append(",\"events\":[");
            for(int i=0;i<count;i++){if(i>0)s.append(',');s.append('[');double[] row=values[(first+i)%512];for(int k=0;k<5;k++){if(k>0)s.append(',');s.append(row[k]);}s.append(']');}
            return s.append("]}").toString();
        }
    }
    static void noteHistory() {
        for(int rate:new int[]{8000,44100,48000})for(boolean recorded:new boolean[]{false,true}){
            AmbientEngine e=new AmbientEngine(rate,7311,recorded?bank(rate):null,true);
            DevelopmentScore direct=new DevelopmentScore(rate,7311),identity=e.getDevelopmentScore();History expected=new History();
            check(identity!=null,"development mode selected");e.start();double energy=0;
            for(int phase=0;phase<4;phase++){
                Parameters p=knobs(phase%3,phase!=2);e.setParameters(p);
                energy+=render(e,rate*(rate==8000?20:4));direct.advanceTo(e.getFrame()-1,p,expected);
                check(e.getScoreSnapshot().equals(expected.json(7311,e.getFrame(),rate)),"native MIDI history equals direct score including bounded ring");
                check(identity.tick==direct.tick&&identity.beatNext==direct.beatNext&&identity.eventCount==direct.eventCount,"actual renderer uses development score clock");
                check(e.getScore().eventCount==0&&e.getScore().step==0,"legacy score never advances in development mode");
                if(phase==2)check(e.getActiveVoiceCount()<=8,"polyphony decrease converges within release");
            }
            check(energy>1&&expected.total>20&&(expected.layers&31)!=0&&(expected.layers&992)!=0,"audible melody and drum paths");
            if(rate==8000)check(expected.total>512&&expected.count==512,"MIDI history wraps at 512 generated events");
            check(e.getDevelopmentScore()==identity,"development score identity retained");
        }
    }
    static void lifecycle() {
        for(boolean recorded:new boolean[]{false,true}){
            int rate=8000;Parameters p=knobs(0,true);AmbientEngine e=new AmbientEngine(rate,91,recorded?bank(rate):null,true);
            DevelopmentScore identity=e.getDevelopmentScore();e.setParameters(p);e.start();render(e,rate*3);
            for(int round=0;round<3;round++){
                long tick=identity.tick,events=identity.eventCount,frame=e.getFrame();double elapsed=identity.elapsedFrames;
                e.stop();render(e,rate/10);
                check(identity.tick==tick&&identity.eventCount==events&&identity.elapsedFrames==elapsed&&e.getFrame()>frame,"stop fade pauses score, not transport tail");
                e.start();render(e,1);
                check(identity.tick-tick<=1&&identity.eventCount-events<=12,"restart has no catch-up burst in its first sample");
                render(e,rate/2-1);check(identity.tick>tick&&e.getParameters()==p,"restart during fade retains controls and resumes score");
                e.reseed(100+round*2);e.reseed(101+round*2);render(e,(int)Math.ceil(rate*.08)+1);
                check(identity.seed==101+round*2&&e.getScore().seed==identity.seed,"coalesced reseed reaches both score diagnostics");
                check(e.getDevelopmentScore()==identity&&e.isPlayingRequested()&&e.getParameters()==p,"reseed retains development mode/controls/transport");
                check(e.getScoreSnapshot().contains("\"seed\":"+identity.seed+","),"MIDI export reseed identity");
                DevelopmentScore fresh=new DevelopmentScore(rate,identity.seed);History freshHistory=new History();
                fresh.advanceTo(e.getFrame()-1,p,freshHistory);
                check(e.getScoreSnapshot().equals(freshHistory.json(identity.seed,e.getFrame(),rate)),"live reseed history/clock exactly match fresh score");
                render(e,rate);e.stop();render(e,rate*3);
                // Existing transport is pause/resume for procedural voices. Recorded one-shot tails are cleared.
                check(e.isSilent()&&e.getActiveDrumVoiceCount()==0,"stop reaches silence and retires finite drum tails");
                check(e.getNoteOffCount()<=e.getNoteOnCount()&&e.getNoteOnCount()-e.getNoteOffCount()<=e.getActiveVoiceCount(),"unretired notes are only paused melodic voices");
                long stopped=e.getFrame();float[] silence=new float[512];Arrays.fill(silence,1);e.render(silence,0,256);
                for(float v:silence)check(v==0,"exact stopped silence");check(e.getFrame()==stopped,"silent transport clock pauses");
                e.reseed(200+round);check(identity.seed==200+round&&e.isSilent(),"silent reseed applies immediately");
                check(e.getActiveVoiceCount()==0&&e.getActiveDrumVoiceCount()==0,"silent reseed clears all paused voices");
                e.reset();check(e.getDevelopmentScore()==identity&&identity.tick==0&&e.getFrame()==0&&e.getParameters()==p,"reset retains mode/controls and resets development clock");
                check(e.getScoreSnapshot().contains("\"events\":[]")&&e.getNoteOnCount()==0&&e.getDroppedNotes()==0,"reset clears history/diagnostics");
                check(e.getActiveVoiceCount()==0&&e.getActiveDrumVoiceCount()==0,"reset clears paused voices and recorded tails");
                e.start();render(e,1);e.stop();render(e,1);
                check(e.isSilent()&&(!recorded||e.getActiveDrumVoiceCount()==0),"one-frame play/stop reaches silence and clears recorded tails");
                e.start();render(e,rate*3);
            }
        }
    }
    static void chunking() {
        for(boolean recorded:new boolean[]{false,true}){
            int rate=8000;LiveDrumPool.Bank bank=recorded?bank(rate):null;
            AmbientEngine a=new AmbientEngine(rate,91,bank,true),b=new AmbientEngine(rate,91,bank,true);
            Parameters p=knobs(0,true);a.setParameters(p);b.setParameters(p);a.start();b.start();
            float[] x=new float[rate*4],y=new float[rate*4];a.render(x,0,rate*2);
            for(int at=0;at<rate*2;){int n=Math.min(97,rate*2-at);b.render(y,at*2,n);at+=n;}
            check(Arrays.equals(x,y)&&a.getScoreSnapshot().equals(b.getScoreSnapshot()),"actual development PCM/history is block-size independent");
        }
    }
    static void legacy(Path fixtures) throws Exception {
        int n=0;
        for(String line:Files.readAllLines(fixtures)){
            String[] fields=line.split(" ");check(line.equals(LegacyEnginePcmFixture.fixture(Integer.parseInt(fields[0]),Integer.parseInt(fields[1]))),"frozen old constructor PCM/history hash "+fields[0]+"/"+fields[1]);n++;
        }
        check(n==20,"all 20 frozen legacy fixtures checked");
        AmbientEngine a=new AmbientEngine(8000,71),b=new AmbientEngine(8000,71,null),c=new AmbientEngine(8000,71,null,false);
        check(a.getDevelopmentScore()==null&&b.getDevelopmentScore()==null&&c.getDevelopmentScore()==null,"old constructors stay opt-out");
        a.start();b.start();c.start();float[] x=new float[256],y=new float[256],z=new float[256];
        for(int i=0;i<100;i++){a.render(x,0,128);b.render(y,0,128);c.render(z,0,128);check(Arrays.equals(x,y)&&Arrays.equals(x,z),"legacy overload identity");}
    }
    @SuppressWarnings("deprecation")
    static void allocations(){
        java.lang.management.ThreadMXBean generic=ManagementFactory.getThreadMXBean();
        if(!(generic instanceof com.sun.management.ThreadMXBean bean)||!bean.isThreadAllocatedMemorySupported()){System.out.println("SKIP native development allocation counter: unsupported JVM");return;}
        bean.setThreadAllocatedMemoryEnabled(true);
        for(boolean recorded:new boolean[]{false,true}){
            AmbientEngine e=new AmbientEngine(8000,91,recorded?bank(8000):null,true);Parameters a=knobs(0,true),b=knobs(1,false);e.setParameters(a);e.start();float[] out=new float[256];
            for(int i=0;i<2500;i++)e.render(out,0,128);
            long id=Thread.currentThread().getId();bean.getThreadAllocatedBytes(id);long before=bean.getThreadAllocatedBytes(id);
            for(int i=0;i<1000;i++){
                if(i%101==0)e.setParameters(i%202==0?a:b);
                if(i%257==0)e.reseed(i);
                if(i%331==0)e.stop();else if(i%331==2)e.start();
                if(i%997==0){e.reset();e.start();}e.render(out,0,128);
            }
            long bytes=bean.getThreadAllocatedBytes(id)-before;check(bytes==0,"development render/control/reset/reseed allocation: "+bytes);
        }
        System.out.println("PASS native developing render allocation: 0 bytes across 256000 frames and live lifecycle operations");
    }
    static void vectors(Path dir)throws IOException{
        Files.createDirectories(dir);
        for(int rate:new int[]{44100,48000})for(boolean recorded:new boolean[]{false,true}){
            AmbientEngine e=new AmbientEngine(rate,7311,recorded?bank(rate):null,true);e.setParameters(knobs(0,recorded));e.start();
            int total=rate*8;ByteBuffer pcm=ByteBuffer.allocate(total*8).order(ByteOrder.LITTLE_ENDIAN);float[] out=new float[256];
            int[] boundaries={rate*2,rate*4,rate*6,total};int boundary=0;
            for(int at=0;at<total;){
                if(at==rate*2)e.setParameters(knobs(1,recorded));
                if(at==rate*4)e.setParameters(knobs(0,recorded));
                if(at==rate*6)e.stop();
                while(boundaries[boundary]<=at)boundary++;
                int frames=Math.min(128,boundaries[boundary]-at);e.render(out,0,frames);
                for(int i=0;i<frames*2;i++)pcm.putFloat(out[i]);at+=frames;
            }
            check(e.getDroppedNotes()==0,"fixed-budget development renderer admits all score events");
            String name=rate+"-"+(recorded?"recorded":"procedural");Files.write(dir.resolve(name+".f32"),pcm.array());Files.writeString(dir.resolve(name+".json"),e.getScoreSnapshot());
        }
    }
    public static void main(String[] args)throws Exception{
        if(args.length==2&&args[0].equals("vectors")){vectors(Paths.get(args[1]));return;}
        noteHistory();lifecycle();chunking();legacy(Paths.get(args[0]));allocations();
        System.out.println("PASS focused native developing-engine wiring: "+checks+" checks; MIDI history/direct-score parity, null/recorded bank, PCM, lifecycle, 20 unchanged legacy hashes");
    }
}
