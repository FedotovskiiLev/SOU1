// SPDX-License-Identifier: AGPL-3.0-only
// Closed registry: select one bank, never construct a path from arbitrary input.
export const FSA_FULL_KITS=Object.freeze(['fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2']);
export const FSA_KITS=Object.freeze(['fsa-electronic',...FSA_FULL_KITS]);
export const GUIGUI_KITS=Object.freeze(['guigui-soft','guigui-dynamic']);
export const PREPARED_DRUM_KITS=Object.freeze([...FSA_KITS,...GUIGUI_KITS]);
export const FULL_DRUM_KITS=Object.freeze([...FSA_FULL_KITS,...GUIGUI_KITS]);
const MANIFESTS=Object.freeze(Object.fromEntries([['fsa-electronic','assets/fsa-electronic/manifest.json'],...FSA_FULL_KITS.map(id=>[id,`assets/fsa-drums/${id.slice(4)}/manifest.json`]),...GUIGUI_KITS.map(id=>[id,`assets/guigui-drums/manifest-${id.slice(7)}.json`])]));
export function drumManifestPath(kit){if(!PREPARED_DRUM_KITS.includes(kit))throw new RangeError('Unknown prepared drum kit');return MANIFESTS[kit];}
export function drumManifestUrl(kit){return new URL('../../'+drumManifestPath(kit),import.meta.url);}
export function drumKitCapabilities(kit){
  drumManifestPath(kit);
  return Object.freeze({clap:!GUIGUI_KITS.includes(kit),toms:FULL_DRUM_KITS.includes(kit),cymbal:kit==='fsa-electronic'||kit==='fsa-sdbkit'?null:GUIGUI_KITS.includes(kit)?'splash':kit==='fsa-x0xproc2'?'cymbal':'crash',velocityLayers:kit==='guigui-dynamic'?2:1});
}
