// SPDX-License-Identifier: AGPL-3.0-only
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.NativeDrumBankLoader;
import org.sou1.audio.NativeMelodicBankLoader;

/** Six real-bank PCM/event/routing fixtures, generated locally, never device claims. */
public final class RecordedMelodicEngineVectors {
    private RecordedMelodicEngineVectors() { }
    private static String stats(AmbientEngine e) {
        return "{\"accepted\":"+e.getRecordedMelodicAcceptedCount()+",\"dropped\":"+e.getRecordedMelodicDroppedCount()
                +",\"unmapped\":"+e.getRecordedMelodicUnmappedCount()+",\"fallbacks\":"+e.getMelodicFallbackCount()
                +",\"active\":"+e.getActiveRecordedMelodicVoiceCount()+",\"totalActive\":"+e.getActiveVoiceCount()+"}";
    }
    public static void main(String[] args)throws Exception {
        Path melodicAssets=Path.of(args[0]),drumAssets=Path.of(args[1]),out=Path.of(args[2]);Files.createDirectories(out);
        for(int rate:new int[]{44100,48000}){
            NativeDrumBankLoader.Prepared drums=NativeDrumBankLoader.prepare("fsa-x0xproc2",rate,p->Files.newInputStream(drumAssets.resolve(p)));
            for(String preset:new String[]{"chamber","piano-room","chamber-flute"}){
                NativeMelodicBankLoader.Prepared melody=NativeMelodicBankLoader.prepare(preset,rate,p->Files.newInputStream(melodicAssets.resolve(p)));
                boolean hybrid=Boolean.getBoolean("sou1.hybrid");
                AmbientEngine e=new AmbientEngine(rate,7311,drums.bank,melody.bank,true,null,hybrid,hybrid);e.setParameters(DevelopingEngineTest.knobs(0,true));e.start();
                int total=rate*8;ByteBuffer pcm=ByteBuffer.allocate(total*8).order(ByteOrder.LITTLE_ENDIAN);float[] buffer=new float[256];
                int[] boundaries={rate*2,rate*4,rate*6,total};int boundary=0;StringBuilder snapshots=new StringBuilder("[");
                for(int at=0;at<total;){
                    if(at==rate*2)e.setParameters(DevelopingEngineTest.knobs(1,true));
                    if(at==rate*4)e.setParameters(DevelopingEngineTest.knobs(0,true));
                    if(at==rate*6)e.stop();
                    while(boundaries[boundary]<=at)boundary++;
                    int frames=Math.min(128,boundaries[boundary]-at);e.render(buffer,0,frames);
                    for(int i=0;i<frames*2;i++){float value=buffer[i];if(!Float.isFinite(value)||Math.abs(value)>=.85)throw new AssertionError("Non-finite/unbounded PCM");pcm.putFloat(value);}
                    at+=frames;
                    if(at==boundaries[boundary]){if(boundary>0)snapshots.append(',');snapshots.append("{\"frame\":").append(e.getFrame()).append(",\"stats\":").append(stats(e)).append('}');}
                }
                snapshots.append(']');String name=rate+"-"+preset;
                Files.write(out.resolve(name+".f32"),pcm.array());Files.writeString(out.resolve(name+".history.json"),e.getScoreSnapshot());
                StringBuilder evidence=new StringBuilder("{\"schema\":\"sou1.melodic-engine-vectors.v1\",\"seed\":7311,\"rate\":").append(rate)
                    .append(",\"preset\":\"").append(preset).append("\",\"drumKit\":\"fsa-x0xproc2\",\"melodicManifestSha256\":\"").append(melody.manifestSha256)
                    .append("\",\"melodicEncodedBytes\":").append(melody.encodedBytes).append(",\"melodicDecodedBytes\":").append(melody.decodedBytes)
                    .append(",\"drumPreparedBytes\":").append(drums.report.preparedBytes).append(",\"drumSources\":[");
                for(int i=0;i<drums.report.banks.size();i++){if(i>0)evidence.append(',');NativeDrumBankLoader.Source source=drums.report.banks.get(i);
                    evidence.append("{\"id\":\"").append(source.id).append("\",\"manifest\":\"").append(source.manifest).append("\",\"sha256\":\"").append(source.sha256).append("\",\"sourceCommit\":\"").append(source.sourceCommit).append("\"}");}
                evidence.append("],\"snapshots\":").append(snapshots).append(",\"stats\":").append(stats(e)).append('}');
                Files.writeString(out.resolve(name+".stats.json"),evidence.toString());System.out.println("GENERATED "+name+" "+stats(e));
            }
        }
    }
}
