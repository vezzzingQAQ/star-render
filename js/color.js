/**
 * 恒星颜色：B−V 色指数 → 有效温度 → 色度 RGB（线性空间）
 *
 * 温度采用 Ballesteros (2012) 经验公式；色表是在真实黑体色基础上
 * 做过「增强」的：冷端（M/K 型）压到明显的红橙，热端（B/O 型）推向饱和蓝，
 * 让肉眼能一眼区分光谱型，而不是几乎全白。
 */
(function (HYG) {
  "use strict";

  // [温度 K, sRGB R, G, B] —— 增强后的色度表
  const RAMP = [
    [1800, 1.00, 0.14, 0.03], [2200, 1.00, 0.28, 0.07], [2600, 1.00, 0.41, 0.13],
    [3000, 1.00, 0.54, 0.22], [3500, 1.00, 0.66, 0.34], [4000, 1.00, 0.75, 0.46],
    [4500, 1.00, 0.83, 0.62], [5000, 1.00, 0.88, 0.75], [5500, 1.00, 0.93, 0.87],
    [6000, 1.00, 0.97, 0.96], [6500, 1.00, 0.98, 1.00], [7000, 0.93, 0.96, 1.00],
    [8000, 0.84, 0.90, 1.00], [9000, 0.77, 0.85, 1.00], [10000, 0.71, 0.80, 1.00],
    [12000, 0.64, 0.75, 1.00], [15000, 0.57, 0.69, 1.00], [20000, 0.51, 0.64, 1.00],
    [30000, 0.45, 0.59, 1.00]
  ];

  function tempFromBV(bv) {
    bv = Math.min(2.2, Math.max(-0.4, bv));
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // 预先把色表转到线性空间，避免逐星重复换算
  const LINEAR_RAMP = RAMP.map(([t, r, g, b]) => [t, srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);

  /** 返回线性 RGB，最大分量归一化到 1（亮度由星等单独决定） */
  function colorFromTemp(T) {
    const n = LINEAR_RAMP.length;
    let lo = LINEAR_RAMP[0], hi = LINEAR_RAMP[n - 1];
    if (T <= LINEAR_RAMP[0][0]) hi = LINEAR_RAMP[0];
    else if (T >= LINEAR_RAMP[n - 1][0]) lo = LINEAR_RAMP[n - 1];
    else {
      for (let i = 0; i < n - 1; i++) {
        if (T >= LINEAR_RAMP[i][0] && T <= LINEAR_RAMP[i + 1][0]) {
          lo = LINEAR_RAMP[i];
          hi = LINEAR_RAMP[i + 1];
          break;
        }
      }
    }
    const t = lo === hi ? 0 : (T - lo[0]) / (hi[0] - lo[0]);
    const r = lo[1] + (hi[1] - lo[1]) * t;
    const g = lo[2] + (hi[2] - lo[2]) * t;
    const b = lo[3] + (hi[3] - lo[3]) * t;
    const m = Math.max(r, g, b) || 1;
    return [r / m, g / m, b / m];
  }

  HYG.Color = { tempFromBV, colorFromTemp, srgbToLinear };
})(window.HYG = window.HYG || {});
