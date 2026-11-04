// SPDX-License-Identifier: AGPL-3.0-only
import{prepareWeatherBank}from'./weather-bank.js';let used=false;
self.onmessage=async({data})=>{if(used)return;used=true;try{const r=await prepareWeatherBank(data.sampleRate);self.postMessage({type:'ready',...r},r.weatherBank.samples.map(s=>s.buffer));}catch(e){self.postMessage({type:'error',message:e.message||String(e)});}};
