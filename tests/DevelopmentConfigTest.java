// SPDX-License-Identifier: AGPL-3.0-only
import java.io.BufferedOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.lang.management.ManagementFactory;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
import org.sou1.audio.DevelopmentConfig;
import org.sou1.audio.DevelopmentScore;

/** Standalone config/schema and configured-core tests, not Android/device validation. */
public final class DevelopmentConfigTest {
    static int checks;
    static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
    static void invalid(Runnable code,String why){boolean rejected=false;try{code.run();}catch(IllegalArgumentException expected){rejected=true;}check(rejected,why);}
    static DevelopmentConfig config(int tonic,int mode,int meter,int rhythm,int arp,int drums,String harmony,double variation){return new DevelopmentConfig(tonic,mode,meter,rhythm,arp,drums,harmony,variation);}
    static void schema(){
        DevelopmentConfig d=DevelopmentConfig.DEFAULT;
        check(d.canonicalKey().equals("d1|-1|-1|-1|-1|-1|-1|auto|-1"),"canonical default key");
        check(DevelopmentConfig.parseKey(d.canonicalKey()).equals(d),"default key roundtrip");
        check(DevelopmentConfig.fromMap(new HashMap<>()).equals(d),"omitted keys use defaults");
        for(Field f:DevelopmentConfig.class.getFields())check(Modifier.isFinal(f.getModifiers()),"all exposed fields immutable");
        String[] keys={"tonic","mode","meter","rhythmFamily","arpStrategy","drumPattern"};int[] max={11,6,5,7,7,7};
        for(int i=0;i<keys.length;i++){
            final String k=keys[i];final int upper=max[i];
            check(DevelopmentConfig.parseSelector(k,"seed")==-1,"seed selector sentinel");
            for(int v=0;v<=upper;v++)check(DevelopmentConfig.parseSelector(k,Double.valueOf(v))==v,"strict selector valid value");
            for(Object bad:new Object[]{-1,upper+1,.5,Double.NaN,Double.POSITIVE_INFINITY,"0","auto",null,true}){
                invalid(()->DevelopmentConfig.parseSelector(k,bad),"reject invalid selector "+k);
                Map<String,Object> map=new HashMap<>();map.put(k,bad);invalid(()->DevelopmentConfig.fromMap(map),"map rejects invalid selector "+k);
            }
        }
        for(Object bad:new Object[]{-1,-.01,1.01,Double.NaN,Double.NEGATIVE_INFINITY,"seed","0",null,true})invalid(()->DevelopmentConfig.parseDrumVariation(bad),"strict drumVariation");
        for(Object bad:new Object[]{"seed","cycle",0,null,true})invalid(()->DevelopmentConfig.parseHarmony(bad),"strict harmony");
        invalid(()->DevelopmentConfig.parseSelector("unknown",1),"unknown selector key");
        invalid(()->DevelopmentConfig.fromMap(null),"null config map");
        Map<String,Object> bad=new HashMap<>();bad.put("extra",1);invalid(()->DevelopmentConfig.fromMap(bad),"closed map schema");
        bad.clear();bad.put(null,1);invalid(()->DevelopmentConfig.fromMap(bad),"null map key");
        Map<String,Object> mutable=new HashMap<>();mutable.put("tonic",9);mutable.put("mode",1);mutable.put("drumVariation",.35);
        DevelopmentConfig c=DevelopmentConfig.fromMap(mutable);mutable.put("tonic",0);check(c.tonic==9&&c.mode==1&&c.drumVariation==.35,"config does not retain mutable map");
        invalid(()->new DevelopmentScore(8000,1,null),"score rejects null config");
        invalid(()->config(-2,0,0,0,0,0,"auto",0),"native invalid sentinel");
        invalid(()->config(12,0,0,0,0,0,"auto",0),"native tonic bound");
        invalid(()->config(0,7,0,0,0,0,"auto",0),"native mode bound");
        invalid(()->config(0,0,6,0,0,0,"auto",0),"native meter bound");
        invalid(()->config(0,0,0,8,0,0,"auto",0),"native rhythm bound");
        invalid(()->config(0,0,0,0,8,0,"auto",0),"native arp bound");
        invalid(()->config(0,0,0,0,0,8,"auto",0),"native drum bound");
        invalid(()->config(0,0,0,0,0,0,"auto",-.5),"native variation bound");
        String[] harmonies={"auto","fixed","progression","modulating"};
        double[] variations={-1,0,-0.0,Double.MIN_VALUE,Double.MIN_NORMAL,1e-8,.25,.35,.55,.6,.9999999999999999,1};
        for(String h:harmonies)for(double v:variations)for(int n=0;n<12;n++){
            c=config(n,n%7,n%6,n%8,7-n%8,n%8,h,v);DevelopmentConfig back=DevelopmentConfig.parseKey(c.canonicalKey());
            check(c.equals(back)&&c.hashCode()==back.hashCode()&&c.canonicalKey().length()<=256,"canonical native transport exact roundtrip");
            check(c.tonic==back.tonic&&c.mode==back.mode&&c.meter==back.meter&&c.rhythmFamily==back.rhythmFamily&&c.arpStrategy==back.arpStrategy&&c.drumPattern==back.drumPattern&&c.harmony.equals(back.harmony)&&Double.doubleToLongBits(c.drumVariation)==Double.doubleToLongBits(back.drumVariation),"key fields exact");
        }
        for(String key:new String[]{null,"","d2|-1|-1|-1|-1|-1|-1|auto|-1","d1|0|0|0|0|0|0|auto","d1|0|0|0|0|0|0|auto|0.0|extra","d1|0|0|0|0|0|0|auto|NaN","d1|0|0|0|0|0|0|auto|Infinity","d1|0|0|0|0|0|0|auto|1e0","d1|+0|0|0|0|0|0|auto|0.0","d1|00|0|0|0|0|0|auto|0.0","d1|0|0|0|0|0|0|auto|-0.0","d1|0|0|0|0|0|0|fixed|1.01","d1|0|0|0|0|0|0|unknown|0.0","d1|0|0|0|0|0|0|auto| 0.0","d1|0|0|0|0|0|0|auto|0.0\n"})invalid(()->DevelopmentConfig.parseKey(key),"strict canonical decoder");
        final String tooLong=new String(new char[257]).replace('\0','0');invalid(()->DevelopmentConfig.parseKey(tooLong),"bounded key length");
    }
    static void behavior(){
        Parameters p=DevelopmentScoreTest.params(.15,.6,1,.35,137,1,1,.37,1,32,true,true);
        DevelopmentConfig c=config(9,1,3,5,6,2,"progression",1);DevelopmentScore s=new DevelopmentScore(8000,91,c);
        for(long seed:new long[]{0,1,91,0xffffffffL}){
            s.reseed(seed);DevelopmentScoreTest.Sink sink=new DevelopmentScoreTest.Sink(8000);
            s.advanceTo(8000L*600-1,p,sink);
            check(s.config==c&&s.root==57&&s.anchorRoot==57&&s.mode==1&&s.meterTicks==42&&s.family==5&&s.arpStrategy==6&&s.drumFamily==2,"manual selectors survive reseed and phrases");
            check(s.chordChanges>10&&s.modulationChanges==0,"progression keeps tonic while chords develop");
            long hash=sink.hash,count=sink.count;s.reset();sink=new DevelopmentScoreTest.Sink(8000);s.advanceTo(8000L*600-1,p,sink);
            check(hash==sink.hash&&count==sink.count&&s.config==c,"configured reset exact replay");
        }
        s=new DevelopmentScore(8000,91,config(0,4,0,-1,-1,-1,"fixed",-1));
        s.advanceTo(8000L*10800-1,p,new DevelopmentScoreTest.Sink(8000));check(s.chord==0&&s.chordChanges==0&&s.root==48&&s.modulationChanges==0,"fixed holds harmony three hours");
        for(double evolution:new double[]{0,.4,1}){
            p=DevelopmentScoreTest.params(0,1,0,0,137,.8,.9,0,evolution,32,true,false);
            s=new DevelopmentScore(8000,91,config(11,2,0,-1,-1,-1,"modulating",-1));
            int root=s.root,changes=0;long last=0;int span=4+(int)Math.floor((1-evolution)*12);
            while(changes<6){int t=s.barTick,b=s.phraseBar;long phrase=s.phrase;s.advanceTo(s.next,p,(at,k,n,d,v,pan)->{});
                if(s.root!=root){check(t==0&&b==0&&phrase-last==span,"modulation only at bounded phrase boundary");last=phrase;changes++;
                    int distance=(s.root-s.anchorRoot+12)%12;check(changes%2==0?s.root==s.anchorRoot:distance==5||distance==7,"related tonic then anchor return");root=s.root;
                }
            }check(s.modulationChanges==6&&s.mode==2&&s.anchorRoot==59,"modulation preserves config anchor/mode");
        }
    }
    @SuppressWarnings("deprecation")
    static void allocations(){
        java.lang.management.ThreadMXBean generic=ManagementFactory.getThreadMXBean();
        if(!(generic instanceof com.sun.management.ThreadMXBean bean)||!bean.isThreadAllocatedMemorySupported()){System.out.println("SKIP configured-score allocation counter: unsupported JVM");return;}
        bean.setThreadAllocatedMemoryEnabled(true);
        DevelopmentScore s=new DevelopmentScore(192000,-1,config(11,6,5,7,7,7,"modulating",.73));
        Parameters p=DevelopmentScoreTest.params(1,1,1,1,180,1,1,1,1,32,true,true);AmbientEngine.NoteSink sink=(at,k,n,d,v,pan)->{};
        for(int i=0;i<40;i++){s.reseed(i);s.advanceTo(192000L*600,p,sink);}
        long id=Thread.currentThread().getId();bean.getThreadAllocatedBytes(id);long before=bean.getThreadAllocatedBytes(id);
        for(int i=0;i<20;i++){s.reseed(i);s.advanceTo(192000L*600,p,sink);}for(int i=0;i<100000;i++)s.advanceTo(s.next,p,sink);
        long allocated=bean.getThreadAllocatedBytes(id)-before;check(allocated==0,"configured score hot path allocated "+allocated+" bytes");
        System.out.println("PASS configured score: 0 allocated bytes after warmup, including reset/reseed and modulation/drum overrides");
    }
    static void heldPatterns(){
        int[] meters={48,36,60,42,54,72};
        for(boolean drums:new boolean[]{false,true})for(int meter=0;meter<6;meter++)for(int pattern=0;pattern<8;pattern++){
            String reference=null;
            for(long seed:new long[]{1,91,0x4405a035L}){
                Parameters p=DevelopmentScoreTest.params(0,0,drums?0:1,0,120,1,1,0,1,32,!drums,drums);
                DevelopmentConfig c=config(-1,-1,meter,drums?-1:pattern,-1,drums?pattern:-1,"auto",-1);
                DevelopmentScore s=new DevelopmentScore(8000,seed,c);long frames=4000L*meters[meter]/12;
                StringBuilder[] bars=new StringBuilder[32];for(int i=0;i<bars.length;i++)bars[i]=new StringBuilder();
                s.advanceTo(frames*bars.length-1,p,(at,k,n,d,v,pan)->{
                    if(drums?k<5:k!=1)return;int bar=(int)(at/frames);
                    bars[bar].append(at%frames).append(':').append(k).append(':').append(d);
                    if(drums)bars[bar].append(':').append(n).append(':').append(v).append(':').append(pan);
                    bars[bar].append(';');
                });
                check(s.suppressedEvents==0,"held pattern regression must not hide voice omissions");
                String first=bars[0].toString();check(!first.isEmpty(),"selected pattern emits notes");
                for(StringBuilder bar:bars)check(bar.toString().equals(first),"named pattern holds through phrases");
                if(reference==null)reference=first;else check(reference.equals(first),"named pattern survives reseed in fixed meter");
            }
        }
    }
    static void vectors(Path cases,Path out)throws IOException{
        Files.createDirectories(out);long events=0;int count=0;
        try(PrintWriter manifest=new PrintWriter(Files.newBufferedWriter(out.resolve("configured.jsonl")))){
            for(String row:Files.readAllLines(cases)){
                String[] a=row.split("\\t");String name=a[0];int rate=Integer.parseInt(a[1]);long seed=Long.parseLong(a[2]),duration=Long.parseLong(a[3]);int chunk=Integer.parseInt(a[4]);
                DevelopmentConfig c=config(Integer.parseInt(a[5]),Integer.parseInt(a[6]),Integer.parseInt(a[7]),Integer.parseInt(a[8]),Integer.parseInt(a[9]),Integer.parseInt(a[10]),a[11],Double.parseDouble(a[12]));
                Parameters p=DevelopmentScoreTest.params(Double.parseDouble(a[13]),Double.parseDouble(a[14]),Double.parseDouble(a[15]),Double.parseDouble(a[16]),Double.parseDouble(a[17]),Double.parseDouble(a[18]),Double.parseDouble(a[19]),Double.parseDouble(a[20]),Double.parseDouble(a[21]),Integer.parseInt(a[22]),Boolean.parseBoolean(a[23]),Boolean.parseBoolean(a[24]));
                DevelopmentScore s=new DevelopmentScore(rate,seed,c);DevelopmentScoreTest.Sink validation=new DevelopmentScoreTest.Sink(rate);
                try(DataOutputStream binary=new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(out.resolve(name+".bin"))))){
                    AmbientEngine.NoteSink sink=(at,k,n,d,v,pan)->{validation.noteOn(at,k,n,d,v,pan);try{binary.writeLong(at);binary.writeInt(k);binary.writeInt(n);binary.writeLong(d);binary.writeDouble(v);binary.writeDouble(pan);}catch(IOException e){throw new IllegalStateException(e);}};
                    if(chunk>0)for(long at=0;at<duration-1;at+=chunk)s.advanceTo(at,p,sink);s.advanceTo(duration-1,p,sink);
                }
                check(DevelopmentConfig.parseKey(c.canonicalKey()).equals(c),"vector transport roundtrip");
                manifest.println("{\"name\":\""+name+"\",\"rate\":"+rate+",\"seed\":"+seed+",\"duration\":"+duration+",\"chunk\":"+chunk+",\"config\":"+c.toJson()+",\"p\":"+DevelopmentScoreTest.parameterJson(p)+",\"result\":{\"eventCount\":"+s.eventCount+",\"tick\":"+s.tick+",\"step\":"+s.step+",\"next\":"+s.next+",\"beatNext\":"+s.beatNext+",\"elapsedFrames\":"+s.elapsedFrames+",\"chord\":"+s.chord+",\"chordChanges\":"+s.chordChanges+",\"suppressedEvents\":"+s.suppressedEvents+",\"root\":"+s.root+",\"anchorRoot\":"+s.anchorRoot+",\"mode\":"+s.mode+",\"meterTicks\":"+s.meterTicks+",\"family\":"+s.family+",\"drumFamily\":"+s.drumFamily+",\"arpStrategy\":"+s.arpStrategy+",\"modulationPhrase\":"+s.modulationPhrase+",\"modulationChanges\":"+s.modulationChanges+"}}");
                events+=s.eventCount;count++;
            }
        }
        System.out.println("PASS native configured vectors: "+count+" cases / "+events+" events");
    }
    public static void main(String[] args)throws Exception{
        if(args.length==3&&args[0].equals("vectors")){vectors(Paths.get(args[1]),Paths.get(args[2]));return;}
        schema();behavior();heldPatterns();allocations();System.out.println("PASS native development config: "+checks+" schema/key/immutability/behavior checks");
    }
}
