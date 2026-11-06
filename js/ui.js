/**
 * UI 层：HUD 读数、光学参数滑杆、选中恒星信息卡与标记
 */
(function (HYG) {
  "use strict";

  const GREEK = {
    Alp: "α", Bet: "β", Gam: "γ", Del: "δ", Eps: "ε", Zet: "ζ", Eta: "η", The: "θ",
    Iot: "ι", Kap: "κ", Lam: "λ", Mu: "μ", Nu: "ν", Xi: "ξ", Omi: "ο", Pi: "π",
    Rho: "ρ", Sig: "σ", Tau: "τ", Ups: "υ", Phi: "φ", Chi: "χ", Psi: "ψ", Ome: "ω"
  };

  /** 拜耳/弗兰斯蒂德编号 → 可读名称 */
  function designation(meta) {
    if (meta[1]) return meta[1];
    const parts = [];
    if (meta[4]) parts.push(GREEK[meta[4]] || meta[4]);
    if (meta[5]) parts.push(meta[5]);
    if (meta[3]) parts.push(meta[3]);
    if (parts.length) return parts.join(" ");
    if (meta[6]) return "HIP " + meta[6];
    return "未命名恒星";
  }

  function formatRA(deg) {
    let h = deg / 15;
    if (h < 0) h += 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return hh + "h " + String(mm).padStart(2, "0") + "m";
  }

  class UI {
    constructor(hooks) {
      this.hooks = hooks || {};
      this.el = {};
      for (const id of [
        "cnt", "hud-dist", "hud-pos", "hud-speed", "hud-count", "hud-fps",
        "val-exposure", "range-exposure", "val-limit", "range-limit",
        "val-bloom", "range-bloom", "card", "card-name", "card-des",
        "card-mag", "card-absmag", "card-dist", "card-spec", "card-temp",
        "card-radec", "card-close", "marker", "boot"
      ]) {
        this.el[id] = document.getElementById(id);
      }

      for (const key of ["exposure", "limit", "bloom"]) {
        this.el["range-" + key].addEventListener("input", () => this._emitOptics());
      }
      this.el["card-close"].addEventListener("click", () => {
        if (this.hooks.onClose) this.hooks.onClose();
      });
    }

    _emitOptics() {
      const values = this.readOptics();
      this.el["val-exposure"].textContent = values.exposure.toFixed(1) + "×";
      this.el["val-limit"].textContent = values.maxMag.toFixed(1);
      this.el["val-bloom"].textContent = values.bloom.toFixed(2);
      if (this.hooks.onOptics) this.hooks.onOptics(values);
    }

    readOptics() {
      return {
        exposure: parseFloat(this.el["range-exposure"].value),
        maxMag: parseFloat(this.el["range-limit"].value),
        bloom: parseFloat(this.el["range-bloom"].value)
      };
    }

    setTotal(n) {
      this.el.cnt.textContent = n.toLocaleString("en-US");
    }

    setVisible(n) {
      this.el["hud-count"].textContent = n.toLocaleString("en-US");
    }

    setSpeed(pcPerSec) {
      this.el["hud-speed"].textContent =
        (pcPerSec < 1 ? pcPerSec.toFixed(2) : pcPerSec.toFixed(1)) + " pc/s";
    }

    setHud(info) {
      this.el["hud-dist"].textContent = info.distLy.toFixed(info.distLy < 10 ? 2 : 1) + " ly";
      this.el["hud-pos"].textContent = info.pos;
      this.el["hud-fps"].textContent = info.fps.toFixed(0) + " fps";
    }

    showStar(info) {
      this.el["card-name"].innerHTML =
        '<span class="swatch" style="background:' + info.color + ";color:" + info.color + '"></span>' +
        HYG.Utils.escape(info.name);
      this.el["card-des"].textContent = info.designation;
      this.el["card-mag"].textContent = info.mag;
      this.el["card-absmag"].textContent = info.absmag;
      this.el["card-dist"].textContent = info.dist;
      this.el["card-spec"].textContent = info.spec;
      this.el["card-temp"].textContent = info.temp;
      this.el["card-radec"].textContent = info.radec;
      this.el.card.hidden = false;
      this.el.marker.hidden = false;
    }

    hideStar() {
      this.el.card.hidden = true;
      this.el.marker.hidden = true;
    }

    setMarker(x, y) {
      this.el.marker.style.transform = "translate(" + x + "px," + y + "px)";
      this.el.marker.hidden = false;
    }

    hideMarker() {
      this.el.marker.hidden = true;
    }

    ready() {
      const boot = this.el.boot;
      if (!boot) return;
      boot.classList.add("gone");
      setTimeout(() => boot.remove(), 900);
    }

    fail(message) {
      const boot = this.el.boot;
      if (boot) boot.innerHTML = '<div class="b"><div class="t">' + HYG.Utils.escape(message) + "</div></div>";
    }
  }

  HYG.UI = UI;
  HYG.Utils = {
    designation,
    formatRA,
    escape(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    }
  };
})(window.HYG = window.HYG || {});
