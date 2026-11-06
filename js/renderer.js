/**
 * WebGL2 渲染器
 *  - 场景：实例化二十面体球体（每颗恒星一个实例），加法混合
 *  - 后期：亮度提取 → 两级高斯泛光 → ACES 色调映射合成
 */
(function (HYG) {
  "use strict";

  function icosphere(detail) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
      [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
    ].map((p) => {
      const l = Math.hypot(p[0], p[1], p[2]);
      return [p[0] / l, p[1] / l, p[2] / l];
    });

    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
      [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
      [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];

    for (let d = 0; d < detail; d++) {
      const cache = new Map();
      const next = [];
      const midpoint = (a, b) => {
        const key = a < b ? a + "_" + b : b + "_" + a;
        if (cache.has(key)) return cache.get(key);
        const p = verts[a], q = verts[b];
        const x = p[0] + q[0], y = p[1] + q[1], z = p[2] + q[2];
        const l = Math.hypot(x, y, z);
        verts.push([x / l, y / l, z / l]);
        cache.set(key, verts.length - 1);
        return verts.length - 1;
      };
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }

    const out = new Float32Array(faces.length * 9);
    let k = 0;
    for (const [a, b, c] of faces) {
      out.set(verts[a], k); k += 3;
      out.set(verts[b], k); k += 3;
      out.set(verts[c], k); k += 3;
    }
    return out;
  }

  const SPHERE_DETAIL = 1; // 80 面

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl2", {
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false
      });
      if (!this.gl) throw new Error("WebGL2 unavailable");

      const gl = this.gl;
      this.hdr = !!gl.getExtension("EXT_color_buffer_float");
      this.colorFormat = this.hdr ? gl.RGBA16F : gl.RGBA8;
      this.colorType = this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

      this.width = 1;
      this.height = 1;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.targets = null;
      this.stars = null;

      this._initPrograms();
      this._initGeometry();
      this._initQuad();
      this.resize();
    }

    /* ---------------- 着色器 ---------------- */
    _compile(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
      }
      return sh;
    }

    _program(vsSrc, fsSrc) {
      const gl = this.gl;
      const p = gl.createProgram();
      gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p) || "program link failed");
      }
      return p;
    }

    _initPrograms() {
      const gl = this.gl;
      const S = HYG.Shaders;

      this.sceneProg = this._program(S.sceneVS, S.sceneFS);
      this.sceneUniform = {};
      for (const n of ["uView", "uProj", "uPixScale", "uRadius", "uSizeMag", "uMinPx", "uMaxPx", "uExposure"]) {
        this.sceneUniform[n] = gl.getUniformLocation(this.sceneProg, n);
      }

      this.brightProg = this._program(S.quadVS, S.brightFS);
      this.brightUniform = {
        tex: gl.getUniformLocation(this.brightProg, "uTex"),
        texel: gl.getUniformLocation(this.brightProg, "uTexel"),
        threshold: gl.getUniformLocation(this.brightProg, "uThreshold")
      };

      this.blurProg = this._program(S.quadVS, S.blurFS);
      this.blurUniform = {
        tex: gl.getUniformLocation(this.blurProg, "uTex"),
        dir: gl.getUniformLocation(this.blurProg, "uDir")
      };

      this.copyProg = this._program(S.quadVS, S.copyFS);
      this.copyUniform = {
        tex: gl.getUniformLocation(this.copyProg, "uTex"),
        texel: gl.getUniformLocation(this.copyProg, "uTexel")
      };

      this.compositeProg = this._program(S.quadVS, S.compositeFS);
      this.compositeUniform = {
        scene: gl.getUniformLocation(this.compositeProg, "uScene"),
        half: gl.getUniformLocation(this.compositeProg, "uBloomHalf"),
        quarter: gl.getUniformLocation(this.compositeProg, "uBloomQuarter"),
        bloom: gl.getUniformLocation(this.compositeProg, "uBloom"),
        res: gl.getUniformLocation(this.compositeProg, "uRes")
      };
    }

    /* ---------------- 几何与实例缓冲 ---------------- */
    _initGeometry() {
      const gl = this.gl;
      const data = icosphere(SPHERE_DETAIL);
      this.sphereVertices = data.length / 3;

      this.sphereVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereVBO);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereVBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }

    _initQuad() {
      this.quadVAO = this.gl.createVertexArray();
    }

    setStars(stars) {
      const gl = this.gl;
      this.stars = stars;
      this.count = stars.count;

      if (this.posBuf) gl.deleteBuffer(this.posBuf);
      if (this.colorBuf) gl.deleteBuffer(this.colorBuf);
      if (this.magBuf) gl.deleteBuffer(this.magBuf);

      this.posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, stars.positions, gl.STATIC_DRAW);

      this.colorBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, stars.colors, gl.STATIC_DRAW);

      const magI = new Int16Array(this.count);
      for (let i = 0; i < this.count; i++) magI[i] = Math.round(stars.mags[i] * 100);
      this.magBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.magBuf);
      gl.bufferData(gl.ARRAY_BUFFER, magI, gl.STATIC_DRAW);

      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.magBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.SHORT, false, 0, 0);
      gl.vertexAttribDivisor(3, 1);
      gl.bindVertexArray(null);
    }

    /* ---------------- 渲染目标 ---------------- */
    _makeTarget(w, h) {
      const gl = this.gl;
      w = Math.max(1, w); h = Math.max(1, h);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.colorFormat, w, h, 0, gl.RGBA, this.colorType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo, w, h };
    }

    _freeTargets() {
      if (!this.targets) return;
      const gl = this.gl;
      for (const key in this.targets) {
        const t = this.targets[key];
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      this.targets = null;
    }

    _buildTargets() {
      const W = this.width, H = this.height;
      this.targets = {
        scene: this._makeTarget(W, H),
        half: this._makeTarget(W >> 1, H >> 1),
        halfTmp: this._makeTarget(W >> 1, H >> 1),
        quarter: this._makeTarget(W >> 2, H >> 2),
        quarterTmp: this._makeTarget(W >> 2, H >> 2)
      };
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
      if (w === this.width && h === this.height && this.targets) return false;
      this.dpr = dpr;
      this.width = w;
      this.height = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this._buildTargets();
      return true;
    }

    _drawQuad() {
      const gl = this.gl;
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* ---------------- 主渲染 ---------------- */
    render(camera, params) {
      this.resize();
      const gl = this.gl;
      const T = this.targets;

      camera.updateMatrices(this.width / this.height);
      const pixScale = (this.height / 2) / Math.tan(camera.fov / 2);

      // --- 场景 ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      gl.useProgram(this.sceneProg);
      gl.uniformMatrix4fv(this.sceneUniform.uView, false, camera.view);
      gl.uniformMatrix4fv(this.sceneUniform.uProj, false, camera.proj);
      gl.uniform1f(this.sceneUniform.uPixScale, pixScale);
      gl.uniform1f(this.sceneUniform.uRadius, 0.045);
      gl.uniform1f(this.sceneUniform.uSizeMag, 5.0 * this.dpr);
      gl.uniform1f(this.sceneUniform.uMinPx, 0.9 * this.dpr);
      gl.uniform1f(this.sceneUniform.uMaxPx, 17 * this.dpr);
      gl.uniform1f(this.sceneUniform.uExposure, params.exposure);

      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.sphereVertices, params.visible);
      gl.disable(gl.BLEND);

      // --- 泛光 ---
      gl.bindVertexArray(this.quadVAO);

      gl.bindFramebuffer(gl.FRAMEBUFFER, T.half.fbo);
      gl.viewport(0, 0, T.half.w, T.half.h);
      gl.useProgram(this.brightProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T.scene.tex);
      gl.uniform1i(this.brightUniform.tex, 0);
      gl.uniform2f(this.brightUniform.texel, 1 / this.width, 1 / this.height);
      gl.uniform1f(this.brightUniform.threshold, 0.9);
      this._drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, T.halfTmp.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.blurProg);
      gl.bindTexture(gl.TEXTURE_2D, T.half.tex);
      gl.uniform1i(this.blurUniform.tex, 0);
      gl.uniform2f(this.blurUniform.dir, 1 / T.half.w, 0);
      this._drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, T.half.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, T.halfTmp.tex);
      gl.uniform2f(this.blurUniform.dir, 0, 1 / T.half.h);
      this._drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, T.quarter.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.copyProg);
      gl.bindTexture(gl.TEXTURE_2D, T.half.tex);
      gl.uniform1i(this.copyUniform.tex, 0);
      gl.uniform2f(this.copyUniform.texel, 1 / T.half.w, 1 / T.half.h);
      this._drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, T.quarterTmp.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.blurProg);
      gl.bindTexture(gl.TEXTURE_2D, T.quarter.tex);
      gl.uniform1i(this.blurUniform.tex, 0);
      gl.uniform2f(this.blurUniform.dir, 1 / T.quarter.w, 0);
      this._drawQuad();

      gl.bindFramebuffer(gl.FRAMEBUFFER, T.quarter.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, T.quarterTmp.tex);
      gl.uniform2f(this.blurUniform.dir, 0, 1 / T.quarter.h);
      this._drawQuad();

      // --- 合成 ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.compositeProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T.scene.tex);
      gl.uniform1i(this.compositeUniform.scene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, T.half.tex);
      gl.uniform1i(this.compositeUniform.half, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, T.quarter.tex);
      gl.uniform1i(this.compositeUniform.quarter, 2);
      gl.uniform1f(this.compositeUniform.bloom, params.bloom);
      gl.uniform2f(this.compositeUniform.res, this.width, this.height);
      this._drawQuad();
      gl.activeTexture(gl.TEXTURE0);
    }

    /** 读取场景 FBO（调试用） */
    probe(x, y, w, h) {
      const gl = this.gl;
      const buf = new Float32Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.scene.fbo);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, buf);
      const err = gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      let max = 0, nan = 0, inf = 0, neg = 0;
      let maxR = 0, maxG = 0, maxB = 0;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          const r = buf[i], g = buf[i + 1], b = buf[i + 2];
          if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
            nan++;
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
            continue;
          }
          if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) inf++;
          if (r < 0 || g < 0 || b < 0) neg++;
          if (r > maxR) maxR = r;
          if (g > maxG) maxG = g;
          if (b > maxB) maxB = b;
          const m = Math.max(r, g, b);
          if (m > max) max = m;
        }
      }
      return {
        max, maxR, maxG, maxB, nan, inf, neg, err,
        box: maxX >= 0 ? [minX + x, minY + y, maxX + x, maxY + y] : null
      };
    }
  }

  HYG.Renderer = Renderer;
})(window.HYG = window.HYG || {});
