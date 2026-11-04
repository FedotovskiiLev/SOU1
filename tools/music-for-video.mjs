// SPDX-License-Identifier: AGPL-3.0-only
// Unified local CLI. No downloads, account access, video editor, or browser required.
import {readFile,lstat,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {renderCue,validateOptions,saveCue,PROFILES} from './render-cue.mjs';
import {renderScoreCue,validateRenderScoreOptions,DRUM_KITS} from './render-score-cue.mjs';
import {PREPARED_DRUM_KITS,drumManifestPath} from './instruments/drum-kits.mjs';
import {SCORE_PROFILES} from './instruments/event-score.mjs';
import {readJson} from './bounded-json.mjs';
export {readJson};
const digest=b=>createHash('sha256').update(b).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const ENGINES=['cc0','synth'];
const COMMON=['tools/music-for-video.mjs','tools/bounded-json.mjs','tools/render-cue.mjs','tools/instruments/event-score.mjs','tools/instruments/event-score-core.mjs','tools/instruments/legacy/audio-engine.js','tools/instruments/legacy/environment-audio.js'];
const CC0=['tools/render-score-cue.mjs','tools/instruments/drum-kits.mjs','tools/instruments/rack.mjs','tools/instruments/wav.mjs','tools/instruments/load-bank.mjs','assets/cc0-mini/manifest.json'];
export function normalizeRecipe(recipe){
  if(!plain(recipe)||Object.keys(recipe).some(k=>!['schema','engine','options'].includes(k))||recipe.schema!=='sou1.video-recipe.v1'||!ENGINES.includes(recipe.engine)||!plain(recipe.options))throw new TypeError('Expected sou1.video-recipe.v1 with engine cc0/synth and options');
  const options=recipe.engine==='cc0'?validateRenderScoreOptions(recipe.options):validateOptions(recipe.options);
  return {schema:recipe.schema,engine:recipe.engine,options};
}
export async function rendererFingerprint(engine,options={}){
  if(!ENGINES.includes(engine))throw new TypeError('Unknown engine');
  const kit=engine==='cc0'?validateRenderScoreOptions(options).drumKit:null;
  const extra=PREPARED_DRUM_KITS.includes(kit)?[drumManifestPath(kit)]:[];
  const result={};for(const file of [...COMMON,...(engine==='cc0'?CC0:[]),...extra])result[file]=digest(await readFile(new URL('../'+file,import.meta.url)));
  return result;
}
export async function renderRecipe(input,{expectedSha256,expectedRenderer}={}){
  const recipe=normalizeRecipe(input),rendererFiles=await rendererFingerprint(recipe.engine,recipe.options);
  if(expectedRenderer!==undefined&&(!plain(expectedRenderer)||Object.keys(expectedRenderer).length!==Object.keys(rendererFiles).length||Object.keys(rendererFiles).some(k=>expectedRenderer[k]!==rendererFiles[k])))throw new Error('Renderer/source/bank version differs from receipt; use the matching checkout or create a new render');
  if(expectedSha256!==undefined&&(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256)))throw new TypeError('Invalid expected WAV hash');
  const result=await (recipe.engine==='cc0'?renderScoreCue:renderCue)(recipe.options);
  const hash=digest(result.wav);if(hash!==result.report.sha256)throw new Error('Renderer WAV/report checksum mismatch');
  if(expectedSha256!==undefined&&hash!==expectedSha256)throw new Error('Replay WAV is not byte-identical to receipt; no output saved');
  result.report={...result.report,videoToolSchema:'sou1.video-output.v1',renderRecipe:recipe,rendererFiles,runtime:{node:process.version,platform:process.platform,arch:process.arch},channels:2,bitDepth:24,format:'PCM signed little-endian WAV',actualDuration:result.report.frames/recipe.options.sampleRate,replayVerified:expectedSha256!==undefined};
  return result;
}
export function parseArgs(args){
  const [command,...rest]=args;if(!command||['help','--help','-h'].includes(command)){if(rest.length)throw new Error('Unexpected help arguments');return {command:'help'};}
  if(command==='profiles'){if(rest.length)throw new Error('profiles takes no arguments');return {command};}
  if(!['render','replay'].includes(command))throw new Error('Use render, replay, profiles or help');
  const flags={},keys=new Set(['--out','--config','--engine','--drum-kit','--profile','--seed','--seconds','--rate','--gain-db']);let receipt;
  if(command==='replay'){receipt=rest.shift();if(!receipt||receipt.startsWith('--'))throw new Error('replay requires an existing output JSON receipt');}
  for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!keys.has(key)||Object.hasOwn(flags,key)||value===undefined||value===''||value.startsWith('--'))throw new Error('Unknown, duplicate or missing option: '+key);flags[key]=value;}
  if(!flags['--out']||/\.(wav|json)$/i.test(flags['--out']))throw new Error('--out requires a file base without .wav/.json');
  if(command==='replay'&&Object.keys(flags).some(k=>k!=='--out'))throw new Error('replay accepts only --out; recipe overrides would not be a replay');
  if(flags['--config']&&Object.keys(flags).some(k=>!['--config','--out'].includes(k)))throw new Error('--config cannot be mixed with recipe flags');
  const options={};for(const [flag,name] of [['--drum-kit','drumKit'],['--profile','profile'],['--seed','seed'],['--seconds','duration'],['--rate','sampleRate'],['--gain-db','outputGainDb']])if(Object.hasOwn(flags,flag)){const value=flags[flag];if(name==='profile'||name==='drumKit')options[name]=value;else{if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new Error('Expected decimal number: '+flag);options[name]=Number(value);}}
  return {command,out:resolve(flags['--out']),config:flags['--config'],receipt,recipe:{schema:'sou1.video-recipe.v1',engine:flags['--engine']??'cc0',options}};
}
async function refuseExisting(base){for(const path of [base+'.wav',base+'.json']){try{await lstat(path);}catch(e){if(e.code==='ENOENT')continue;throw e;}throw new Error('Output exists; choose another --out base: '+path);}}
export const HELP=`SOU1 offline music for video (Node, no npm packages)
  node tools/music-for-video.mjs render --engine cc0 --drum-kit fsa-electronic --profile pulse --seed 7311 --seconds 36 --rate 48000 --gain-db 4 --out output/teaser
  node tools/music-for-video.mjs render --config examples/cues/video-pulse.json --out output/teaser
  node tools/music-for-video.mjs replay output/teaser.json --out output/teaser-repeat
  node tools/music-for-video.mjs profiles
Output: BASE.wav (stereo PCM24) and BASE.json (recipe, hashes, events, limits).
No overwrite, automatic normalization, video editing or MP3 export. Existing Node required.
--drum-kit applies only to cc0: ${DRUM_KITS.join(', ')}. No VST host.
cc0: real EventScore + CC0 rack, 4..120s, 44.1/48k. synth: original oscillator DSP, 4..300s.
Durations include a 2s transport tail; this is not an automatic musical ending.
`;
export async function main(args=process.argv.slice(2)){
  const a=parseArgs(args);if(a.command==='help'){process.stdout.write(HELP);return;}
  if(a.command==='profiles'){process.stdout.write(JSON.stringify({cc0:Object.keys(SCORE_PROFILES),synth:Object.keys(PROFILES),drumKits:DRUM_KITS},null,2)+'\n');return;}
  await refuseExisting(a.out);
  let recipe=a.recipe,check={};
  if(a.command==='replay'){const receipt=await readJson(a.receipt,8*1024*1024);if(!plain(receipt)||receipt.videoToolSchema!=='sou1.video-output.v1'||!plain(receipt.rendererFiles)||typeof receipt.sha256!=='string')throw new TypeError('Not a music-for-video output receipt');recipe=receipt.renderRecipe;check={expectedSha256:receipt.sha256,expectedRenderer:receipt.rendererFiles};}
  else if(a.config)recipe=await readJson(a.config,64*1024);
  const result=await renderRecipe(recipe,check);await mkdir(dirname(a.out),{recursive:true});await saveCue(a.out,result);
  process.stdout.write(JSON.stringify({wav:a.out+'.wav',receipt:a.out+'.json',engine:result.report.renderRecipe.engine,sha256:result.report.sha256,frames:result.report.frames,duration:result.report.actualDuration,sampleRate:result.report.renderRecipe.options.sampleRate,channels:2,bitDepth:24,peakDbfs:result.report.peakDbfs,rmsDbfs:result.report.rmsDbfs,replayVerified:result.report.replayVerified})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write('SOU1: '+e.message+'\n');process.exitCode=1;});
