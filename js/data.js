/**
 * 星表数据层
 * 二进制布局（每颗 16 字节，按视星等由亮到暗排序）：
 *   float32 x, y, z (pc)  |  int16 mag ×100  |  int16 (B−V) ×1000
 * 坐标系：赤道直角坐标 → 世界坐标（Y 轴指向北天极）
 */
(function (HYG) {
  "use strict";

  const RECORD_SIZE = 16;

  function decode(payload) {
    const raw = atob(payload.b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const dv = new DataView(bytes.buffer);

    const count = (bytes.length / RECORD_SIZE) | 0;
    const positions = new Float32Array(count * 3);
    const mags = new Float32Array(count);
    const ci = new Float32Array(count);
    const colors = new Uint8Array(count * 3);

    for (let i = 0; i < count; i++) {
      const o = i * RECORD_SIZE;
      positions[i * 3] = dv.getFloat32(o, true);
      positions[i * 3 + 1] = dv.getFloat32(o + 4, true);
      positions[i * 3 + 2] = dv.getFloat32(o + 8, true);
      mags[i] = dv.getInt16(o + 12, true) / 100;
      ci[i] = dv.getInt16(o + 14, true) / 1000;

      const c = HYG.Color.colorFromTemp(HYG.Color.tempFromBV(ci[i]));
      colors[i * 3] = (c[0] * 255) | 0;
      colors[i * 3 + 1] = (c[1] * 255) | 0;
      colors[i * 3 + 2] = (c[2] * 255) | 0;
    }

    const meta = new Map();
    for (const m of payload.meta) meta.set(m[0], m);

    return { count, positions, mags, ci, colors, meta };
  }

  /** mags 升序，二分查找 ≤ limit 的恒星数量 */
  function countUpTo(mags, limit) {
    let lo = 0, hi = mags.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (mags[mid] <= limit) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function distance(stars, i) {
    const p = stars.positions;
    return Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }

  HYG.Data = { decode, countUpTo, distance };
})(window.HYG = window.HYG || {});
