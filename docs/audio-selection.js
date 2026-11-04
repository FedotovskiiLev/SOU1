// SPDX-License-Identifier: AGPL-3.0-only
// Small setup/UI contracts. No sample catalogs, decoders or DSP are imported.
import {CUSTOM_DRUM_KITS,CUSTOM_DRUM_ROLES,isSupportedDrumSelection} from './custom-drum-selection.js';
import {DEVELOPMENT_CONFIG_DEFAULTS,normalizeDevelopmentConfig} from './development-config.js';
export const MELODIC_PRESETS=Object.freeze(['procedural','chamber','piano-room','chamber-flute']);
export const DEVELOPMENT_KEYS=Object.freeze(Object.keys(DEVELOPMENT_CONFIG_DEFAULTS));
export function isSupportedAudioDrumKey(key){return key==='procedural'||isSupportedDrumSelection(key);}
export function normalizedDrumOverrides(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Drum overrides');
 for(const key of Reflect.ownKeys(input))if(!CUSTOM_DRUM_ROLES.includes(key))throw new RangeError('Unknown drum role');
 const value={};for(const key of CUSTOM_DRUM_ROLES){const d=Object.getOwnPropertyDescriptor(input,key);if(d&&!('value'in d))throw new TypeError('Drum override value');const selected=d?d.value:'inherit';if(selected!=='inherit'&&!CUSTOM_DRUM_KITS.includes(selected))throw new RangeError('Unknown drum sample bank');value[key]=selected;}return Object.freeze(value);
}
export function normalizedLocks(input={},keys=DEVELOPMENT_KEYS){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Selection locks');const result={};
 for(const key of Reflect.ownKeys(input)){if(!keys.includes(key))throw new RangeError('Unknown lock');const d=Object.getOwnPropertyDescriptor(input,key);if(!d||!('value'in d)||typeof d.value!=='boolean')throw new TypeError('Lock value');}
 for(const key of keys)result[key]=Object.prototype.hasOwnProperty.call(input,key)?input[key]:false;return Object.freeze(result);
}
export function scoreConfigIdentity(value){return JSON.stringify(normalizeDevelopmentConfig(value===undefined?DEVELOPMENT_CONFIG_DEFAULTS:value));}
