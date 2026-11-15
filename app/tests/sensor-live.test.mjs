import test from 'node:test';
import assert from 'node:assert/strict';
import {liveReadings} from '../sensor-live.mjs';
const time='2026-01-01T00:00:00Z',now=Date.parse(time);
const reading={value:10,unit:'pT',source:'https://instrument.example/readout',tag:'live',status:'VERIFIED',as_of:time,note:null};
const packet=v=>({sensors:{nv:{device:'nv',connected:true,instrument_id:'test-instrument',location:'iss',readings:{field:v}}}});
test('only fresh verified connected measurements enter live cards',()=>{assert.equal(liveReadings(packet(reading),'nv','iss',30,now).readings.length,1);for(const tag of ['recorded','simulated','calculated','near_live','datasheet'])assert.equal(liveReadings(packet({...reading,tag}),'nv','iss',30,now).readings.length,0);});
test('stale, unverified, wrong-location and disconnected readings are withheld',()=>{assert.equal(liveReadings(packet(reading),'nv','iss',30,now+31000).readings.length,0);assert.equal(liveReadings(packet({...reading,status:'TO_CONFIRM'}),'nv','iss',30,now).readings.length,0);assert.equal(liveReadings(packet(reading),'nv','mars_surface',30,now).readings.length,0);const p=packet(reading);p.sensors.nv.connected=false;assert.equal(liveReadings(p,'nv','iss',30,now).readings.length,0);});
