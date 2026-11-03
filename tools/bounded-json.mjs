// SPDX-License-Identifier: AGPL-3.0-only
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';

// Shared by every JSON-reading offline CLI. A FIFO must not wait for a writer
// before the regular-file check; growth during reading must stay bounded too.
export async function readJson(path,limit){
  if(!Number.isSafeInteger(limit)||limit<1||limit>8*1024*1024)throw new RangeError('JSON byte limit must be 1..8388608');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NONBLOCK??0));
  try{
    const st=await handle.stat();
    if(!st.isFile()||st.size>limit)throw new RangeError('Input must be a bounded regular JSON file');
    let length=0;const chunks=[];
    for await(const chunk of handle.createReadStream({autoClose:false})){
      length+=chunk.length;
      if(length>limit)throw new RangeError('JSON input exceeds size limit');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }finally{await handle.close();}
}
