/**
 * GLSL 着色器集合（WebGL2 / GLSL ES 3.00）
 * 场景使用实例化球体：每个实例 = 一颗恒星，顶点着色器按视亮度与距离决定球体屏幕半径。
 */
(function (HYG) {
  "use strict";

  const sceneVS = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos;     // 单位球顶点
  layout(location=1) in vec3 iPos;     // 恒星位置 (pc)
  layout(location=2) in vec3 iColor;   // 黑体颜色（已归一化）
  layout(location=3) in float iMag;    // 视星等

  uniform mat4 uView;
  uniform mat4 uProj;
  uniform float uPixScale;   // 距离 1 处每世界单位对应的像素数
  uniform float uRadius;     // 透视基准半径 (pc)
  uniform float uSizeMag;    // 视亮度基准半径 (px)
  uniform float uMinPx;
  uniform float uMaxPx;

  out vec3 vN;
  out vec3 vCol;
  out float vFlux;

  void main() {
    vec4 vp = uView * vec4(iPos, 1.0);
    float d = max(-vp.z, 0.0005);

    // 物理流量：F = 10^(-0.4 m)，iMag 以 0.01 星等为单位存储
    float flux = pow(10.0, -0.004 * iMag);

    // 屏幕半径：视亮度主导，靠近时按透视放大（近大远小）
    float pxMag = uSizeMag * pow(flux, 0.22);
    float pxPersp = uRadius / d * uPixScale;
    float px = clamp(max(pxMag, pxPersp), uMinPx, uMaxPx);
    float worldR = px * d / uPixScale;

    vN = normalize(aPos);
    vCol = iColor;
    vFlux = flux;

    gl_Position = uProj * vec4(vp.xyz + aPos * worldR, 1.0);
  }`;

  const sceneFS = `#version 300 es
  precision highp float;
  in vec3 vN;
  in vec3 vCol;
  in float vFlux;
  uniform float uExposure;
  out vec4 outColor;

  void main() {
    float r = length(vN.xy);
    float edge = 1.0 - smoothstep(0.90, 1.0, r);      // 边缘柔化
    float mu = clamp(vN.z, 0.0, 1.0);
    float limb = 0.22 + 0.78 * pow(mu, 0.45);         // 临边昏暗
    vec3 c = vCol * (vFlux * uExposure) * limb * edge;
    outColor = vec4(c, 1.0);
  }`;

  const quadVS = `#version 300 es
  precision highp float;
  out vec2 vUv;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const brightFS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  uniform float uThreshold;
  in vec2 vUv;
  out vec4 outColor;
  void main() {
    vec3 c = (texture(uTex, vUv + uTexel * vec2(-0.5,-0.5)).rgb +
              texture(uTex, vUv + uTexel * vec2( 0.5,-0.5)).rgb +
              texture(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb +
              texture(uTex, vUv + uTexel * vec2( 0.5, 0.5)).rgb) * 0.25;
    float l = max(max(c.r, c.g), c.b);
    float k = max(l - uThreshold, 0.0) / max(l, 1e-5);
    outColor = vec4(c * k, 1.0);
  }`;

  const blurFS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uDir;
  in vec2 vUv;
  out vec4 outColor;
  void main() {
    vec3 s = texture(uTex, vUv).rgb * 0.2270270270;
    s += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    s += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    s += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    s += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    outColor = vec4(s, 1.0);
  }`;

  const copyFS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  in vec2 vUv;
  out vec4 outColor;
  void main() {
    vec3 c = (texture(uTex, vUv + uTexel * vec2(-0.5,-0.5)).rgb +
              texture(uTex, vUv + uTexel * vec2( 0.5,-0.5)).rgb +
              texture(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb +
              texture(uTex, vUv + uTexel * vec2( 0.5, 0.5)).rgb) * 0.25;
    outColor = vec4(c, 1.0);
  }`;

  const compositeFS = `#version 300 es
  precision highp float;
  uniform sampler2D uScene;
  uniform sampler2D uBloomHalf;
  uniform sampler2D uBloomQuarter;
  uniform float uBloom;
  uniform vec2 uRes;
  in vec2 vUv;
  out vec4 outColor;

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void main() {
    vec3 scene = texture(uScene, vUv).rgb;
    vec3 bloom = texture(uBloomHalf, vUv).rgb * 0.12 + texture(uBloomQuarter, vUv).rgb * 0.16;
    vec3 c = scene + bloom * uBloom;
    c += vec3(0.0012, 0.0022, 0.0045);            // 极微弱的夜空底色
    c = aces(c);
    c = pow(c, vec3(1.0 / 2.2));

    vec2 q = vUv - 0.5;
    c *= 1.0 - 0.42 * dot(q, q) * 2.2;            // 暗角

    float n = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) / 255.0;                       // 抖动，消除色带
    outColor = vec4(c, 1.0);
  }`;

  HYG.Shaders = { sceneVS, sceneFS, quadVS, brightFS, blurFS, copyFS, compositeFS };
})(window.HYG = window.HYG || {});
