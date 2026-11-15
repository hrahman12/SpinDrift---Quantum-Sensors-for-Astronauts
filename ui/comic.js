// Comic-strip look for every 3D scene: cel shading (three flat tones, same materials so scene code keeps working),
// black ink outlines, and light dark-theme greys turned into ink so they read on paper. Colours that carry data
// (sensor wavelengths, CPK atoms) are left as they are.
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

export const INK = 0x1d1d1b;
export const PAPER = 0xfbf6e4;

// three tones in luminance, hue kept: the cartoon shading
const CEL = `
  {
    vec3 cc = gl_FragColor.rgb;
    float ll = dot(cc, vec3(0.299, 0.587, 0.114));
    float qq = ll < 0.18 ? 0.30 : ll < 0.5 ? 0.62 : 1.0;
    gl_FragColor.rgb = cc * (qq / max(ll * 1.25, 0.08));
    gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(1.0));
  }`;

function lightGrey(c) {
  const hsl = {}; c.getHSL(hsl);
  return hsl.l > 0.72 && hsl.l < 0.97 && hsl.s < 0.3;
}

export function comicify(root, { keep = () => false } = {}) {
  root.traverse((o) => {
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      if (!m || m.userData.__comic) continue;
      m.userData.__comic = true;
      if (!keep(o, m) && m.color && lightGrey(m.color)) m.color.setHex(INK);
      if (o.isInstancedMesh || o.isPoints || o.isLine) m.userData.outlineParameters = { visible: false };
      if (!m.userData.noCel && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) {
        const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
        m.onBeforeCompile = (shader, r) => { prev?.call(m, shader, r); shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `${CEL}\n#include <dithering_fragment>`); };
        m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|comic`;
        m.needsUpdate = true;
      }
    }
  });
}

// see-through surface with an ink line only where it turns edge-on (a comic silhouette that still shows what is
// inside); used for the skin, where a hull outline would show through the whole body
export function inkRim(material, edge = 0.84) {
  material.userData.noCel = true;
  material.userData.outlineParameters = { visible: false };
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',
      `{ float rimF = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
         if (rimF > ${edge.toFixed(3)}) gl_FragColor = vec4(0.11, 0.11, 0.1, 1.0); }
       #include <dithering_fragment>`);
  };
  material.customProgramCacheKey = () => `inkrim${edge}`;
  material.needsUpdate = true;
  return material;
}

// renders through ink outlines; thickness is in screen-relative units
export function inkRenderer(renderer, thickness = 0.0032) {
  return new OutlineEffect(renderer, { defaultThickness: thickness, defaultColor: [0.11, 0.11, 0.1], defaultAlpha: 1, defaultKeepAlive: true });
}

// flat, bright lighting that suits cel shading
export function comicLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cfb4, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(2, 3, 2.5);
  scene.add(key);
}
