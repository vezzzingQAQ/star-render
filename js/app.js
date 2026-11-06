/**
 * 应用入口：装配数据、渲染器、相机与 UI，驱动主循环与拾取。
 */
(function (HYG) {
  "use strict";

  const canvas = document.getElementById("gl");
  const ui = new HYG.UI({
    onOptics: (values) => applyOptics(values),
    onClose: () => clearSelection()
  });

  if (!window.HYG_STARS) {
    ui.fail("星表数据缺失");
    return;
  }

  let stars;
  try {
    stars = HYG.Data.decode(window.HYG_STARS);
  } catch (err) {
    console.error(err);
    ui.fail("星表数据解析失败");
    return;
  }

  let renderer;
  try {
    renderer = new HYG.Renderer(canvas);
  } catch (err) {
    console.error(err);
    ui.fail("当前浏览器不支持 WebGL2");
    return;
  }

  renderer.setStars(stars);
  ui.setTotal(stars.count);

  const camera = new HYG.Camera();
  const state = { exposure: 8, maxMag: 12, bloom: 1, visible: stars.count };

  function applyOptics(values) {
    state.exposure = values.exposure;
    state.maxMag = values.maxMag;
    state.bloom = values.bloom;
    state.visible = HYG.Data.countUpTo(stars.mags, values.maxMag);
    ui.setVisible(state.visible);
  }

  ui.setVisible(state.visible);
  ui.setSpeed(camera.speed);
  applyOptics(ui.readOptics());

  /* ---------------- 拾取与信息卡 ---------------- */
  let selected = -1;
  const tmp = { x: 0, y: 0 };

  function projectStar(i, out) {
    const p = stars.positions;
    return camera.project(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], canvas.clientWidth, canvas.clientHeight, out);
  }

  function pickStar(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best = -1;
    let bestDist = 16 * 16;

    for (let i = 0; i < state.visible; i++) {
      if (!projectStar(i, tmp)) continue;
      const dx = tmp.x - mx;
      const dy = tmp.y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) {
        bestDist = d2;
        best = i;
      }
    }
    if (best >= 0) selectStar(best);
    else clearSelection();
  }

  function selectStar(i) {
    selected = i;
    const meta = stars.meta.get(i);
    const dist = HYG.Data.distance(stars, i);
    const temp = HYG.Color.tempFromBV(stars.ci[i]);
    const rgb = HYG.Color.colorFromTemp(temp);
    const hex = "#" + rgb.map((v) =>
      Math.round(Math.pow(v, 1 / 2.2) * 255).toString(16).padStart(2, "0")).join("");

    const p = stars.positions;
    const ra = Math.atan2(-p[i * 3 + 2], p[i * 3]) * 180 / Math.PI;
    const dec = Math.asin(p[i * 3 + 1] / Math.max(dist, 1e-6)) * 180 / Math.PI;

    const con = meta && meta[3] ? meta[3] : "";
    let designation = "HYG #" + i;
    if (meta) {
      designation = con ? "星座 " + con : "HYG " + i;
      if (meta[6]) designation += " · HIP " + meta[6];
    }

    ui.showStar({
      color: hex,
      name: meta ? HYG.Utils.designation(meta) : "HIP —",
      designation,
      mag: stars.mags[i].toFixed(2),
      absmag: meta && meta[7] != null ? Number(meta[7]).toFixed(2) : "—",
      dist: (dist * 3.26156).toFixed(dist < 10 ? 2 : 1) + " ly",
      spec: meta && meta[2] ? meta[2] : "—",
      temp: Math.round(temp / 100) * 100 + " K",
      radec: HYG.Utils.formatRA(ra) + " / " + (dec >= 0 ? "+" : "") + dec.toFixed(1) + "°"
    });
  }

  function clearSelection() {
    selected = -1;
    ui.hideStar();
  }

  camera.bindInput(canvas, {
    onReset: () => {
      camera.reset();
      ui.setSpeed(camera.speed);
      clearSelection();
    },
    onEscape: clearSelection,
    onSpeedChange: () => ui.setSpeed(camera.speed),
    onClick: pickStar
  });

  /* ---------------- 主循环 ---------------- */
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0, hudTimer = 0;
  let ready = false;

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    camera.update(dt);
    renderer.render(camera, state);

    if (selected >= 0) {
      if (projectStar(selected, tmp)) ui.setMarker(tmp.x, tmp.y);
      else ui.hideMarker();
    }

    fpsAcc += dt;
    fpsFrames++;
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const d = Math.hypot(camera.pos[0], camera.pos[1], camera.pos[2]);
      ui.setHud({
        distLy: d * 3.26156,
        pos: camera.pos.map((v) => v.toFixed(0)).join(", "),
        fps: fpsFrames / fpsAcc || 0
      });
      fpsAcc = 0;
      fpsFrames = 0;
    }

    if (!ready) {
      ready = true;
      ui.ready();
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  /* ===== 临时调试 ===== */
  if (location.hash === "#debug") {
    setTimeout(() => {
      const gl = renderer.gl;
      const probe = renderer.probe(0, 0, renderer.width, renderer.height);
      const big = [];
      const pixScale = (renderer.height / 2) / Math.tan(camera.fov / 2);
      for (let i = 0; i < stars.count; i++) {
        const d = HYG.Data.distance(stars, i);
        const flux = Math.pow(10, -0.4 * stars.mags[i]);
        const pxMag = 5 * Math.pow(flux, 0.22);
        const pxPersp = 0.045 / d * pixScale;
        const px = Math.min(17, Math.max(0.9, Math.max(pxMag, pxPersp)));
        if (!projectStar(i, tmp)) continue;
        const name = stars.meta.get(i);
        big.push([px, i, +stars.mags[i].toFixed(2), +d.toFixed(2),
          +pxMag.toFixed(1), +pxPersp.toFixed(1),
          Math.round(tmp.x), Math.round(tmp.y),
          name ? (name[1] || name[3]) : ""]);
      }
      big.sort((a, b) => b[0] - a[0]);
      const lines = big.slice(0, 10).map((r) => r.join(" | "));
      const text =
        "canvas " + renderer.width + "x" + renderer.height + " dpr " + renderer.dpr +
        "\nvisible " + state.visible + " of " + stars.count +
        "\nprobe " + JSON.stringify(probe) +
        "\nhdr " + renderer.hdr +
        "\ngpu " + (gl.getExtension("WEBGL_debug_renderer_info") ? gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL) : "?") +
        "\npx | id | mag | dist | pxMag | pxPersp | sx | sy | name\n" + lines.join("\n");
      document.body.innerHTML = '<pre style="margin:0;padding:24px;font:16px/1.7 monospace;color:#8ff;background:#000;height:100%;white-space:pre-wrap">' + text + "</pre>";
    }, 2000);
  }
})(window.HYG = window.HYG || {});
