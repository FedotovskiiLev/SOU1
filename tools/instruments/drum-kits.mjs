// SPDX-License-Identifier: AGPL-3.0-only
// Closed registry: select one bank, never construct a path from arbitrary input.
export const FSA_FULL_KITS=Object.freeze(['fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2']);
export const FSA_KITS=Object.freeze(['fsa-electronic',...FSA_FULL_KITS]);
const MANIFESTS=Object.freeze(Object.fromEntries([['fsa-electronic','assets/fsa-electronic/manifest.json'],...FSA_FULL_KITS.map(id=>[id,`assets/fsa-drums/${id.slice(4)}/manifest.json`])]));
export function drumManifestPath(kit){if(!FSA_KITS.includes(kit))throw new RangeError('Unknown prepared drum kit');return MANIFESTS[kit];}
export function drumManifestUrl(kit){return new URL('../../'+drumManifestPath(kit),import.meta.url);}
