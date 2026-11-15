import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {files,validate} from '../contract.mjs';
const root=resolve(import.meta.dirname,'../..'),issues=[],seen=new Set();
async function walk(dir){for(const f of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,f.name);if(f.isDirectory())await walk(p);else if(f.name.endsWith('.json')){const name=relative(resolve(root,'data'),p).replaceAll('\\','/');seen.add(name);try{issues.push(...validate(name,JSON.parse(await readFile(p,'utf8'))));}catch(e){issues.push(`${name}: ${e.message}`);}}}}
await walk(resolve(root,'data'));for(const f of files)if(!seen.has(f))issues.push(`${f}: missing required data file`);
const contract=await readFile(resolve(root,'contract/schema.md'),'utf8');if(!contract.includes('Value object (VO)'))issues.push('contract/schema.md: v10 contract missing');
const config=JSON.parse(await readFile(resolve(root,'app/config.json'),'utf8'));
try{const r=await fetch(config.serverUrl+'/api/live',{signal:AbortSignal.timeout(config.requestTimeoutMs)});if(!r.ok)throw Error(`HTTP ${r.status}`);issues.push(...validate('api/live',await r.json(),{metadata:false}));}catch(e){issues.push('api/live: '+e.message);}
if(issues.length){console.error('CONTRACT CHECK FAILED\n'+issues.join('\n'));process.exitCode=1;}else console.log('All data files and /api/live passed.');
