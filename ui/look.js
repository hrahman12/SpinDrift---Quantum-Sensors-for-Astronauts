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
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    render(s) { if (s) pass.scene = s; composer.render(); },
    setSize(w, h) { composer.setSize(w, h); },
    setStrength(v) { bloom.strength = v; },     // the deeper the level, the more the scene glows
  };
}

// a quiet vertical gradient behind a scene (drawn by the renderer, so it survives the glow pass)
export function gradientBg(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), lg = g.createLinearGradient(0, 0, 0, 256);
  for (const [o, col] of stops) lg.addColorStop(o, col);
  g.fillStyle = lg; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// one backdrop per kind of place: sky above, ground below, all kept dark so the figure stays the subject
export const BACKDROPS = {
  orbit: [[0, '#0d1840'], [0.6, '#080b24'], [1, '#05061a']],
  deep_space: [[0, '#090b20'], [1, '#030410']],
  lunar: [[0, '#020203'], [0.66, '#0b0b0d'], [0.67, '#414143'], [1, '#1d1d1f']],
  mars: [[0, '#2b160e'], [0.66, '#3d1f11'], [0.67, '#63301a'], [1, '#24110a']],
  earth: [[0, '#10263a'], [0.66, '#173442'], [0.67, '#1f3a28'], [1, '#0d1c13']],
  antarctic: [[0, '#16283e'], [0.66, '#2c4258'], [0.67, '#8695a3'], [1, '#3e4a56']],
  arctic: [[0, '#141d28'], [0.66, '#24303c'], [0.67, '#423c30'], [1, '#1d1b15']],
  desert: [[0, '#2a1c10'], [0.66, '#3e2a15'], [0.67, '#634424'], [1, '#271b0e']],
  ocean: [[0, '#0b2e40'], [1, '#03131c']],
  steppe: [[0, '#17232f'], [0.66, '#27343f'], [0.67, '#4e4329'], [1, '#1f1b10']],
};
