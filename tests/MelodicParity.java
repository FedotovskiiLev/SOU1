// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;
import java.io.*;
import java.nio.file.*;
import java.lang.management.ManagementFactory;
public final class MelodicParity {
 private MelodicParity(){}
 @SuppressWarnings("deprecation")
 public static void main(String[] args)throws Exception{
  Path assets=Path.of(args[0]);String preset=args[1];int rate=Integer.parseInt(args[2]);Path output=Path.of(args[3]);
  NativeMelodicBankLoader.Prepared prepared=NativeMelodicBankLoader.prepare(preset,rate,p->Files.newInputStream(assets.resolve(p)));
  LiveMelodicPool pool=new LiveMelodicPool(prepared.bank,32);double[] gains={.65,.55,.35,.2,.15};int total=rate*12;
  long start=System.nanoTime();try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(output)))){
   for(int i=0;i<total;i++){
    if(i==0){pool.trigger(0,57,7,.6,.3);pool.trigger(0,62,7,.5,.6);pool.trigger(3,74,10,.35,.7);}
    if(i% (rate/2)==0&&i<rate*9){int n=i/(rate/2);pool.trigger(1,60+n%10,1.3,.3+(n%3)*.25,.2+(n%4)*.2);pool.trigger(2,72+n%8,.8,.55,.7);pool.trigger(4,36+n%12,.4,.6,.5);}
    if(i==rate*5)pool.setMelodyEnabled(false);if(i==rate*6)pool.setMelodyEnabled(true);if(i==rate*11)pool.stop();
    pool.next(gains,true);out.writeDouble(pool.outputL);out.writeDouble(pool.outputR);
   }
  }
  if(pool.getActiveVoices()!=0)throw new AssertionError("tails not cleared");
  // JVM allocation evidence is a separate warm hot-loop probe, not an Android claim.
  pool.reset();for(int j=0;j<32;j++)pool.trigger(0,57,120,.5,.5);for(int i=0;i<100000;i++)pool.next(gains,true);
  java.lang.management.ThreadMXBean base=ManagementFactory.getThreadMXBean();long allocated=-1;double hotSeconds=-1;
  if(base instanceof com.sun.management.ThreadMXBean){com.sun.management.ThreadMXBean bean=(com.sun.management.ThreadMXBean)base;long id=Thread.currentThread().getId();long before=bean.getThreadAllocatedBytes(id);long hotStart=System.nanoTime();for(int i=0;i<1000000;i++)pool.next(gains,true);allocated=bean.getThreadAllocatedBytes(id)-before;hotSeconds=(System.nanoTime()-hotStart)/1e9;}
  System.out.println("{\"preset\":\""+preset+"\",\"rate\":"+rate+",\"decodedBytes\":"+prepared.decodedBytes+",\"kernelBytes\":"+prepared.bank.kernelBytes+",\"hotLoopAllocatedBytes\":"+allocated+",\"hotLoopSeconds\":"+hotSeconds+",\"elapsedSeconds\":"+(System.nanoTime()-start)/1e9+"}");
 }
}
