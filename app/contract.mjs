export const tags = new Set(['live','near_live','recorded','datasheet','published_spec','calculated','simulated']);
export const statuses = new Set(['VERIFIED','NOT_STATED','NOT_YET_EXTRACTED','TO_CONFIRM']);
export const files = ['specs.json','locations.json','physics.json','nv_heart_derived.json','nasa_i4.json','published_points.json','hrp.json','simulators.json','clinical_card.json','build_log.json','live_snapshot.json','runs.json','combined_sensor.json',...['opm_brain_mne','opm_heart_kiel','nv_odmr_zenodo10629041','qd_fret_figshare5468838','cqd_pl_mendeley_cmfbrvrb8y'].map(x=>`recorded/${x}.json`)];
export const isVO = x => !!x && typeof x==='object' && 'value' in x && 'status' in x;
const iso = x => typeof x==='string' && /^\d{4}-\d\d-\d\dT/.test(x) && /(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
export function validateVO(v,p='value') {
 const e=[];
 if(!isVO(v)) return [`${p}: expected value object`];
 for(const k of ['value','unit','source','tag','status','as_of','note']) if(!(k in v))e.push(`${p}: missing ${k}`);
 if(!(v.value===null || typeof v.value==='string'||(typeof v.value==='number'&&Number.isFinite(v.value))))e.push(`${p}: invalid value`);
 if(typeof v.unit!=='string'||typeof v.source!=='string'||!v.source.trim())e.push(`${p}: unit/source required`);
 if(!tags.has(v.tag)||!statuses.has(v.status))e.push(`${p}: invalid tag/status`);
 if(['NOT_STATED','NOT_YET_EXTRACTED'].includes(v.status)&&v.value!==null)e.push(`${p}: unavailable value must be null`);
 if(v.status==='VERIFIED'&&v.value===null)e.push(`${p}: VERIFIED value cannot be null`);
 if(v.as_of!==null&&!iso(v.as_of))e.push(`${p}: invalid measurement timestamp`);
 if(['live','near_live'].includes(v.tag)&&!iso(v.as_of))e.push(`${p}: measurement timestamp required`);
 if(v.tag==='calculated'&&!(typeof v.note==='string'&&v.note.trim()))e.push(`${p}: calculation formula/input IDs required`);
 if(v.note!==null&&typeof v.note!=='string')e.push(`${p}: invalid note`);
 return e;
}
export function validate(name,d,{metadata=true}={}) {
 const e=[]; const need=(o,keys,p)=>{if(!o||typeof o!=='object'){e.push(`${p}: expected object`);return;}for(const k of keys)if(!(k in o))e.push(`${p}: missing ${k}`);};
 const arr=(x,p)=>{if(!Array.isArray(x)){e.push(`${p}: expected array`);return [];}return x;};
 if(!d||typeof d!=='object')return [`${name}: expected JSON object or array`];
 // locations is explicitly an array in the shared contract, despite its global metadata rule.
 if(metadata&&!(name==='locations.json'&&Array.isArray(d))){
  need(d.meta,['fixture','generated_at','sources'],`${name}.meta`);
  if(d.meta&&(typeof d.meta.fixture!=='boolean'||!iso(d.meta.generated_at)||!Array.isArray(d.meta.sources)))e.push(`${name}: invalid metadata`);
 }
 const walk=(x,p)=>{if(isVO(x)){e.push(...validateVO(x,p));return;}if(Array.isArray(x))x.forEach((v,i)=>walk(v,`${p}[${i}]`));else if(x&&typeof x==='object')Object.entries(x).forEach(([k,v])=>walk(v,`${p}.${k}`));else if(typeof x==='number'&&!Number.isFinite(x))e.push(`${p}: non-finite number`);};walk(d,name);
 if(name==='specs.json')need(d,['opm','nv','qd_renin','cqd_patch','space_heritage'],name);
 if(name==='locations.json')arr(Array.isArray(d)?d:d.locations,name).forEach((v,i)=>{need(v,['id','label','ambient_field_nT','field_kind'],`${name}[${i}]`);e.push(...validateVO(v.ambient_field_nT,`${name}[${i}].ambient_field_nT`));if(!['iss','gateway','lunar_base','mars_transit','mars_surface'].includes(v.id)||!['live_feed','model','published','none'].includes(v.field_kind))e.push(`${name}: invalid location`);});
 if(name.startsWith('recorded/')){
  need(d,['x','series'],name);need(d.meta,['dataset','doi_or_url','licence','accessed','device_type','label'],`${name}.meta`);
  need(d.x,['name','unit','values'],`${name}.x`);
  const x=arr(d.x?.values,`${name}.x.values`);if(x.some(v=>typeof v!=='number'||!Number.isFinite(v)))e.push(`${name}: invalid x samples`);
  arr(d.series,`${name}.series`).forEach(s=>{need(s,['name','unit','values'],name);if(!Array.isArray(s.values)||s.values.length!==x.length||s.values.some(v=>typeof v!=='number'||!Number.isFinite(v)))e.push(`${name}: unaligned/invalid samples`);});
 }
 if(name==='physics.json')for(const k of ['nv_odmr_lines','opm_zero_field','qd_fret_vs_distance','cqd_quenching']){const c=d[k];need(c,['plotted','x','y','x_label','y_label','equation','inputs','missing_inputs'],k);if(c&&(!Array.isArray(c.x)||!Array.isArray(c.y)||c.x.length!==c.y.length||[...c.x,...c.y].some(v=>typeof v!=='number'||!Number.isFinite(v))))e.push(`${k}: invalid curve`);}
 const roots={'nv_heart_derived.json':['recorded_id','channel','averaged_beat','per_build'],'nasa_i4.json':['datasets','not_found'],'published_points.json':['qd_renin','cqd_patch'],'hrp.json':['hazards'],'simulators.json':['opm','nv','qd_renin','cqd_patch'],'build_log.json':['per_sensor','combined'],'runs.json':['runs'],'combined_sensor.json':['version','runs_counted','components','open_questions']};
 if(roots[name])need(d,roots[name],name);
 if(name==='runs.json')arr(d.runs,'runs').forEach(r=>{need(r,['run_id','started_at','location','role','inputs','outputs','links','adds_to_combined'],'run');for(const side of ['inputs','outputs'])for(const dev of ['opm','nv','qd_renin','cqd_patch'])arr(r[side]?.[dev],`run.${side}.${dev}`).forEach((v,i)=>e.push(...validateVO(v,`run.${side}.${dev}[${i}]`)));for(const key of ['links','adds_to_combined'])arr(r[key],`run.${key}`).forEach(f=>e.push(...validateVO(f.value,`run.${key}.value`)));});
 if(name==='combined_sensor.json'){
  if(!Number.isInteger(d.version)||!Number.isInteger(d.runs_counted)||d.version<0||d.runs_counted<0)e.push('combined: invalid version/run count');
  for(const [k,c]of Object.entries(d.components??{})){need(c,['facts','status'],k);arr(c.facts,k+'.facts').forEach(f=>{need(f,['fact','value','from_run'],k);e.push(...validateVO(f.value,k+'.value'));});}
 }
 if(name==='specs.json'){
  const specWalk=(x,p)=>{if(isVO(x)){e.push(...validateVO(x,p));return;}if(!x||typeof x!=='object'){e.push(`${p}: hardware specifications require value objects`);return;}Object.entries(x).filter(([k])=>k!=='meta').forEach(([k,v])=>specWalk(v,p+'.'+k));};specWalk(d,name);
 }
 if(name==='simulators.json')for(const dev of roots[name])arr(d[dev],dev).forEach(s=>{need(s,['tool','url','access','account_needed','models','limits','inputs','missing_inputs','results'],dev);arr(s.inputs,dev+'.inputs').forEach(i=>{need(i,['name','value','origin'],dev);e.push(...validateVO(i.value,dev+'.input'));});arr(s.results,dev+'.results').forEach(r=>{need(r,['run_at','via','outputs'],dev);const outputWalk=(x,p)=>{if(isVO(x)){if(x.tag!=='simulated')e.push(`${p}: simulator result must be tagged simulated`);}else if(x&&typeof x==='object')Object.entries(x).forEach(([k,v])=>outputWalk(v,p+'.'+k));else e.push(`${p}: simulator outputs require value objects`);};if(r.outputs?.tag!=='simulated')outputWalk(r.outputs,dev);});});
 if(['live_snapshot.json','api/live'].includes(name)){
  need(d,['fetched_at','iss','l1','swarm_asm','iss_cabin','opm_readiness','errors'],name);
  if(!iso(d.fetched_at)&&!(d.meta?.fixture===true&&d.fetched_at===null))e.push(`${name}: invalid fetched_at`);
  for(const [feed,keys]of Object.entries({iss:['lat','lon','alt_km','velocity_kmh','b_total_nT'],l1:['bt_nT','bx_gsm_nT','by_gsm_nT','bz_gsm_nT'],swarm_asm:['f_nT','lat','lon','alt_km']}))if(d[feed]!=null)for(const k of keys)e.push(...validateVO(d[feed][k],`${name}.${feed}.${k}`));
 }
 return e;
}
export function ageState(v,limit,now=Date.now()){
 if(!['live','near_live'].includes(v?.tag))return null;
 const time=Date.parse(v.as_of),seconds=(now-time)/1000;
 return {seconds:Math.max(0,Math.floor(seconds)),stale:!Number.isFinite(seconds)||seconds>limit||seconds< -30,invalid:!Number.isFinite(seconds)||seconds< -30};
}
