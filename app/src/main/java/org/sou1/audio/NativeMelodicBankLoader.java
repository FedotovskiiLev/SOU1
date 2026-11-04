// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Synchronous background-only exact bundled-bank loader. Android adapter:
 * AssetManager::open. No network, runtime JSON, native plug-ins or guessed paths.
 * Callers own request lifetime and publish only after cancellation/request-id
 * checks. No decoder/preparation may execute in AudioTrack/AudioWorklet.
 */
public final class NativeMelodicBankLoader {
    private NativeMelodicBankLoader(){}
    @FunctionalInterface public interface AssetReader {InputStream open(String path)throws IOException;}
    public static final List<String> PRESETS=Collections.unmodifiableList(Arrays.asList("chamber","chamber-flute","piano-room"));
    public static final class Prepared {
        public final LiveMelodicPool.Bank bank;
        public final String preset,manifestSha256;
        public final int encodedBytes,decodedBytes;
        private Prepared(LiveMelodicPool.Bank bank,Spec s,int encoded,int decoded){this.bank=bank;preset=s.id;manifestSha256=s.hash;encodedBytes=encoded;decodedBytes=decoded;}
    }
    static final class SampleSpec {
        final String file,hash;final int bytes,frames,rate,root,start,end,fade;
        SampleSpec(String file,String hash,int bytes,int frames,int rate,int root,int start,int end,int fade){this.file=file;this.hash=hash;this.bytes=bytes;this.frames=frames;this.rate=rate;this.root=root;this.start=start;this.end=end;this.fade=fade;}
    }
    static final class Spec {
        final String id,hash;final int bytes;final SampleSpec[] samples;final LiveMelodicPool.Instrument[] instruments;
        Spec(String id,int bytes,String hash,SampleSpec[] samples,LiveMelodicPool.Instrument[] instruments){this.id=id;this.bytes=bytes;this.hash=hash;this.samples=samples;this.instruments=instruments;}
    }
    private static void check()throws InterruptedIOException{if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Melodic preparation cancelled");}
    private static byte[] verified(AssetReader reader,String path,int expected,String hash)throws IOException{
        check();if(expected<44||expected>512*1024)throw new IOException("Melodic asset budget");byte[] out=new byte[expected];
        try(InputStream in=reader.open(path)){int n=0;while(n<expected){check();int got=in.read(out,n,Math.min(8192,expected-n));if(got<0)throw new IOException("Truncated melodic asset");if(got==0){int b=in.read();if(b<0)throw new IOException("Truncated melodic asset");out[n++]=(byte)b;}else n+=got;}if(in.read()!=-1)throw new IOException("Oversized melodic asset");}
        check();try{byte[] digest=MessageDigest.getInstance("SHA-256").digest(out);StringBuilder hex=new StringBuilder(64);for(byte b:digest)hex.append(Character.forDigit((b>>>4)&15,16)).append(Character.forDigit(b&15,16));if(!hex.toString().equals(hash))throw new IOException("Melodic integrity mismatch");}catch(NoSuchAlgorithmException e){throw new IOException(e);}return out;
    }
    private static int u16(byte[] b,int p){return (b[p]&255)|((b[p+1]&255)<<8);}
    private static long u32(byte[] b,int p){return Integer.toUnsignedLong(u16(b,p)|(u16(b,p+2)<<16));}
    private static boolean tag(byte[] b,int p,String s){for(int i=0;i<s.length();i++)if(b[p+i]!=(byte)s.charAt(i))return false;return true;}
    public static Prepared prepare(String preset,int rate,AssetReader reader)throws IOException{
        if(reader==null||rate<8000||rate>192000)throw new IllegalArgumentException("Melodic reader/rate");Spec spec=NativeMelodicCatalog.get(preset);long encoded=0,decoded=0;
        for(SampleSpec s:spec.samples){encoded+=s.bytes;decoded+=(long)s.frames*4;}
        if(encoded>16*1024*1024||decoded>32*1024*1024)throw new IOException("Melodic preparation memory budget");
        verified(reader,"melodic-assets/"+preset+".json",spec.bytes,spec.hash);
        LiveMelodicPool.Sample[] samples=new LiveMelodicPool.Sample[spec.samples.length];
        for(int i=0;i<samples.length;i++){SampleSpec s=spec.samples[i];byte[] b=verified(reader,"melodic-assets/"+s.file,s.bytes,s.hash);
            if(b.length!=44+s.frames*2||!tag(b,0,"RIFF")||u32(b,4)!=b.length-8||!tag(b,8,"WAVE")||!tag(b,12,"fmt ")||u32(b,16)!=16||u16(b,20)!=1||u16(b,22)!=1||u32(b,24)!=s.rate||u32(b,28)!=s.rate*2L||u16(b,32)!=2||u16(b,34)!=16||!tag(b,36,"data")||u32(b,40)!=s.frames*2L)throw new IOException("Unexpected melodic WAV format");
            float[] pcm=new float[s.frames];for(int j=0;j<pcm.length;j++){if((j&8191)==0)check();pcm[j]=(short)u16(b,44+j*2)/32768.0f;}samples[i]=new LiveMelodicPool.Sample(pcm,s.rate,s.root,s.start,s.end,s.fade);
        }
        check();LiveMelodicPool.Bank bank=new LiveMelodicPool.Bank(rate,samples,spec.instruments);check();return new Prepared(bank,spec,(int)encoded,(int)decoded);
    }
}
