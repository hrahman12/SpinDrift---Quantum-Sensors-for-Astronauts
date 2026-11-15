import {validateVO,ageState} from './contract.mjs';
export const sensorIds=['opm','nv','qd_renin','cqd_patch'];
// Fail closed: model results, simulations, replays and disconnected instruments cannot populate live sensor cards.
export function liveReadings(packet,device,location,maxAge,now=Date.now()){
 const s=packet?.sensors?.[device];
 if(!s||s.connected!==true||s.device!==device||typeof s.instrument_id!=='string'||!s.instrument_id.trim()||s.location!==location)return {readings:[],reason:'No instrument connection for this mission location'};
 if(!s.readings||typeof s.readings!=='object'||Array.isArray(s.readings))return {readings:[],reason:'Instrument readings unavailable'};
 const entries=Object.entries(s.readings);
 const readings=entries.filter(([,v])=>validateVO(v).length===0&&v.tag==='live'&&v.status==='VERIFIED'&&v.value!==null&&!ageState(v,maxAge,now).stale);
 return {readings,instrument:s.instrument_id,reason:readings.length?'':'No fresh, verified live measurements'};
}
