import * as THREE from 'three';
import {GLTFLoader} from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from './vendor/three/examples/jsm/controls/OrbitControls.js';
import {MeshoptDecoder} from './vendor/three/examples/jsm/libs/meshopt_decoder.module.js';
export async function mountAnatomy(host){
 const status=host.querySelector('.anatomy-status');
 try{
  const manifest=await (await fetch('./assets/anatomy/manifest.json')).json();
  const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.tabIndex=0;
  renderer.domElement.setAttribute('aria-label','Interactive Z-Anatomy reference body. Drag to orbit. Arrow keys rotate; plus and minus zoom. Sensor buttons select an anatomical target.');
  host.prepend(renderer.domElement);
  const height=manifest.bounds.max[1]-manifest.bounds.min[1];
  const camera=new THREE.PerspectiveCamera(34,1,.01,100);camera.position.set(height*.12,height*.53,height*1.45);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,height*.52,0);controls.enablePan=false;controls.minDistance=height*.12;controls.maxDistance=height*3;controls.update();
  scene.add(new THREE.HemisphereLight(0xd5e6f3,0x283340,2));
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(2,3,3);scene.add(key);
  const rim=new THREE.DirectionalLight(0x83a4c9,2);rim.position.set(-2,1,-2);scene.add(rim);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),systems=new Map();
  const pins=[];
  const draw=()=>{renderer.render(scene,camera);for(const pin of pins){const point=pin.point.clone().project(camera);pin.el.style.left=((point.x+1)*50)+'%';pin.el.style.top=((-point.y+1)*50)+'%';pin.el.hidden=point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1;}};
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();draw();};
  new ResizeObserver(resize).observe(host);controls.addEventListener('change',draw);
  await Promise.all(['skeletal','cardiovascular','nervous','integumentary'].map(async id=>{
   const system=manifest.systems.find(x=>x.id===id);const gltf=await loader.loadAsync('./assets/anatomy/'+system.file);
   gltf.scene.traverse(o=>{if(o.isMesh){o.material=new THREE.MeshStandardMaterial({color:id==='skeletal'?0xd3cfbd:id==='nervous'?0xc9ae79:id==='cardiovascular'?0x9b5655:0xc3d0d9,roughness:.7,metalness:.05,transparent:true,opacity:id==='integumentary'?.12:.8,depthWrite:id!=='integumentary'});}});
   systems.set(id,gltf.scene);scene.add(gltf.scene);draw();
  }));
  for(const [id,device,label]of [['brain','opm','Brain · OPM'],['heart','nv','Heart · NV']]){const structure=manifest.structures.find(x=>x.id===id);if(!structure)continue;const el=document.createElement('button');el.className='anatomy-pin';el.textContent=label;el.setAttribute('aria-label','Select '+label);el.onclick=()=>{document.dispatchEvent(new CustomEvent('spindrift:pick',{detail:device}));focus();};host.append(el);pins.push({el,point:new THREE.Vector3(...structure.center)});}
  let current='opm',layer='anatomy';
  const select=dev=>{current=dev;const target={opm:'nervous',nv:'cardiovascular',cqd_patch:'integumentary'}[dev];for(const [id,group]of systems)group.traverse(o=>{if(o.isMesh){const focus=o.name===(dev==='opm'?'brain':dev==='nv'?'heart':'skin');o.visible=layer==='surface'?id==='integumentary':layer==='skeleton'?id==='skeletal':true;o.material.opacity=layer==='surface'?.9:layer==='skeleton'?1:id==='integumentary'?(target===id?.35:.055):focus?1:id==='skeletal'?.4:id===target?.4:.12;o.material.emissive.setHex(focus?0x40596a:0);}});status.textContent=dev==='qd_renin'?'Renin is a sample assay; no body-mounted device is asserted.':'Reference anatomy · conceptual sensor target, not an installed device';draw();};
  const reset=()=>{controls.target.set(0,height*.52,0);camera.position.set(height*.12,height*.53,height*1.45);controls.update();draw();};
  const focus=()=>{const id=current==='opm'?'brain':current==='nv'?'heart':null;const structure=manifest.structures.find(x=>x.id===id);if(!structure){reset();return;}const center=new THREE.Vector3(...structure.center),extent=Math.max(...structure.max.map((v,i)=>v-structure.min[i]));controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(extent*.7,extent*.2,extent*3.6));controls.update();draw();};
  document.querySelectorAll('[data-body-layer]').forEach(b=>b.onclick=()=>{layer=b.dataset.bodyLayer;document.querySelectorAll('[data-body-layer]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));select(current);});
  document.querySelector('#body-reset').onclick=reset;document.querySelector('#body-focus').onclick=focus;
  renderer.domElement.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();const offset=camera.position.clone().sub(controls.target),s=new THREE.Spherical().setFromVector3(offset);if(e.key==='ArrowLeft')s.theta-=.1;if(e.key==='ArrowRight')s.theta+=.1;if(e.key==='ArrowUp')s.phi=Math.max(.1,s.phi-.1);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI-.1,s.phi+.1);if(['+','='].includes(e.key))s.radius*=.9;if(e.key==='-')s.radius*=1.1;camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();draw();});
  const ray=new THREE.Raycaster();let start=null;
  renderer.domElement.addEventListener('pointerdown',e=>{start=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{if(!start||Math.hypot(e.clientX-start[0],e.clientY-start[1])>5)return;const r=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hits=ray.intersectObjects([...systems.values()],true).filter(h=>h.object.visible&&h.object.material.opacity>.2);const mesh=hits[0]?.object;if(!mesh)return;let device;if(mesh.name==='brain'||mesh.name.includes('cerebr'))device='opm';else if(mesh.name.includes('heart')||mesh.name==='aorta'||mesh.name.includes('cardiac'))device='nv';else if(mesh.name==='skin')device='cqd_patch';if(device)document.dispatchEvent(new CustomEvent('spindrift:pick',{detail:device}));});
  document.addEventListener('spindrift:sensor',e=>select(e.detail));select('opm');resize();host.dataset.loaded='true';
 }catch(e){status.textContent='Reference anatomy could not load: '+e.message;}
}
