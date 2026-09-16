(function () {
  "use strict";

  var data = window.__BRAND__ || {};
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.from((scope || document).querySelectorAll(sel)); };
  var escHTML = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function safe(fn, name) { try { return fn(); } catch (e) { console.warn("[" + name + "]", e); } }

  // ===========================================================
  // 1. STATE
  // ===========================================================
  var state = {
    mode: "text",
    text: "miweb.com",
    ssid: "", pass: "", wpa: true,
    style: "clasico",
    colorDots: "#1b1b22",
    colorBg: "#f2f1ec",
    logoDataUrl: null,
    logoIsEmoji: false,
    format3d: "soporte",
    color3dBase: "#f2f1ec",
    color3dCode: "#1b1b22",
    label3d: "",
    size3dMM: 80
  };

  var STYLES = {
    clasico:    { dots: "square",         corners: "square",        cornerDot: "square" },
    redondeado: { dots: "rounded",        corners: "extra-rounded", cornerDot: "dot" },
    puntos:     { dots: "dots",           corners: "dot",           cornerDot: "dot" },
    elegante:   { dots: "classy-rounded", corners: "extra-rounded", cornerDot: "square" }
  };

  // ===========================================================
  // 2. PAYLOAD BUILDERS
  // ===========================================================
  function escWifi(s) { return String(s || "").replace(/([\\;,:"])/g, "\\$1"); }

  function normalizeLink(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;      // already has a scheme
    if (/\s/.test(s)) return s;                          // plain text, leave as-is
    if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(s)) return "https://" + s;
    return s;
  }

  function buildPayload() {
    if (state.mode === "wifi") {
      var t = state.wpa ? "WPA" : "nopass";
      return "WIFI:T:" + t + ";S:" + escWifi(state.ssid) + ";P:" + (state.wpa ? escWifi(state.pass) : "") + ";;";
    }
    return normalizeLink(state.text) || " ";
  }

  // ===========================================================
  // 3. QR 2D — live preview + downloads
  // ===========================================================
  var qrPreview = null;
  var renderTimer = null;
  var renderGen = 0;

  function qrOptions(px, type) {
    var preset = STYLES[state.style];
    var opts = {
      width: px, height: px, type: type || "canvas",
      data: buildPayload(),
      margin: 8,
      qrOptions: { errorCorrectionLevel: state.logoDataUrl ? "H" : "M" },
      dotsOptions: { type: preset.dots, color: state.colorDots },
      cornersSquareOptions: { type: preset.corners, color: state.colorDots },
      cornersDotOptions: { type: preset.cornerDot, color: state.colorDots },
      backgroundOptions: { color: state.colorBg }
    };
    if (state.logoDataUrl) {
      opts.image = state.logoDataUrl;
      opts.imageOptions = { crossOrigin: "anonymous", margin: 4, imageSize: 0.4, hideBackgroundDots: true };
    }
    return opts;
  }

  function ensureQrPreview() {
    if (qrPreview) return qrPreview;
    qrPreview = new QRCodeStyling(qrOptions(320, "canvas"));
    var mount = $("#qr-canvas");
    mount.innerHTML = "";
    qrPreview.append(mount);
    return qrPreview;
  }

  function slugFromPayload() {
    var p = buildPayload().replace(/^https?:\/\//, "").replace(/^WIFI:.*$/, "wifi");
    var slug = p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return slug || "codigo";
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function initDownloads2d() {
    var pngBtn = $("#dl-png"), svgBtn = $("#dl-svg");
    if (pngBtn) pngBtn.addEventListener("click", function () {
      safe(async function () {
        var inst = new QRCodeStyling(qrOptions(1024, "canvas"));
        var blob = await inst.getRawData("png");
        downloadBlob(blob, "qr-" + slugFromPayload() + ".png");
      }, "dl-png");
    });
    if (svgBtn) svgBtn.addEventListener("click", function () {
      safe(async function () {
        var inst = new QRCodeStyling(qrOptions(1024, "svg"));
        var blob = await inst.getRawData("svg");
        downloadBlob(blob, "qr-" + slugFromPayload() + ".svg");
      }, "dl-svg");
    });
  }

  // ===========================================================
  // 4. Matrix + styled B/W mask (source of truth for the 3D relief)
  // ===========================================================
  function getMatrix(inst) {
    try {
      var core = inst._qr || (inst._svgDrawingPromise, null);
      if (!core && inst._qr === undefined) return null;
      core = inst._qr;
      var n = core.getModuleCount();
      if (!n) return null;
      var bits = new Uint8Array(n * n);
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) bits[r * n + c] = core.isDark(r, c) ? 1 : 0;
      }
      return { n: n, isDark: function (r, c) { return bits[r * n + c] === 1; } };
    } catch (e) { return null; }
  }

  var MASK_PX = 12; // px per module in the styled raster mask

  async function buildStyledMask(n, silhouetteDataUrl) {
    var px = n * MASK_PX;
    var preset = STYLES[state.style];
    var opts = {
      width: px, height: px, type: "canvas",
      data: buildPayload(), margin: 0,
      qrOptions: { errorCorrectionLevel: (state.logoDataUrl ? "H" : "M") },
      dotsOptions: { type: preset.dots, color: "#000000" },
      cornersSquareOptions: { type: preset.corners, color: "#000000" },
      cornersDotOptions: { type: preset.cornerDot, color: "#000000" },
      backgroundOptions: { color: "#ffffff" }
    };
    if (silhouetteDataUrl) {
      opts.image = silhouetteDataUrl;
      opts.imageOptions = { crossOrigin: "anonymous", margin: 4, imageSize: 0.4, hideBackgroundDots: true };
    }
    var inst = new QRCodeStyling(opts);
    var blob = await inst.getRawData("png");
    var bitmap = await createImageBitmap(blob);
    var canvas = document.createElement("canvas");
    canvas.width = px; canvas.height = px;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, px, px);
    var img = ctx.getImageData(0, 0, px, px).data;
    var on = new Uint8Array(px * px);
    for (var i = 0; i < px * px; i++) {
      var o = i * 4;
      var lum = 0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2];
      on[i] = lum < 128 ? 1 : 0;
    }
    return { px: px, on: on };
  }

  // ===========================================================
  // 5. Silhouette for the center logo/emoji (single-color mask)
  // ===========================================================
  function rasterizeEmoji(emoji, size) {
    var c = document.createElement("canvas");
    c.width = size; c.height = size;
    var ctx = c.getContext("2d");
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = Math.round(size * 0.82) + "px sans-serif";
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
    return c.toDataURL("image/png");
  }

  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function silhouetteFromDataUrl(dataUrl) {
    var img = await loadImageEl(dataUrl);
    var size = 128;
    var c = document.createElement("canvas");
    c.width = size; c.height = size;
    var ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    var px = ctx.getImageData(0, 0, size, size).data;
    var transparentCount = 0;
    for (var i = 3; i < px.length; i += 4) if (px[i] < 200) transparentCount++;
    var hasAlpha = transparentCount / (px.length / 4) > 0.04;

    var out = ctx.createImageData(size, size);
    for (var p = 0; p < size * size; p++) {
      var o = p * 4;
      var on;
      if (hasAlpha) on = px[o + 3] >= 200;
      else {
        var lum = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
        on = lum < 140;
      }
      var v = on ? 0 : 255;
      out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return c.toDataURL("image/png");
  }

  // ===========================================================
  // 6. Rectangle merge (greedy) — shrinks a boolean grid to few boxes
  // ===========================================================
  function gridRects(on, cols, rows) {
    var used = new Uint8Array(cols * rows), out = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (used[r * cols + c] || !on(r, c)) continue;
        var w = 1;
        while (c + w < cols && !used[r * cols + c + w] && on(r, c + w)) w++;
        var h = 1;
        grow: while (r + h < rows) {
          for (var k = 0; k < w; k++) if (used[(r + h) * cols + c + k] || !on(r + h, c + k)) break grow;
          h++;
        }
        for (var rr = r; rr < r + h; rr++) for (var cc = c; cc < c + w; cc++) used[rr * cols + cc] = 1;
        out.push({ c: c, r: r, w: w, h: h });
      }
    }
    return out;
  }

  // ===========================================================
  // 7. Raw-triangle geometry engine (no three.js dependency)
  // ===========================================================
  function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vnorm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  function makePlane(origin, uAxis, vAxis) {
    uAxis = vnorm(uAxis); vAxis = vnorm(vAxis);
    return { origin: origin, u: uAxis, v: vAxis, n: vnorm(vcross(uAxis, vAxis)) };
  }
  function planePoint(plane, u, v, w) {
    return vadd(plane.origin, vadd(vscale(plane.u, u), vadd(vscale(plane.v, v), vscale(plane.n, w))));
  }

  // A "mesh" is { tris: [ [p0,p1,p2], ... ] } — a plain triangle soup.
  function newMesh() { return { tris: [] }; }
  function pushTri(mesh, a, b, c) { mesh.tris.push([a, b, c]); }

  // Box spanning u:[u0,u1] v:[v0,v1] w:[w0,w1] on an arbitrary plane.
  function addBoxOnPlane(mesh, plane, u0, v0, w0, u1, v1, w1) {
    var P = [
      planePoint(plane, u0, v0, w0), planePoint(plane, u1, v0, w0),
      planePoint(plane, u1, v1, w0), planePoint(plane, u0, v1, w0),
      planePoint(plane, u0, v0, w1), planePoint(plane, u1, v0, w1),
      planePoint(plane, u1, v1, w1), planePoint(plane, u0, v1, w1)
    ];
    var faces = [
      [1, 2, 6], [1, 6, 5],   // +u
      [3, 0, 4], [3, 4, 7],   // -u
      [2, 3, 7], [2, 7, 6],   // +v
      [0, 1, 5], [0, 5, 4],   // -v
      [4, 5, 6], [4, 6, 7],   // +w
      [0, 3, 2], [0, 2, 1]    // -w
    ];
    for (var i = 0; i < faces.length; i++) {
      var f = faces[i];
      pushTri(mesh, P[f[0]], P[f[1]], P[f[2]]);
    }
  }

  function mergeMesh(dst, src) { for (var i = 0; i < src.tris.length; i++) dst.tris.push(src.tris[i]); }

  // Flat identity plane helper (llavero / placa / label band)
  var FLAT_PLANE = makePlane([0, 0, 0], [1, 0, 0], [0, 1, 0]);

  // ===========================================================
  // 8. Piece builders — base(format) + relief(qr+label) on the right plane
  // ===========================================================
  var GEOM = {
    plateThickness: { llavero: 3, placa: 3.2, soporteFoot: 3.2, soporteFace: 3 },
    reliefHeight: 1.2,
    sink: 0.15
  };

  function circleOn(cx, cy, r) { return function (row, col) { var dx = col - cx, dy = row - cy; return (dx * dx + dy * dy) <= r * r; }; }

  function buildFlatBaseWithHoles(W, D, thickness, holes) {
    // Rasterize the plate at ~1mm/cell, carve holes, merge rects, extrude to boxes.
    var res = 1.5; // mm per cell
    var cols = Math.max(4, Math.round(W / res));
    var rows = Math.max(4, Math.round(D / res));
    var sx = W / cols, sy = D / rows;
    var holeFns = holes.map(function (h) { return circleOn(h.cx / sx, h.cy / sy, h.r / ((sx + sy) / 2)); });
    function on(row, col) {
      for (var i = 0; i < holeFns.length; i++) if (holeFns[i](row, col)) return false;
      return true;
    }
    var rects = gridRects(on, cols, rows);
    var mesh = newMesh();
    for (var i = 0; i < rects.length; i++) {
      var rc = rects[i];
      var u0 = rc.c * sx, u1 = (rc.c + rc.w) * sx;
      var v0 = rc.r * sy, v1 = (rc.r + rc.h) * sy;
      addBoxOnPlane(mesh, FLAT_PLANE, u0, v0, 0, u1, v1, thickness);
    }
    return mesh;
  }

  function labelRects(text, bandWidthMM, bandHeightMM) {
    if (!text) return { rects: [], sx: 1, sy: 1 };
    var pxPerMM = 6;
    var w = Math.max(8, Math.round(bandWidthMM * pxPerMM));
    var h = Math.max(8, Math.round(bandHeightMM * pxPerMM));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var fontSize = Math.floor(h * 0.72);
    ctx.font = "800 " + fontSize + "px Manrope, sans-serif";
    var t = text.toUpperCase();
    while (ctx.measureText(t).width > w * 0.94 && fontSize > 5) {
      fontSize--; ctx.font = "800 " + fontSize + "px Manrope, sans-serif";
    }
    ctx.fillText(t, w / 2, h / 2 + h * 0.03);
    var img = ctx.getImageData(0, 0, w, h).data;
    var rects = gridRects(function (row, col) {
      var o = (row * w + col) * 4;
      return img[o] < 128;
    }, w, h);
    return { rects: rects, sx: bandWidthMM / w, sy: bandHeightMM / h };
  }

  function addLabelRelief(mesh, plane, text, bandU0, bandV0, bandWidthMM, bandHeightMM, w0, w1) {
    var band = labelRects(text, bandWidthMM, bandHeightMM);
    for (var i = 0; i < band.rects.length; i++) {
      var rc = band.rects[i];
      var u0 = bandU0 + rc.c * band.sx, u1 = bandU0 + (rc.c + rc.w) * band.sx;
      // canvas row 0 is the TOP of the text image; flip to plane-V (V grows upward)
      var vTop = bandV0 + bandHeightMM - rc.r * band.sy;
      var vBot = bandV0 + bandHeightMM - (rc.r + rc.h) * band.sy;
      addBoxOnPlane(mesh, plane, u0, vBot, w0, u1, vTop, w1);
    }
  }

  function addQrRelief(mesh, plane, mask, codeU0, codeV0, codeAreaMM, w0, w1) {
    var scale = codeAreaMM / mask.px;
    var rects = gridRects(function (row, col) { return mask.on[row * mask.px + col] === 1; }, mask.px, mask.px);
    for (var i = 0; i < rects.length; i++) {
      var rc = rects[i];
      var u0 = codeU0 + rc.c * scale, u1 = codeU0 + (rc.c + rc.w) * scale;
      // mask row 0 is the TOP of the image; flip to plane-V (V grows upward)
      var vTop = codeV0 + codeAreaMM - rc.r * scale;
      var vBot = codeV0 + codeAreaMM - (rc.r + rc.h) * scale;
      addBoxOnPlane(mesh, plane, u0, vBot, w0, u1, vTop, w1);
    }
    return rects.length;
  }

  function buildPiece(format, mask, labelText, sizeMM) {
    var W = sizeMM;
    var marginMM = W * 0.09;
    var codeAreaMM = W - marginMM * 2;
    var hasLabel = !!labelText;

    if (format === "llavero" || format === "placa") {
      var thickness = GEOM.plateThickness[format];
      var D = W;
      var holes = format === "llavero"
        ? [{ cx: W / 2, cy: D - 9, r: 4 }]
        : [{ cx: 9, cy: D - 9, r: 3 }, { cx: W - 9, cy: D - 9, r: 3 }];
      var base = buildFlatBaseWithHoles(W, D, thickness, holes);

      var relief = newMesh();
      var labelBandMM = hasLabel ? Math.max(8, marginMM * 1.4) : 0;
      var codeV0 = hasLabel ? labelBandMM : marginMM * 0.6;
      var codeAreaAdj = Math.min(codeAreaMM, D - codeV0 - marginMM * 0.6);
      var codeU0 = (W - codeAreaAdj) / 2;
      addQrRelief(relief, FLAT_PLANE, mask, codeU0, codeV0, codeAreaAdj, thickness - GEOM.sink, thickness + GEOM.reliefHeight);
      if (hasLabel) {
        addLabelRelief(relief, FLAT_PLANE, labelText, marginMM * 0.6, marginMM * 0.15, W - marginMM * 1.2, labelBandMM * 0.62, thickness - GEOM.sink, thickness + GEOM.reliefHeight);
      }
      return { base: base, relief: relief, moduleSizeMM: codeAreaAdj / mask.nModules, footprint: { W: W, D: D } };
    }

    // ---- soporte: flat foot on the table + inclined face rising from its back edge ----
    var A = 38 * Math.PI / 180;
    var footDepth = Math.max(16, W * 0.16);
    var footThickness = GEOM.plateThickness.soporteFoot;
    var overlap = Math.min(footDepth * 0.5, 4);
    var plateThickness = GEOM.plateThickness.soporteFace;
    var slopeLen = W; // square-ish face

    var incPlane = makePlane([0, footDepth - overlap, 0], [1, 0, 0], [0, Math.cos(A), Math.sin(A)]);

    var base = newMesh();
    addBoxOnPlane(base, FLAT_PLANE, 0, 0, 0, W, footDepth, footThickness);
    addBoxOnPlane(base, incPlane, 0, 0, -plateThickness, W, slopeLen, 0);

    var relief = newMesh();
    var labelBandMM2 = hasLabel ? Math.max(8, marginMM * 1.4) : 0;
    var codeV0b = hasLabel ? labelBandMM2 : marginMM * 0.6;
    var codeAreaAdj2 = Math.min(codeAreaMM, slopeLen - codeV0b - marginMM * 0.6);
    var codeU0b = (W - codeAreaAdj2) / 2;
    addQrRelief(relief, incPlane, mask, codeU0b, codeV0b, codeAreaAdj2, -GEOM.sink, GEOM.reliefHeight);
    if (hasLabel) {
      addLabelRelief(relief, incPlane, labelText, marginMM * 0.6, marginMM * 0.15, W - marginMM * 1.2, labelBandMM2 * 0.62, -GEOM.sink, GEOM.reliefHeight);
    }
    return { base: base, relief: relief, moduleSizeMM: codeAreaAdj2 / mask.nModules, footprint: { W: W, D: footDepth + slopeLen * Math.cos(A) } };
  }

  function boundsOf(meshes) {
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    meshes.forEach(function (m) {
      m.tris.forEach(function (t) {
        t.forEach(function (p) {
          for (var i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
        });
      });
    });
    return { min: min, max: max };
  }

  function translateMesh(mesh, off) {
    mesh.tris.forEach(function (t) { for (var i = 0; i < 3; i++) t[i] = vadd(t[i], off); });
  }

  // ===========================================================
  // 9. 3MF writer (hand-built XML, zipped with JSZip) — no three.js needed
  // ===========================================================
  function toHex2(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "#000000");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  }
  function displayColor(hex) {
    var rgb = hexToRgb(hex);
    return "#" + toHex2(rgb[0]) + toHex2(rgb[1]) + toHex2(rgb[2]) + "FF";
  }

  function weldedMesh(mesh) {
    var map = new Map();
    var verts = [];
    var tris = [];
    function keyOf(p) { return Math.round(p[0] * 1000) + "_" + Math.round(p[1] * 1000) + "_" + Math.round(p[2] * 1000); }
    function idx(p) {
      var k = keyOf(p);
      var i = map.get(k);
      if (i === undefined) { i = verts.length; verts.push(p); map.set(k, i); }
      return i;
    }
    mesh.tris.forEach(function (t) {
      var a = idx(t[0]), b = idx(t[1]), c = idx(t[2]);
      if (a === b || b === c || a === c) return; // degenerate
      tris.push([a, b, c]);
    });
    return { verts: verts, tris: tris };
  }

  function meshToModelXml(mesh, objectId, pindex) {
    var w = weldedMesh(mesh);
    var v = w.verts.map(function (p) {
      return '<vertex x="' + p[0].toFixed(4) + '" y="' + p[1].toFixed(4) + '" z="' + p[2].toFixed(4) + '"/>';
    }).join("");
    var t = w.tris.map(function (tr) {
      return '<triangle v1="' + tr[0] + '" v2="' + tr[1] + '" v3="' + tr[2] + '"/>';
    }).join("");
    return '<object id="' + objectId + '" type="model" pid="1" pindex="' + pindex + '"><mesh><vertices>' + v + '</vertices><triangles>' + t + '</triangles></mesh></object>';
  }

  async function build3mf(baseMesh, reliefMesh, baseColorHex, codeColorHex) {
    var bounds = boundsOf([baseMesh, reliefMesh]);
    var off = [-bounds.min[0], -bounds.min[1], -bounds.min[2]];
    translateMesh(baseMesh, off);
    translateMesh(reliefMesh, off);

    var modelXml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<model unit="millimeter" xml:lang="es-ES" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<resources>' +
      '<basematerials id="1">' +
      '<base name="Base" displaycolor="' + displayColor(baseColorHex) + '"/>' +
      '<base name="Codigo" displaycolor="' + displayColor(codeColorHex) + '"/>' +
      '</basematerials>' +
      meshToModelXml(baseMesh, 2, 0) +
      meshToModelXml(reliefMesh, 3, 1) +
      '</resources>' +
      '<build><item objectid="2"/><item objectid="3"/></build>' +
      '</model>';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>' +
      '</Relationships>';

    var zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypes);
    zip.folder("_rels").file(".rels", rels);
    zip.folder("3D").file("3dmodel.model", modelXml);
    return zip.generateAsync({ type: "blob", mimeType: "model/3mf", compression: "DEFLATE" });
  }

  // Self-check used before every export — never ship an unverified file.
  async function verify3mf(blob) {
    var zip = await JSZip.loadAsync(blob);
    var xml = await zip.file("3D/3dmodel.model").async("string");
    var objCount = (xml.match(/<object /g) || []).length;
    var colorCount = (xml.match(/displaycolor="#[0-9A-Fa-f]{8}"/g) || []).length;
    var triCount = (xml.match(/<triangle /g) || []).length;
    if (objCount !== 2 || colorCount !== 2 || triCount === 0) {
      throw new Error("3MF autoverificación fallida: objetos=" + objCount + " colores=" + colorCount + " triángulos=" + triCount);
    }
    return true;
  }

  // ===========================================================
  // 10. Binary STL writer (hand-rolled, no three.js dependency)
  // ===========================================================
  function meshToStlBinary(mesh) {
    var n = mesh.tris.length;
    var buf = new ArrayBuffer(84 + n * 50);
    var dv = new DataView(buf);
    for (var i = 0; i < 80; i++) dv.setUint8(i, 0);
    dv.setUint32(80, n, true);
    var off = 84;
    for (i = 0; i < n; i++) {
      var t = mesh.tris[i];
      var nrm = vnorm(vcross(vsub(t[1], t[0]), vsub(t[2], t[0])));
      dv.setFloat32(off, nrm[0], true); dv.setFloat32(off + 4, nrm[1], true); dv.setFloat32(off + 8, nrm[2], true);
      off += 12;
      for (var k = 0; k < 3; k++) {
        dv.setFloat32(off, t[k][0], true); dv.setFloat32(off + 4, t[k][1], true); dv.setFloat32(off + 8, t[k][2], true);
        off += 12;
      }
      dv.setUint16(off, 0, true); off += 2;
    }
    return new Blob([buf], { type: "model/stl" });
  }

  async function buildStlZip(baseMesh, reliefMesh) {
    var zip = new JSZip();
    zip.file("base.stl", meshToStlBinary(baseMesh));
    zip.file("codigo.stl", meshToStlBinary(reliefMesh));
    zip.file("LEEME.txt",
      "Importa los dos archivos en tu laminadora y colócalos en el mismo sitio (0,0).\r\n" +
      "Asigna un filamento/color distinto a cada pieza: base.stl = color de fondo, codigo.stl = color del código.\r\n" +
      "Si tu impresora es de un solo color, imprime cada pieza por separado en su color y pégalas.\r\n");
    return zip.generateAsync({ type: "blob" });
  }

  // ===========================================================
  // 11. Print-quality warnings
  // ===========================================================
  function relLuminance(hex) {
    var rgb = hexToRgb(hex).map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function contrastRatio(hexA, hexB) {
    var la = relLuminance(hexA) + 0.05, lb = relLuminance(hexB) + 0.05;
    return la > lb ? la / lb : lb / la;
  }

  function renderWarnings(moduleSizeMM, hasLogo) {
    var box = $("#print-warnings");
    if (!box) return;
    var lines = [];
    var ratio = contrastRatio(state.color3dBase, state.color3dCode);
    if (ratio < 3) {
      lines.push({ bad: true, text: "Contraste muy bajo (" + ratio.toFixed(1) + ":1) — el código puede no escanear. Elige una base clara y un código oscuro (o al revés, pero con más diferencia)." });
    } else {
      lines.push({ bad: false, text: "Contraste de color correcto (" + ratio.toFixed(1) + ":1)." });
    }
    var lb = relLuminance(state.color3dCode), lbase = relLuminance(state.color3dBase);
    if (ratio >= 3 && lb > lbase) {
      lines.push({ bad: true, text: "El código queda más claro que el fondo (QR invertido): la mayoría de móviles lo lee igual, pero algunos antiguos fallan." });
    }
    if (moduleSizeMM && isFinite(moduleSizeMM)) {
      if (moduleSizeMM < 1.5) {
        lines.push({ bad: true, text: "Cada módulo mide " + moduleSizeMM.toFixed(2) + " mm (mínimo recomendado 1,5 mm) — la boquilla redondeará los detalles. Agranda la pieza o acorta el enlace." });
      } else {
        lines.push({ bad: false, text: "Tamaño de módulo correcto: " + moduleSizeMM.toFixed(2) + " mm." });
      }
    }
    if (hasLogo) {
      lines.push({ bad: false, text: "Con logo/emoji central la corrección de errores sube a nivel alto — aun así, haz un escaneo de prueba antes de imprimir en serie." });
    }
    box.innerHTML = lines.map(function (l) {
      return '<div class="warning-line ' + (l.bad ? "is-bad" : "is-ok") + '">' + (l.bad ? "⚠️" : "✓") + " " + escHTML(l.text) + "</div>";
    }).join("");
  }

  // ===========================================================
  // 12. three.js live preview (lazy, ESM bridge, WebGL feature-detect)
  // ===========================================================
  var viewer = {
    THREE: null, OrbitControls: null, STLExporter: null,
    scene: null, camera: null, renderer: null, controls: null,
    baseMesh3: null, codeMesh3: null,
    loaded: false, loading: false, supported: null,
    lastFormat: null, isVisible: false, rafRunning: false
  };

  function detectWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }

  function trisToBufferGeometry(THREE, mesh) {
    var positions = new Float32Array(mesh.tris.length * 9);
    var idx = 0;
    mesh.tris.forEach(function (t) {
      t.forEach(function (p) { positions[idx++] = p[0]; positions[idx++] = p[1]; positions[idx++] = p[2]; });
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  async function loadViewerEngine() {
    if (viewer.loaded || viewer.loading) return;
    viewer.loading = true;
    try {
      var THREE = await import("three");
      var ctrlMod = await import("three/addons/controls/OrbitControls.js");
      viewer.THREE = THREE;
      viewer.OrbitControls = ctrlMod.OrbitControls;

      var wrap = $("#viewer-3d-wrap");
      var canvas = $("#viewer-3d");
      viewer.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      viewer.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      viewer.renderer.setSize(wrap.clientWidth || 320, wrap.clientHeight || 320, false);
      viewer.renderer.outputColorSpace = THREE.SRGBColorSpace;

      viewer.scene = new THREE.Scene();
      viewer.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
      viewer.scene.add(new THREE.HemisphereLight(0xffffff, 0x33302a, 1.1));
      var dir = new THREE.DirectionalLight(0xffffff, 1.4);
      dir.position.set(80, 140, 120);
      viewer.scene.add(dir);

      viewer.controls = new viewer.OrbitControls(viewer.camera, viewer.renderer.domElement);
      viewer.controls.enableDamping = true;
      viewer.controls.dampingFactor = 0.08;

      viewer.baseMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
      viewer.codeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });

      viewer.loaded = true;
      startRenderLoop();
    } catch (e) {
      console.warn("[viewer3d]", e);
      viewer.supported = false;
      showViewerError();
    } finally {
      viewer.loading = false;
    }
  }

  function showViewerError() {
    var wrap = $("#viewer-3d-wrap");
    if (!wrap) return;
    wrap.dataset.state = "error";
    var ph = $(".viewer-3d-placeholder", wrap);
    if (ph) ph.textContent = "La vista 3D no está disponible en este navegador. Las descargas PNG/SVG y el archivo 3D siguen funcionando igual.";
  }

  function startRenderLoop() {
    if (viewer.rafRunning) return;
    viewer.rafRunning = true;
    function tick() {
      if (!viewer.rafRunning) return;
      requestAnimationFrame(tick);
      if (document.hidden || !viewer.isVisible || innerHeight === 0) return;
      viewer.controls && viewer.controls.update();
      viewer.renderer && viewer.renderer.render(viewer.scene, viewer.camera);
    }
    requestAnimationFrame(tick);
  }

  function fitCameraTo(footprint) {
    if (!viewer.camera) return;
    var span = Math.max(footprint.W, footprint.D, 40);
    var cx = footprint.W / 2, cy = footprint.D / 2;
    var isFlat = state.format3d !== "soporte";
    if (isFlat) {
      // straight top-down: the relief faces +Z, so "face-on" means looking down -Z
      viewer.camera.up.set(0, 1, 0);
      viewer.camera.position.set(cx, cy, span * 1.85);
    } else {
      viewer.camera.up.set(0, 0, 1);
      viewer.camera.position.set(cx, -span * 1.35, span * 1.45);
    }
    viewer.camera.lookAt(cx, cy, 0);
    viewer.controls.target.set(cx, cy, 0);
    viewer.camera.near = 0.1; viewer.camera.far = span * 20;
    viewer.camera.updateProjectionMatrix();
    viewer.controls.update();
  }

  function resizeViewer() {
    if (!viewer.renderer) return;
    var wrap = $("#viewer-3d-wrap");
    var w = wrap.clientWidth || 320, h = wrap.clientHeight || 320;
    viewer.renderer.setSize(w, h, false);
    viewer.camera.aspect = w / h;
    viewer.camera.updateProjectionMatrix();
  }

  function updateViewerMeshes(piece) {
    if (!viewer.loaded) return;
    var THREE = viewer.THREE;
    if (viewer.baseMesh3) { viewer.scene.remove(viewer.baseMesh3); viewer.baseMesh3.geometry.dispose(); }
    if (viewer.codeMesh3) { viewer.scene.remove(viewer.codeMesh3); viewer.codeMesh3.geometry.dispose(); }
    viewer.baseMaterial.color.set(state.color3dBase);
    viewer.codeMaterial.color.set(state.color3dCode);
    viewer.baseMesh3 = new THREE.Mesh(trisToBufferGeometry(THREE, piece.base), viewer.baseMaterial);
    viewer.codeMesh3 = new THREE.Mesh(trisToBufferGeometry(THREE, piece.relief), viewer.codeMaterial);
    viewer.scene.add(viewer.baseMesh3, viewer.codeMesh3);

    if (viewer.lastFormat !== state.format3d) {
      fitCameraTo(piece.footprint);
      viewer.lastFormat = state.format3d;
    }
    var wrap = $("#viewer-3d-wrap");
    if (wrap) wrap.dataset.state = "ready";
  }

  function observeViewer() {
    var wrap = $("#viewer-3d-wrap");
    if (!wrap || !("IntersectionObserver" in window)) { loadViewerEngine(); viewer.isVisible = true; return; }
    var retries = 0;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        viewer.isVisible = e.isIntersecting;
        if (e.isIntersecting) {
          if (innerHeight === 0) {
            var retry = setInterval(function () {
              retries++;
              if (innerHeight > 0 || retries > 20) { clearInterval(retry); if (innerHeight > 0) kick(); }
            }, 250);
          } else kick();
        }
      });
    }, { rootMargin: "200px", threshold: 0.01 });
    io.observe(wrap);
    function kick() {
      if (!detectWebGL()) { viewer.supported = false; showViewerError(); return; }
      loadViewerEngine().then(function () { safe(rebuild3D, "rebuild3D-onvisible"); });
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && viewer.isVisible && !viewer.loaded && !viewer.loading) kick();
    });
    addEventListener("resize", function () { safe(resizeViewer, "resizeViewer"); });
  }

  // ===========================================================
  // 13. Rebuild pipeline (debounced) — 2D + warnings + 3D + exports wiring
  // ===========================================================
  var lastPiece = null;
  var lastMask = null;

  async function rebuild3D() {
    var gen = ++renderGen;
    var inst = ensureQrPreview();
    inst.update(qrOptions(320, "canvas"));

    var matrix = getMatrix(inst);
    if (!matrix) return;

    var silhouette = state.logoDataUrl ? await safe(function () { return silhouetteFromDataUrl(state.logoDataUrl); }, "silhouette") : null;
    if (gen !== renderGen) return;

    var mask = await buildStyledMask(matrix.n, silhouette || undefined);
    mask.nModules = matrix.n;
    if (gen !== renderGen) return;
    lastMask = mask;

    var piece = buildPiece(state.format3d, mask, state.label3d.trim(), state.size3dMM);
    if (gen !== renderGen) return;
    lastPiece = piece;

    renderWarnings(piece.moduleSizeMM, !!state.logoDataUrl);
    if (viewer.loaded) updateViewerMeshes(piece);
  }

  function scheduleRebuild() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      safe(function () { ensureQrPreview().update(qrOptions(320, "canvas")); }, "qrPreview");
      safe(rebuild3D, "rebuild3D");
    }, 130);
  }

  // ===========================================================
  // 14. Export buttons (3D)
  // ===========================================================
  function cloneMesh(m) { return { tris: m.tris.map(function (t) { return [t[0].slice(), t[1].slice(), t[2].slice()]; }) }; }

  function initDownloads3d() {
    var btn3mf = $("#dl-3mf"), btnStl = $("#dl-stl");
    if (btn3mf) btn3mf.addEventListener("click", function () {
      safe(async function () {
        if (!lastPiece) { await rebuild3D(); }
        if (!lastPiece) return;
        btn3mf.disabled = true;
        try {
          var blob = await build3mf(cloneMesh(lastPiece.base), cloneMesh(lastPiece.relief), state.color3dBase, state.color3dCode);
          await verify3mf(blob);
          downloadBlob(blob, "qr3d-" + slugFromPayload() + "-" + state.format3d + ".3mf");
        } finally { btn3mf.disabled = false; }
      }, "dl-3mf");
    });
    if (btnStl) btnStl.addEventListener("click", function () {
      safe(async function () {
        if (!lastPiece) { await rebuild3D(); }
        if (!lastPiece) return;
        btnStl.disabled = true;
        try {
          var blob = await buildStlZip(cloneMesh(lastPiece.base), cloneMesh(lastPiece.relief));
          downloadBlob(blob, "qr3d-" + slugFromPayload() + "-" + state.format3d + "-stl.zip");
        } finally { btnStl.disabled = false; }
      }, "dl-stl");
    });
  }

  // ===========================================================
  // 15. UI wiring
  // ===========================================================
  function initModeTabs() {
    $$(".mode-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".mode-tab").forEach(function (b) { b.classList.remove("is-active"); b.setAttribute("aria-selected", "false"); });
        btn.classList.add("is-active"); btn.setAttribute("aria-selected", "true");
        state.mode = btn.dataset.mode;
        $$(".field-panel").forEach(function (p) { p.hidden = p.dataset.panel !== state.mode; });
        scheduleRebuild();
      });
    });
  }

  function initTextInputs() {
    var t = $("#input-text"), ssid = $("#input-ssid"), pass = $("#input-pass"), wpa = $("#input-wpa");
    if (t) t.addEventListener("input", function () { state.text = t.value; scheduleRebuild(); });
    if (ssid) ssid.addEventListener("input", function () { state.ssid = ssid.value; scheduleRebuild(); });
    if (pass) pass.addEventListener("input", function () { state.pass = pass.value; scheduleRebuild(); });
    if (wpa) wpa.addEventListener("change", function () { state.wpa = wpa.checked; scheduleRebuild(); });
  }

  function initStylePicker() {
    $$(".style-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".style-opt").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        state.style = btn.dataset.style;
        scheduleRebuild();
      });
    });
  }

  function initColorInputs() {
    var dots = $("#color-dots"), bg = $("#color-bg");
    var base3 = $("#color3d-base"), code3 = $("#color3d-code");
    if (dots) dots.addEventListener("input", function () { state.colorDots = dots.value; scheduleRebuild(); });
    if (bg) bg.addEventListener("input", function () { state.colorBg = bg.value; scheduleRebuild(); });
    if (base3) base3.addEventListener("input", function () {
      state.color3dBase = base3.value;
      renderWarnings(lastPiece && lastPiece.moduleSizeMM, !!state.logoDataUrl);
      if (viewer.loaded && viewer.baseMaterial) viewer.baseMaterial.color.set(state.color3dBase);
    });
    if (code3) code3.addEventListener("input", function () {
      state.color3dCode = code3.value;
      renderWarnings(lastPiece && lastPiece.moduleSizeMM, !!state.logoDataUrl);
      if (viewer.loaded && viewer.codeMaterial) viewer.codeMaterial.color.set(state.color3dCode);
    });
  }

  function initEmojiAndLogo() {
    $$(".emoji-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".emoji-opt").forEach(function (b) { b.classList.remove("is-active"); });
        var emoji = btn.dataset.emoji;
        if (!emoji) { state.logoDataUrl = null; btn.classList.add("is-active"); }
        else { state.logoDataUrl = rasterizeEmoji(emoji, 256); state.logoIsEmoji = true; btn.classList.add("is-active"); }
        scheduleRebuild();
      });
    });
    var upload = $("#logo-upload");
    if (upload) upload.addEventListener("change", function () {
      var file = upload.files && upload.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        state.logoDataUrl = reader.result;
        state.logoIsEmoji = false;
        $$(".emoji-opt").forEach(function (b) { b.classList.remove("is-active"); });
        scheduleRebuild();
      };
      reader.readAsDataURL(file);
    });
  }

  function initFormatPicker() {
    $$(".format-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$(".format-opt").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        state.format3d = btn.dataset.format;
        scheduleRebuild();
      });
    });
  }

  function initLabelAndSize() {
    var label = $("#input-label3d"), size = $("#input-size3d"), sizeOut = $("#size3d-value");
    if (label) label.addEventListener("input", function () { state.label3d = label.value; scheduleRebuild(); });
    if (size) size.addEventListener("input", function () {
      state.size3dMM = parseInt(size.value, 10);
      if (sizeOut) sizeOut.textContent = state.size3dMM + " mm";
      scheduleRebuild();
    });
  }

  function initFooterYear() {
    var y = $("#year");
    if (y) y.textContent = new Date().getFullYear();
  }

  // ===========================================================
  // 16. Boot
  // ===========================================================
  function boot() {
    safe(initModeTabs, "initModeTabs");
    safe(initTextInputs, "initTextInputs");
    safe(initStylePicker, "initStylePicker");
    safe(initColorInputs, "initColorInputs");
    safe(initEmojiAndLogo, "initEmojiAndLogo");
    safe(initFormatPicker, "initFormatPicker");
    safe(initLabelAndSize, "initLabelAndSize");
    safe(initDownloads2d, "initDownloads2d");
    safe(initDownloads3d, "initDownloads3d");
    safe(initFooterYear, "initFooterYear");
    safe(ensureQrPreview, "ensureQrPreview");
    safe(observeViewer, "observeViewer");
    safe(function () { renderWarnings(NaN, false); }, "initWarnings");
    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
