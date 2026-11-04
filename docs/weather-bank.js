// SPDX-License-Identifier: AGPL-3.0-only
// Background preparation. Assets are bundled and integrity locked; playback is offline.
import{boundedFetch,sha256}from'./audio-kit/experiments/rack-browser/bank.mjs';
import{decodePcmWav}from'./audio-kit/tools/instruments/wav.mjs';
import{WEATHER_ASSETS}from'./weather-catalog.js';
export function resampleWeather(pcm,step,loop){const n=Math.ceil(pcm.length/step),out=new Float32Array(n),cut=.92*Math.min(1,1/step);for(let i=0;i<n;i++){const pos=i*step,base=Math.floor(pos);let sum=0,weights=0;for(let j=base-7;j<=base+8;j++){const d=pos-j;if(Math.abs(d)>=8)continue;const x=d*cut,w=cut*(Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x))*(.5+.5*Math.cos(Math.PI*d/8));weights+=w;if(loop||j>=0&&j<pcm.length)sum+=pcm[loop?(j%pcm.length+pcm.length)%pcm.length:j]*w;}out[i]=Math.abs(weights)>1e-9?sum/weights:0;}return out;}
export async function prepareWeatherBank(rate,{fetcher=fetch,assetBaseUrl=new URL('./weather-assets/',import.meta.url),signal}={}){
 if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new RangeError('Weather rate');const check=()=>{if(signal?.aborted)throw new DOMException('Weather preparation cancelled','AbortError');};const get=async(file,spec)=>{check();const b=await boundedFetch(new URL(file,assetBaseUrl),spec.bytes,{fetcher:(u,o)=>fetcher(u,{...o,signal})});check();if(b.length!==spec.bytes||await sha256(b)!==spec.sha256)throw new Error('Weather integrity mismatch');return b;};
 await get('manifest.json',WEATHER_ASSETS.manifest);const samples=[];for(const s of WEATHER_ASSETS.samples){const raw=await get(s.file,s),d=decodePcmWav(raw);if(d.channels.length!==1||d.sampleRate!==s.sampleRate||d.frames!==s.frames)throw new Error('Weather metadata mismatch');samples.push(resampleWeather(d.channels[0],d.sampleRate/rate,s.loop));check();}
 return{weatherBank:{schema:'sou1.weather-prepared.v1',sampleRate:rate,samples}};
}
