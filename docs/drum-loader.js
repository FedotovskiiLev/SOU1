// SPDX-License-Identifier: AGPL-3.0-only
export function loadRecordedDrums(kit,sampleRate,{signal,makeWorker=()=>new Worker(new URL('./drum-loader-worker.js',import.meta.url),{type:'module'})}={}){
 return new Promise((resolve,reject)=>{
  let worker,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(value);};
  const abort=()=>finish(new DOMException('Drum preparation cancelled','AbortError'));
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  try{worker=makeWorker();if(settled){worker.terminate();return;}worker.onmessage=({data})=>{if(data?.type==='ready')finish(null,data);else if(data?.type==='error')finish(new Error(data.message||'Drum preparation failed'));else finish(new Error('Invalid drum worker response'));};worker.onerror=e=>finish(new Error(e.message||'Drum worker failed'));worker.postMessage({kit,sampleRate});}
  catch(e){finish(e);}
 });
}
