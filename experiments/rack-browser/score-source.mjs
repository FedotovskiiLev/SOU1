// SPDX-License-Identifier: AGPL-3.0-only
import {ENGINE_SHA,ENV_SHA} from '../../tools/instruments/event-score-core.mjs';
import {boundedFetch,sha256} from './bank.mjs';
export async function loadBrowserScore({fetcher=fetch,createModule=text=>URL.createObjectURL(new Blob([text],{type:'text/javascript'})),revokeModule=url=>URL.revokeObjectURL(url),importModule=url=>import(url)}={}){
  const decoded=[];
  for(const [file,hash] of [['audio-engine.js',ENGINE_SHA],['environment-audio.js',ENV_SHA]]){
    const bytes=await boundedFetch(new URL('../../tools/instruments/legacy/'+file,import.meta.url),128*1024,{fetcher});
    if(await sha256(bytes)!==hash)throw new Error('Original score source checksum mismatch');
    decoded.push(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }
  // Execute exactly the verified bytes, never fetch the source URL again on import.
  const urls=[];
  try{const env= createModule(decoded[1]);urls.push(env);const engine=createModule(decoded[0].replace("'./environment-audio.js'",JSON.stringify(env)));urls.push(engine);return await importModule(engine);}
  finally{for(const url of urls)revokeModule(url);}
}
