/**
 * 恒星颜色：B−V 色指数 → 有效温度 → 黑体 RGB（线性空间）
 * 温度采用 Ballesteros (2012) 经验公式，颜色查表自 Vendian 黑体色表。
 */
(function (HYG) {
  "use strict";

  const BLACKBODY = [
    [1800, 1.000, 0.320, 0.010], [2200, 1.000, 0.576, 0.078], [2600, 1.000, 0.702, 0.226],
    [3000, 1.000, 0.784, 0.400], [3500, 1.000, 0.831, 0.512], [4000, 1.000, 0.880, 0.651],
    [4500, 1.000, 0.910, 0.733], [5000, 1.000, 0.937, 0.808], [5500, 1.000, 0.949, 0.855],
    [6000, 1.000, 0.961, 0.890], [6500, 1.000, 0.969, 0.914], [7000, 1.000, 0.976, 0.937],
    [8000, 1.000, 0.984, 0.965], [9000, 1.000, 0.990, 0.984], [10000, 1.000, 0.996, 1.000],
    [11000, 0.992, 0.996, 1.000], [12000, 0.980, 0.992, 1.000], [15000, 0.953, 0.980, 1.000],
    [20000, 0.914, 0.961, 1.000], [25000, 0.878, 0.941, 1.000], [30000, 0.847, 0.925, 1.000]
  ];

  function tempFromBV(bv) {
    bv = Math.min(2.2, Math.max(-0.4, bv));
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /** 返回线性 RGB，最大分量归一化到 1（亮度由星等单独决定） */
  function colorFromTemp(T) {
    let lo = BLACKBODY[0], hi = BLACKBODY[BLACKBODY.length - 1];
    if (T <= BLACKBODY[0][0]) hi = BLACKBODY[0];
    else if (T >= BLACKBODY[BLACKBODY.length - 1][0]) lo = BLACKBODY[BLACKBODY.length - 1];
    else {
      for (let i = 0; i < BLACKBODY.length - 1; i++) {
        if (T >= BLACKBODY[i][0] && T <= BLACKBODY[i + 1][0]) {
          lo = BLACKBODY[i];
          hi = BLACKBODY[i + 1];
          break;
        }
      }
    }
    const t = lo === hi ? 0 : (T - lo[0]) / (hi[0] - lo[0]);
    const r = srgbToLinear(lo[1] + (hi[1] - lo[1]) * t);
    const g = srgbToLinear(lo[2] + (hi[2] - lo[2]) * t);
    const b = srgbToLinear(lo[3] + (hi[3] - lo[3]) * t);
    const m = Math.max(r, g, b) || 1;
    return [r / m, g / m, b / m];
  }

  HYG.Color = { tempFromBV, colorFromTemp, srgbToLinear };
})(window.HYG = window.HYG || {});
