// Minimal look for every 3D view: soft studio light, physically based materials, and a gentle glow only on parts
// that emit (vapour cells, fibres, verdict lights, fluorescence). No outlines, no cartoon shading.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function lookLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x10131a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.6, 2.6, 2.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1); rim.position.set(-2.4, 1.8, -2.6); scene.add(rim);
}

// renders through a soft bloom; strength stays low so only bright, emissive parts glow
export function glowView(renderer, scene, camera, { strength = 0.55, radius = 0.5, threshold = 0.78 } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const composer = new EffectComposer(renderer);
  const pass = new RenderPass(scene, camera);
  pass.clearAlpha = 0;
  composer.addPass(pass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), strength, radius, threshold));
  composer.addPass(new OutputPass());
  return {
    render(s) { if (s) pass.scene = s; composer.render(); },
    setSize(w, h) { composer.setSize(w, h); },
  };
}
