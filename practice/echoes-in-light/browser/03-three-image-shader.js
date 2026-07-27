// ============================================================================
// BROWSER 03 — Three.js textured plane + scroll-velocity shader (the WebGL look)
// ----------------------------------------------------------------------------
// His 470 KB three bundle is doing image work: textures mapped onto planes with a
// custom fragment shader. The signature move is feeding SCROLL VELOCITY (your
// problem 07 `velocity`) into a uniform so images distort/skew while scrolling and
// settle when you stop. npm i three
//
// CONCEPT CHECK — answer first:
//   • Why render images on WebGL planes at all, instead of <img>? (per-pixel
//     shader effects — distortion, RGB split, transitions — impossible in CSS.)
//   • What are `uniforms` and why is `uTime`/`uVelocity` the bridge between your
//     JS loop and the GPU?
//   • The plane must sit exactly where an HTML slot is. What do you sync between
//     the DOM rect and the mesh position/scale each frame (and on resize)?
//   • Why an OrthographicCamera (or a perspective camera tuned so 1 unit ≈ 1px)
//     for a UI-locked image grid?
// ============================================================================

import * as THREE from "three";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uVelocity;   // fed from the virtual-scroll velocity
  varying vec2 vUv;
  void main() {
    // TODO: offset the UV by uVelocity to skew the image while scrolling, e.g.
    //   vec2 uv = vUv;
    //   uv.y += uVelocity * 0.0005 * (uv.x - 0.5);   // subtle shear
    //   gl_FragColor = texture2D(uTexture, uv);
    gl_FragColor = texture2D(uTexture, vUv);
  }
`;

export function makeImagePlane(texture) {
    const uniforms = {
        uTexture: { value: texture },
        uVelocity: { value: 0 },
    };
    // TODO: PlaneGeometry(1,1) + ShaderMaterial({ vertexShader, fragmentShader, uniforms })
    //       -> Mesh. Each frame set uniforms.uVelocity.value = lenis.velocity (damped).
    return { uniforms /*, mesh */ };
}

// The loop (same single rAF as browser/01):
//   material.uniforms.uVelocity.value = damp(prevVel, lenis.velocity, 0.1);
//   renderer.render(scene, camera);
