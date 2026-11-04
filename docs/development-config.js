// SPDX-License-Identifier: AGPL-3.0-only
// Setup-time helpers only. Call while stopped, then construct a new score.
export const DEVELOPMENT_CONFIG_DEFAULTS=Object.freeze({
  tonic:'seed',mode:'seed',meter:'seed',rhythmFamily:'seed',arpStrategy:'seed',
  drumPattern:'seed',harmony:'auto',drumVariation:'auto'
});
const KEYS=Object.keys(DEVELOPMENT_CONFIG_DEFAULTS);
const MAX={tonic:11,mode:6,meter:5,rhythmFamily:7,arpStrategy:7,drumPattern:7};
const HARMONIES=['auto','fixed','progression','modulating'];
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
function object(value,name){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object`);}
/** Validate a closed schema and copy/freeze it, never retaining mutable caller data. */
export function normalizeDevelopmentConfig(input=DEVELOPMENT_CONFIG_DEFAULTS){
  if(input===DEVELOPMENT_CONFIG_DEFAULTS)return input;
  object(input,'config');
  for(const key of Reflect.ownKeys(input))if(typeof key!=='string'||!own(DEVELOPMENT_CONFIG_DEFAULTS,key))throw new RangeError(`unknown development config key: ${String(key)}`);
  const result={...DEVELOPMENT_CONFIG_DEFAULTS};
  for(const key of KEYS){
    if(!own(input,key))continue;
    const value=input[key];
    if(own(MAX,key)){
      if(value!=='seed'&&(!Number.isInteger(value)||value<0||value>MAX[key]))throw new RangeError(`${key} must be 'seed' or an integer in 0..${MAX[key]}`);
    }else if(key==='harmony'){
      if(!HARMONIES.includes(value))throw new RangeError('harmony must be auto, fixed, progression or modulating');
    }else if(value!=='auto'&&(!Number.isFinite(value)||value<0||value>1))throw new RangeError("drumVariation must be 'auto' or a finite number in 0..1");
    result[key]=value;
  }
  return Object.freeze(result);
}
function hash(n){n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return(n^(n>>>16))>>>0;}
/** Reproducible combinations sampled from individual fields, never a preset list.
 * A true lock keeps the corresponding normalized base value, including 'seed'.
 * Changing one lock does not perturb the random values of other fields.
 */
export function deterministicRandomConfig(seed,base=DEVELOPMENT_CONFIG_DEFAULTS,locks={}){
  if(!Number.isFinite(seed))throw new RangeError('random config seed must be finite');
  const current=normalizeDevelopmentConfig(base);object(locks,'locks');
  for(const key of Reflect.ownKeys(locks)){
    if(typeof key!=='string'||!own(DEVELOPMENT_CONFIG_DEFAULTS,key))throw new RangeError(`unknown development lock key: ${String(key)}`);
    if(typeof locks[key]!=='boolean')throw new TypeError(`lock ${key} must be boolean`);
  }
  const result={};
  for(let i=0;i<KEYS.length;i++){
    const key=KEYS[i],h=hash((seed>>>0)^Math.imul(i+1,0x9e3779b9));
    result[key]=own(locks,key)&&locks[key]===true?current[key]:(own(MAX,key)?h%(MAX[key]+1):(key==='harmony'?HARMONIES[h%4]:(h%101)/100));
  }
  return Object.freeze(result);
}
