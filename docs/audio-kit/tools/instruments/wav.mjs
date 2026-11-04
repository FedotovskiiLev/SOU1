// SPDX-License-Identifier: AGPL-3.0-only
// Strict dependency-free RIFF PCM decoder; no fetch or executable asset loading.
export function decodePcmWav(bytes, maxDecodedBytes=8*1024*1024) {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>16*1024*1024||bytes.byteLength<44)throw new RangeError('WAV input size');
  if(!Number.isSafeInteger(maxDecodedBytes)||maxDecodedBytes<4||maxDecodedBytes>64*1024*1024)throw new RangeError('decoded budget');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),str=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
  if(str(0,4)!=='RIFF'||str(8,4)!=='WAVE'||v.getUint32(4,true)+8!==bytes.length)throw new Error('Invalid RIFF size/signature');
  let fmt,data;
  for(let at=12;at<bytes.length;) {
    if(at+8>bytes.length)throw new Error('Truncated chunk');
    const tag=str(at,4),size=v.getUint32(at+4,true),end=at+8+size;
    if(end>bytes.length)throw new Error('Truncated chunk payload');
    if(tag==='fmt '){if(fmt||size<16)throw new Error('Invalid fmt chunk');fmt={format:v.getUint16(at+8,true),channels:v.getUint16(at+10,true),rate:v.getUint32(at+12,true),byteRate:v.getUint32(at+16,true),align:v.getUint16(at+20,true),bits:v.getUint16(at+22,true)};}
    if(tag==='data'){if(data)throw new Error('Duplicate data chunk');data={at:at+8,size};}
    at=end+(size&1);if(at>bytes.length)throw new Error('Missing chunk padding');
  }
  if(!fmt||!data||fmt.format!==1||![16,24].includes(fmt.bits)||![1,2].includes(fmt.channels)||fmt.rate<8000||fmt.rate>192000)throw new Error('Unsupported PCM format');
  const width=fmt.bits/8,align=width*fmt.channels,frames=data.size/align;
  if(fmt.align!==align||fmt.byteRate!==fmt.rate*align||!Number.isInteger(frames)||frames<2||frames*fmt.channels*4>maxDecodedBytes)throw new RangeError('PCM shape/budget');
  const channels=Array.from({length:fmt.channels},()=>new Float32Array(frames));
  for(let i=0;i<frames;i++)for(let c=0;c<fmt.channels;c++){
    const p=data.at+i*align+c*width;let x;
    if(width===2)x=v.getInt16(p,true)/32768;
    else {let n=v.getUint8(p)|(v.getUint8(p+1)<<8)|(v.getUint8(p+2)<<16);x=((n^8388608)-8388608)/8388608;}
    channels[c][i]=x;
  }
  return {sampleRate:fmt.rate,frames,channels,decodedBytes:frames*fmt.channels*4};
}
