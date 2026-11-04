// SPDX-License-Identifier: AGPL-3.0-only
import {prepareBrowserRender} from './prepare.mjs';
let busy=false;
self.onmessage=async({data})=>{
  if(busy)return;busy=true;
  try {
    if(!crypto.subtle)throw new Error('Secure context required: localhost or HTTPS');
    const result=await prepareBrowserRender(data.options,{onProgress:value=>self.postMessage({type:'progress',value})});
    const transfer=[result.left.buffer,result.right.buffer];
    if(result.midiBytes)transfer.push(result.midiBytes.buffer);
    self.postMessage({type:'ready',...result},transfer);
  } catch(error) {self.postMessage({type:'error',message:error.message||String(error)});}
  finally {busy=false;}
};
