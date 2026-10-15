// SPDX-License-Identifier: AGPL-3.0-only
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;

public final class EventScoreTest {
 static void require(boolean b,String m){if(!b)throw new AssertionError(m);}
 static final class Sink implements AmbientEngine.NoteSink {
  long count,hash=1; int layers; ArrayList<long[]> edges=new ArrayList<>();
  public void noteOn(long at,int k,int p,long d,double v,double pan){
   require(p>=50&&p<=89,"pitch range");require(d>0&&d<=256000,"duration range");require(v>0&&v<=1&&pan>=.15&&pan<=.85,"velocity/pan");
   count++;layers|=1<<k;hash=hash*31+at;hash=hash*31+k;hash=hash*31+p;hash=hash*31+d;
   edges.add(new long[]{at,1});edges.add(new long[]{at+d+Math.round(8000*(k==0?4:k==3?6:.8)),-1});
  }
  void verify(){edges.sort(Comparator.<long[]>comparingLong(x->x[0]).thenComparingLong(x->x[1]));long n=0,max=0;for(long[] e:edges){n+=e[1];max=Math.max(max,n);}require(n==0&&max<=32,"bounded polyphony");require(layers==31,"all instruments");}
 }
 public static void main(String[] args){
  if(args.length>0){AmbientEngine.EventScore s=new AmbientEngine.EventScore(8000,91);s.advanceTo(600*8000-1,1,(at,k,p,d,v,pan)->System.out.println(at+","+k+","+p+","+d+","+v+","+pan));return;}
  AmbientEngine.EventScore slow=new AmbientEngine.EventScore(8000,91),fast=new AmbientEngine.EventScore(8000,91),chunked=new AmbientEngine.EventScore(8000,91);
  Sink a=new Sink(),b=new Sink(),c=new Sink();slow.advanceTo(10800L*8000-1,0,a);fast.advanceTo(600*8000-1,1,b);
  for(long t=0;t<10800L*8000;t+=71*8000)chunked.advanceTo(t,0,c);chunked.advanceTo(10800L*8000-1,0,c);
  require(slow.chordChanges==2,"three-hour slow harmony");require(fast.chordChanges>=20,"developing harmony");require(a.hash==c.hash&&a.count==c.count,"chunk independence");a.verify();b.verify();c.verify();
  AmbientEngine e=new AmbientEngine(8000,91);e.setParameters(new Parameters(.5,.45,.35,.5,0,1,.5,1,1,1,1,1,1,1,3,1,1,1,0,72,16,true,false,.65,.4,.3,.35,.2,1,0,0,0,1,.5,0));float[] x=new float[16000];e.start();double energy=0;
  for(int t=0;t<180;t++){e.render(x,0,8000);for(float v:x){require(Float.isFinite(v)&&Math.abs(v)<.85,"finite bounded mix");energy+=v*v;}}
  require(energy>10,"audible mix");require(e.getNoteOnCount()>150&&e.getNoteOffCount()>140,"note on/off");require(e.getDroppedNotes()==0,"no voice exhaustion");
  e.stop();for(int t=0;t<3;t++)e.render(x,0,8000);require(e.isSilent(),"stop");for(float v:x)require(v==0,"exact silence");long frame=e.getFrame();e.render(x,0,8000);require(e.getFrame()==frame,"clock pauses");e.start();e.render(x,0,8000);require(!e.isSilent(),"restart");e.reset();require(e.isSilent()&&e.getFrame()==0&&e.getNoteOnCount()==0,"reset");e.render(x,0,8000);for(float v:x)require(v==0,"reset silence");e.start();e.render(x,0,8000);require(!e.isSilent(),"reset restart");
  System.out.println("PASS JVM event score: three-hour slow, developing, bounded polyphony, full mix, note-offs, transport reset");
 }
}
