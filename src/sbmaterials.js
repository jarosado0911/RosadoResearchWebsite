// Materials of the SpineBuilder page (src/spinebuilder.js, src/idealspine.js): a see-through membrane (more opaque
// at its silhouette) and lit solids for the organelles, with a fade for switching meshes. The same look as the
// spine gallery (src/spines.js).
import * as THREE from 'three';

export const COLORS = {
  membrane: 0x9fc4ff,
  syn: 0xffa53a,      // synapse (postsynaptic density): the site's accent
  sa: 0x46e3a0,       // spine apparatus
  er: 0x3fa8e8,       // ER
};
export const MEMBRANE_OPACITY = [0.08, 0.7];   // facing the camera, at the silhouette

const vertexShader = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz; vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const solidFS = /* glsl */ `
  uniform vec3 uColor; uniform float uGlow; uniform float uAlpha; uniform float uFade;
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(vV);
    if (!gl_FrontFacing) N = -N;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    vec3 L1 = normalize(vec3(0.5, 0.8, 0.6)), L2 = normalize(vec3(-0.6, -0.2, 0.4));
    float d = max(dot(N, L1), 0.0) * 0.8 + max(dot(N, L2), 0.0) * 0.25;
    float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 40.0) * 0.35;
    vec3 col = uColor * (0.22 + d) + spec + uColor * fres * 0.5 + uColor * uGlow;
    gl_FragColor = vec4(col, uAlpha * uFade);
  }`;

const membraneFS = /* glsl */ `
  uniform vec3 uColor; uniform vec2 uOpacity; uniform float uFade;
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(vV);
    if (!gl_FrontFacing) N = -N;
    float fres = pow(1.0 - abs(dot(N, V)), 2.2);
    float a = mix(uOpacity.x, uOpacity.y, fres);
    vec3 L = normalize(vec3(0.5, 0.8, 0.6));
    vec3 col = uColor * (0.35 + 0.65 * max(dot(N, L), 0.0)) + uColor * fres * 0.6;
    gl_FragColor = vec4(col, a * uFade);
  }`;

/** A lit solid; alpha < 1 makes it see-through. Fade it with material.uniforms.uFade (0..1). */
export function solidMaterial(color, glow = 0, alpha = 1) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader: solidFS,
    uniforms: { uColor: { value: new THREE.Color(color) }, uGlow: { value: glow }, uAlpha: { value: alpha }, uFade: { value: 1 } },
    transparent: true, depthWrite: alpha >= 1,
  });
}

/** The membrane, drawn twice: back faces (THREE.BackSide) first, then front faces (THREE.FrontSide) */
export function membraneMaterial(side, opacity = MEMBRANE_OPACITY) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader: membraneFS, transparent: true, depthWrite: false, side,
    uniforms: { uColor: { value: new THREE.Color(COLORS.membrane) }, uOpacity: { value: new THREE.Vector2(...opacity) }, uFade: { value: 1 } },
  });
}
