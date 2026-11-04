// SPDX-License-Identifier: AGPL-3.0-only
// Pure, dependency-free selection for UI/service validation. No audio imports.
export const CUSTOM_DRUM_ROLES=Object.freeze(['kick','snare','hihat','toms','cymbal']);
export const CUSTOM_DRUM_INSTRUMENTS=Object.freeze(['kick','snare','closed-hat','toms','short-clash']);
export const CUSTOM_DRUM_KITS=Object.freeze(['vcsl','fsa-electronic','fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2','guigui-soft','guigui-dynamic']);
const PREFIX='custom-v1';
function recorded(kit){if(typeof kit!=='string'||!CUSTOM_DRUM_KITS.includes(kit))throw new RangeError('Unknown recorded drum kit');return kit;}
/** Omitted roles inherit; explicitly choosing the base canonicalizes to inherit. */
export function normalizeCustomDrumSelection(baseKit,overrides={}){
 recorded(baseKit);
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides)||![Object.prototype,null].includes(Object.getPrototypeOf(overrides)))throw new TypeError('Custom drum overrides');
 for(const key of Reflect.ownKeys(overrides))if(!CUSTOM_DRUM_ROLES.includes(key))throw new RangeError('Unknown custom drum role');
 const normalized={},resolvedKits={};
 for(const role of CUSTOM_DRUM_ROLES){
  const descriptor=Object.getOwnPropertyDescriptor(overrides,role);
  if(descriptor&&!('value' in descriptor))throw new TypeError('Custom drum override must be a value');
  const value=descriptor?descriptor.value:'inherit';
  if(value!=='inherit')recorded(value);
  normalized[role]=value===baseKit?'inherit':value;resolvedKits[role]=normalized[role]==='inherit'?baseKit:value;
 }
 const key=CUSTOM_DRUM_ROLES.every(role=>normalized[role]==='inherit')?baseKit:[PREFIX,baseKit,...CUSTOM_DRUM_ROLES.map(role=>normalized[role])].join('|');
 return Object.freeze({baseKit,overrides:Object.freeze(normalized),resolvedKits:Object.freeze(resolvedKits),key});
}
export function customDrumSelectionKey(baseKit,overrides={}){return normalizeCustomDrumSelection(baseKit,overrides).key;}
/** Accept canonical tokens only: no arbitrary path, percent decoding or JSON. */
export function parseCustomDrumSelection(key){
 if(typeof key!=='string'||key.length>160)throw new TypeError('Custom drum selection key');
 if(CUSTOM_DRUM_KITS.includes(key))return normalizeCustomDrumSelection(key);
 const tokens=key.split('|');
 if(tokens.length!==7||tokens[0]!==PREFIX)throw new RangeError('Custom drum selection key');
 const selection=normalizeCustomDrumSelection(tokens[1],Object.fromEntries(CUSTOM_DRUM_ROLES.map((role,i)=>[role,tokens[i+2]])));
 if(selection.key!==key)throw new RangeError('Noncanonical custom drum selection key');
 return selection;
}
export function isSupportedDrumSelection(key){try{parseCustomDrumSelection(key);return true;}catch{return false;}}
/** UI randomization only. Stable independent role hashes, not an audio RNG. */
export function deterministicRandomDrumOverrides(seed,baseKit,overrides={},locks={}){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Custom drum random seed');
 // Validate without coercion or accessor execution. Retain raw input below,
 // because an explicit base ID is distinct from inherit in editable UI state.
 normalizeCustomDrumSelection(baseKit,overrides);
 if(!locks||typeof locks!=='object'||Array.isArray(locks)||![Object.prototype,null].includes(Object.getPrototypeOf(locks)))throw new TypeError('Custom drum locks');
 for(const key of Reflect.ownKeys(locks))if(!CUSTOM_DRUM_ROLES.includes(key))throw new RangeError('Unknown custom drum lock role');
 for(const role of CUSTOM_DRUM_ROLES){const d=Object.getOwnPropertyDescriptor(locks,role);if(d&&(!('value'in d)||typeof d.value!=='boolean'))throw new TypeError('Custom drum lock must be boolean');}
 const result={};
 for(let i=0;i<CUSTOM_DRUM_ROLES.length;i++){
  const role=CUSTOM_DRUM_ROLES[i],lock=Object.getOwnPropertyDescriptor(locks,role),raw=Object.getOwnPropertyDescriptor(overrides,role);
  if(lock?.value){result[role]=raw?raw.value:'inherit';continue;}
  // Fixed role salts make draws independent of iteration/locks/base selection.
  let hash=(seed^Math.imul(i+1,0x9e3779b9))>>>0;
  hash=Math.imul(hash^(hash>>>16),0x7feb352d);hash=Math.imul(hash^(hash>>>15),0x846ca68b);hash=(hash^(hash>>>16))>>>0;
  result[role]=CUSTOM_DRUM_KITS[hash%CUSTOM_DRUM_KITS.length];
 }
 return Object.freeze(result);
}
