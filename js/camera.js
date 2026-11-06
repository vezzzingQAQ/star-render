/**
 * 相机：自由飞行（WASD 平移、Q/E 升降、鼠标拖拽转向、滚轮调速）
 * 同时提供视图/投影矩阵，供渲染与拾取复用。
 */
(function (HYG) {
  "use strict";

  const DEG = Math.PI / 180;

  function perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  }

  function lookAt(out, eye, center, up) {
    let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    let l = Math.hypot(z0, z1, z2) || 1; z0 /= l; z1 /= l; z2 /= l;
    let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
    l = Math.hypot(x0, x1, x2) || 1; x0 /= l; x1 /= l; x2 /= l;
    const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;

    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  }

  function mul(out, a, b) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }

  class Camera {
    constructor() {
      this.pos = [0, 0, 0];
      this.yaw = 0.1093;          // 初始朝向猎户座方向
      this.pitch = -0.0873;
      this.fov = 60 * DEG;
      this.speed = 2;             // pc/s
      this.vel = [0, 0, 0];
      this.keys = new Set();
      this.boost = false;

      this.view = new Float32Array(16);
      this.proj = new Float32Array(16);
      this.vp = new Float32Array(16);
    }

    forward() {
      const cp = Math.cos(this.pitch);
      return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
    }

    right() {
      return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    }

    reset() {
      this.pos[0] = this.pos[1] = this.pos[2] = 0;
      this.vel[0] = this.vel[1] = this.vel[2] = 0;
      this.yaw = 0.1093;
      this.pitch = -0.0873;
      this.speed = 2;
    }

    update(dt) {
      let fwd = 0, strafe = 0, vert = 0;
      if (this.keys.has("KeyW")) fwd += 1;
      if (this.keys.has("KeyS")) fwd -= 1;
      if (this.keys.has("KeyD")) strafe += 1;
      if (this.keys.has("KeyA")) strafe -= 1;
      if (this.keys.has("KeyE") || this.keys.has("Space")) vert += 1;
      if (this.keys.has("KeyQ")) vert -= 1;

      const f = this.forward(), r = this.right();
      const sp = this.speed * (this.boost ? 10 : 1);
      const tx = (f[0] * fwd + r[0] * strafe) * sp;
      const ty = (f[1] * fwd + vert) * sp;
      const tz = (f[2] * fwd + r[2] * strafe) * sp;

      // 平滑加减速
      const k = 1 - Math.pow(0.0015, dt);
      this.vel[0] += (tx - this.vel[0]) * k;
      this.vel[1] += (ty - this.vel[1]) * k;
      this.vel[2] += (tz - this.vel[2]) * k;
      this.pos[0] += this.vel[0] * dt;
      this.pos[1] += this.vel[1] * dt;
      this.pos[2] += this.vel[2] * dt;
    }

    updateMatrices(aspect) {
      const f = this.forward();
      lookAt(this.view, this.pos, [this.pos[0] + f[0], this.pos[1] + f[1], this.pos[2] + f[2]], [0, 1, 0]);
      perspective(this.proj, this.fov, aspect, 0.02, 4000);
      mul(this.vp, this.proj, this.view);
    }

    /** 世界坐标 → 屏幕像素（CSS px），不可见时返回 false */
    project(x, y, z, width, height, out) {
      const m = this.vp;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 1e-4) return false;
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      if (cx < -1.1 || cx > 1.1 || cy < -1.1 || cy > 1.1) return false;
      out.x = (cx * 0.5 + 0.5) * width;
      out.y = (1 - (cy * 0.5 + 0.5)) * height;
      return true;
    }

    bindInput(canvas, hooks) {
      hooks = hooks || {};
      let dragging = false, moved = 0, lastX = 0, lastY = 0;

      window.addEventListener("keydown", (e) => {
        if (e.code === "Space") e.preventDefault();
        this.keys.add(e.code);
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.boost = true;
        if (e.code === "KeyR" && hooks.onReset) hooks.onReset();
        if (e.code === "Escape" && hooks.onEscape) hooks.onEscape();
      });
      window.addEventListener("keyup", (e) => {
        this.keys.delete(e.code);
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.boost = false;
      });
      window.addEventListener("blur", () => {
        this.keys.clear();
        this.boost = false;
      });

      canvas.addEventListener("pointerdown", (e) => {
        dragging = true;
        moved = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.classList.add("dragging");
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        this.yaw += dx * 0.0024;
        this.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, this.pitch - dy * 0.0024));
      });
      canvas.addEventListener("pointerup", (e) => {
        dragging = false;
        canvas.classList.remove("dragging");
        if (moved < 5 && hooks.onClick) hooks.onClick(e.clientX, e.clientY);
      });
      canvas.addEventListener("pointercancel", () => {
        dragging = false;
        canvas.classList.remove("dragging");
      });
      canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.speed = Math.min(400, Math.max(0.15, this.speed * Math.exp(-e.deltaY * 0.0012)));
        if (hooks.onSpeedChange) hooks.onSpeedChange();
      }, { passive: false });
    }
  }

  HYG.Camera = Camera;
  HYG.Mat4 = { perspective, lookAt, mul };
})(window.HYG = window.HYG || {});
