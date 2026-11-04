// SPDX-License-Identifier: AGPL-3.0-only
import {prepareMelodicBank} from './melodic-bank.js';
import {melodicTransferList} from './live-melodic-pool.js';
let used=false;
self.onmessage=async({data})=>{
 if(used)return;used=true;
 try{const result=await prepareMelodicBank(data.preset,data.sampleRate);self.postMessage({type:'ready',...result},melodicTransferList(result.wireBank));}
 catch(e){self.postMessage({type:'error',message:e.message||String(e)});}
};
