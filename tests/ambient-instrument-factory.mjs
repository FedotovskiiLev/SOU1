// SPDX-License-Identifier: AGPL-3.0-only
// Use with run-recorded-melodic-parity.sh ROOT tests/ambient-instrument-factory.mjs true.
import {createInstrumentEngine as create} from '../docs/instrument-engine.js';
export function createInstrumentEngine(rate,seed,options){return create(rate,seed,{...options,synthesizedBed:true,evolvingTimbre:true});}
