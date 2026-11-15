import {DRACOLoader} from './vendor/three/examples/jsm/loaders/DRACOLoader.js';
import * as THREE from 'three';
import {GLTFLoader} from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {STLLoader} from './vendor/three/examples/jsm/loaders/STLLoader.js';
import {OrbitControls} from './vendor/three/examples/jsm/controls/OrbitControls.js';
import {MeshoptDecoder} from './vendor/three/examples/jsm/libs/meshopt_decoder.module.js';
const assets={iss:{file:'./assets/nasa/iss.glb',title:'International Space Station',credit:'NASA / Michael D. Carbajal',source:'https://science.nasa.gov/3d-resources/international-space-station-iss-b/'},mars_surface:{file:'./assets/nasa/curiosity.glb',title:'Curiosity rover · Gale Crater',credit:'NASA VTAD',source:'https://science.nasa.gov/resource/curiosity-3d-model/'},lunar_base:{file:'./assets/nasa/moon.glb',title:'Moon · LRO colour map',credit:'NASA Goddard Space Flight Center',source:'https://svs.gsfc.nasa.gov/14959/'},opm:{file:'./assets/hardware/qzfm-gen3.stl',title:'QuSpin QZFM Gen-3',credit:'QuSpin manufacturer mechanical mockup',source:'https://quspin.com/qzfm-dimensions/'}};
export function mountObjects(){
 const host=document.createElement('section');host.className='object-workbench';
 host.innerHTML='<div class="object-card"><div class="object-heading"><span class="kicker">MISSION OBJECT / ORIGINAL NASA MODEL</span><h3 id="mission-object-name">Mission reference</h3></div><div class="object-canvas" id="mission-object"></div><p class="object-credit" id="mission-object-credit"></p></div><div class="object-card"><div class="object-heading"><span class="kicker">HARDWARE / MANUFACTURER GEOMETRY</span><h3>QuSpin QZFM Gen-3</h3></div><div class="object-canvas" id="hardware-object"></div><p class="object-credit">Original QuSpin mechanical mockup · <a href="https://quspin.com/qzfm-dimensions/" target="_blank" rel="noopener noreferrer">Manufacturer source ↗</a><br>Geometry reference, not an operating sensor. Other device CAD is not supplied.</p></div>';
 document.querySelector('#mission-view').after(host);
 function viewer(el){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Reference model. Drag to orbit; arrow keys rotate; plus and minus zoom.');el.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.01,1000);camera.position.set(2,1.5,3);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableDamping=false;
  scene.add(new THREE.HemisphereLight(0xdcecff,0x223344,3));const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(3,4,5);scene.add(light);
  const draw=()=>renderer.render(scene,camera);controls.addEventListener('change',draw);
  renderer.domElement.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key))return;e.preventDefault();const s=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));if(e.key==='ArrowLeft')s.theta-=.1;if(e.key==='ArrowRight')s.theta+=.1;if(e.key==='ArrowUp')s.phi=Math.max(.1,s.phi-.1);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI-.1,s.phi+.1);if(['+','='].includes(e.key))s.radius*=.9;if(e.key==='-')s.radius*=1.1;camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));controls.update();draw();});
  new ResizeObserver(()=>{renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();draw();}).observe(el);
  let model=null,version=0;
  return async id=>{const v=++version,asset=assets[id];if(!asset){if(model)scene.remove(model);model=null;draw();return;}
   try{let object;if(asset.file.endsWith('.stl')){const geometry=await new STLLoader().loadAsync(asset.file);geometry.computeVertexNormals();object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x9aa7b3,metalness:.3,roughness:.3}));}else object=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(new DRACOLoader().setDecoderPath('./vendor/three/examples/jsm/libs/draco/gltf/')).loadAsync(asset.file)).scene;
    if(v!==version)return;if(model)scene.remove(model);const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());object.position.sub(center);const scale=2/Math.max(size.x,size.y,size.z);const root=new THREE.Group();root.add(object);root.scale.setScalar(scale);scene.add(root);model=root;controls.target.set(0,0,0);camera.position.set(2,1.4,3);controls.update();draw();el.dataset.loaded=id;
   }catch(e){el.dataset.error=e.message;el.setAttribute('aria-label','Model unavailable: '+e.message);}
  };
 }
 const mission=viewer(host.querySelector('#mission-object')),hardware=viewer(host.querySelector('#hardware-object'));hardware('opm');
 return id=>{const a=assets[id];host.querySelector('#mission-object-name').textContent=a?.title??'No sourced model for this location';const credit=host.querySelector('#mission-object-credit');credit.replaceChildren();if(a){credit.append(document.createTextNode(a.credit+' · '));const link=document.createElement('a');link.href=a.source;link.textContent='Source model ↗';link.target='_blank';link.rel='noopener noreferrer';credit.append(link,document.createElement('br'),document.createTextNode('Drag to inspect · reference model, not current pose or telemetry.'));}mission(id);};
}
