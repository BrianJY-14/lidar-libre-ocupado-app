const CORRIDOR = { xMin: 0.2, xMax: 4.5, yAbs: 1.5, zMin: -0.8, zMax: 2.0 };
const CRITICAL = { xMin: 0.5, xMax: 2.5, yAbs: 1.3, zMin: -0.6, zMax: 1.5 };
const EPS = 1e-12;

const app = document.querySelector("#app");

const state = {
  model: null,
  stream: null,
  frameIndex: 0,
  playing: false,
  speed: 1,
  timer: null,
  manualResult: null,
  manualCloud: null,
  activeTab: "stream",
};

const featureLabels = {
  sum_eigenvalues: "Suma eigenvalores",
  omnivariance: "Omnivarianza",
  eigenentropy: "Eigenentropia",
  anisotropy: "Anisotropia",
  planarity: "Planaridad",
  linearity: "Linealidad",
  surface_variation: "Var. superficie",
  sphericity: "Esfericidad",
  verticality: "Verticalidad",
  height: "Altura centroide",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  if (Math.abs(value) > 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return Number(value).toFixed(digits);
}

function labelName(label) {
  return Number(label) === 1 ? "ocupado" : "libre";
}

function activeFrame() {
  return state.stream.frames[state.frameIndex] || state.stream.frames[0];
}

async function init() {
  const [model, stream] = await Promise.all([
    fetch("./data/model.json").then((response) => response.json()),
    fetch("./data/demo_stream.json").then((response) => response.json()),
  ]);
  state.model = model;
  state.stream = stream;
  render();
  requestAnimationFrame(drawCurrentCloud);
}

function setPlaying(next) {
  state.playing = next;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (next) {
    const intervalMs = 100 / state.speed;
    state.timer = setInterval(() => {
      state.frameIndex = (state.frameIndex + 1) % state.stream.frames.length;
      updateDynamicFrame();
    }, intervalMs);
  }
  updatePlayButtons();
}

function seek(delta) {
  state.frameIndex = clamp(
    state.frameIndex + delta,
    0,
    state.stream.frames.length - 1,
  );
  updateDynamicFrame();
}

function jump(index) {
  state.frameIndex = clamp(index, 0, state.stream.frames.length - 1);
  updateDynamicFrame();
}

function setTab(tab) {
  state.activeTab = tab;
  render();
  requestAnimationFrame(drawCurrentCloud);
}

function updateDynamicFrame() {
  const frame = activeFrame();
  const status = document.querySelector("#status-panel");
  const metrics = document.querySelector("#metrics-panel");
  const features = document.querySelector("#features-panel");
  const timeline = document.querySelector("#timeline");
  if (status) status.innerHTML = statusPanel(frame);
  if (metrics) metrics.innerHTML = metricsPanel(frame);
  if (features) features.innerHTML = featureGrid(frame.features);
  if (timeline) timeline.value = String(state.frameIndex);
  const frameLabel = document.querySelector("#frame-label");
  if (frameLabel) frameLabel.textContent = `Frame ${state.frameIndex + 1}/${state.stream.frames.length}`;
  drawCurrentCloud();
}

function updatePlayButtons() {
  const play = document.querySelector("#play-button");
  if (play) play.textContent = state.playing ? "Pausar" : "Reproducir";
}

function modelPathFor(features) {
  const featureIndex = state.model.feature[0];
  const featureName = state.model.feature_cols[featureIndex];
  const threshold = state.model.threshold[0];
  const value = features?.[featureName];
  const goesLeft = value <= threshold;
  return {
    featureName,
    threshold,
    value,
    comparison: goesLeft ? "<=" : ">",
    leaf: goesLeft ? "libre" : "ocupado",
  };
}

function predictFromModel(features) {
  let node = 0;
  while (state.model.children_left[node] !== -1) {
    const featureIndex = state.model.feature[node];
    const featureName = state.model.feature_cols[featureIndex];
    node = features[featureName] <= state.model.threshold[node]
      ? state.model.children_left[node]
      : state.model.children_right[node];
  }
  const values = state.model.value[node];
  return values[1] >= values[0] ? 1 : 0;
}

function render() {
  if (!state.model || !state.stream) {
    app.innerHTML = '<div class="boot">Cargando modelo LiDAR...</div>';
    return;
  }

  const frame = activeFrame();
  const manualActive = state.activeTab === "manual";
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">LabIA FIIS / RS-LiDAR-16 / Unitree Go1</p>
        <h1>LiDAR Libre/Ocupado</h1>
      </div>
      <div class="model-chip">
        <span>Decision Tree</span>
        <strong>F1 Macro ${state.model.reference_metrics.f1_macro}</strong>
      </div>
    </header>

    <main class="workspace">
      <section class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">Modulo de despliegue</p>
          <h2>Simulacion diferida con inferencia del modelo real</h2>
          <p>
            Reproduce frames reales ya preprocesados, calcula la decision del arbol
            exportado y aplica la alerta movil 3-de-5 usada en el notebook de despliegue.
          </p>
        </div>
        <div class="hero-stats">
          <div><strong>${state.stream.summary.total_frames}</strong><span>frames</span></div>
          <div><strong>10 Hz</strong><span>frecuencia</span></div>
          <div><strong>R=${state.model.support_radius_m} m</strong><span>soporte</span></div>
        </div>
      </section>

      <nav class="tabs" aria-label="Modos de uso">
        <button class="${manualActive ? "" : "active"}" data-tab="stream">Grabacion diferida</button>
        <button class="${manualActive ? "active" : ""}" data-tab="manual">Probar .npy</button>
      </nav>

      ${manualActive ? manualView() : streamView(frame)}
    </main>
  `;

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  if (manualActive) bindManual();
  else bindStream();

  requestAnimationFrame(drawCurrentCloud);
}

function streamView(frame) {
  return `
    <section class="grid-shell">
      <aside class="side-panel">
        <div id="status-panel">${statusPanel(frame)}</div>
        <div class="controls">
          <button class="primary" id="play-button">${state.playing ? "Pausar" : "Reproducir"}</button>
          <button id="prev-button" title="Frame anterior">-1</button>
          <button id="next-button" title="Frame siguiente">+1</button>
        </div>
        <label class="range-label" for="timeline">
          <span id="frame-label">Frame ${state.frameIndex + 1}/${state.stream.frames.length}</span>
          <span>${state.stream.scene_order.join(" -> ")}</span>
        </label>
        <input id="timeline" type="range" min="0" max="${state.stream.frames.length - 1}" value="${state.frameIndex}" />
        <div id="metrics-panel">${metricsPanel(frame)}</div>
      </aside>

      <section class="main-panel">
        ${cloudPanel("stream-canvas")}
        <div id="features-panel">${featureGrid(frame.features)}</div>
        ${decisionPanel(frame.features)}
      </section>
    </section>
  `;
}

function manualView() {
  const result = state.manualResult;
  return `
    <section class="grid-shell">
      <aside class="side-panel">
        <div class="upload-box" id="drop-zone">
          <input id="file-input" type="file" accept=".npy" />
          <strong>Subir frame .npy</strong>
          <span>Usa archivos de corridor_npy con shape (N, 3), float32.</span>
        </div>
        ${result ? statusPanel(result) : emptyStatus()}
        ${result ? metricsPanel(result) : ""}
      </aside>

      <section class="main-panel">
        ${cloudPanel("manual-canvas")}
        ${result ? `<div id="features-panel">${featureGrid(result.features)}</div>${decisionPanel(result.features)}` : introPanel()}
      </section>
    </section>
  `;
}

function emptyStatus() {
  return `
    <div class="status neutral">
      <p class="eyebrow">Esperando archivo</p>
      <h3>Sin diagnostico</h3>
      <p>El resultado aparecera despues de cargar un frame valido.</p>
    </div>
  `;
}

function introPanel() {
  return `
    <div class="info-panel">
      <h3>Uso previsto</h3>
      <p>
        Esta pantalla permite validar la logica de inferencia sobre frames
        individuales, usando el mismo orden de features guardado en la metadata
        del modelo desplegado.
      </p>
    </div>
  `;
}

function statusPanel(frame) {
  const pred = frame.prediction;
  const verdict = labelName(pred);
  const cls = pred === 1 ? "danger" : "ok";
  const prob = frame.probabilities?.[pred] ?? 1;
  return `
    <div class="status ${cls}">
      <p class="eyebrow">Clasificacion actual</p>
      <h3>${verdict}</h3>
      <div class="confidence">
        <span>Confianza ${fmt(prob * 100, 1)}%</span>
        <i style="width:${clamp(prob * 100, 3, 100)}%"></i>
      </div>
      <p class="status-line">
        Alerta filtrada: <strong>${frame.alert ? "activa" : "inactiva"}</strong>
      </p>
      <p class="status-line">
        Etiqueta real: <strong>${frame.true_label_name ?? labelName(frame.true_label)}</strong>
      </p>
    </div>
  `;
}

function metricsPanel(frame) {
  return `
    <div class="metric-grid">
      <div><strong>${frame.scene || "archivo"}</strong><span>escena</span></div>
      <div><strong>${frame.frame_idx ?? "--"}</strong><span>frame</span></div>
      <div><strong>${frame.n_corridor_points ?? "--"}</strong><span>pts ROI</span></div>
      <div><strong>${fmt(frame.critical_ratio, 4)}</strong><span>ratio critico</span></div>
    </div>
  `;
}

function cloudPanel(canvasId) {
  return `
    <div class="cloud-card">
      <div class="panel-title">
        <span>Vista superior XY</span>
        <small>color = altura Z / rojo = zona critica</small>
      </div>
      <canvas id="${canvasId}" width="980" height="420"></canvas>
    </div>
  `;
}

function featureGrid(features) {
  if (!features) return "";
  return `
    <div class="feature-grid">
      ${state.model.feature_cols.map((key) => featureCard(key, features[key])).join("")}
    </div>
  `;
}

function featureCard(key, value) {
  const ranges = {
    eigenentropy: [0, 1.25],
    surface_variation: [0, 0.45],
    anisotropy: [0, 1],
    planarity: [0, 1],
    linearity: [0, 1],
    sphericity: [0, 1],
    verticality: [0, 1],
    height: [-0.5, 1.8],
    omnivariance: [0, 0.08],
    sum_eigenvalues: [0, 1.5],
  };
  const [min, max] = ranges[key] || [0, 1];
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
  const primary = key === "eigenentropy";
  return `
    <article class="feature-card ${primary ? "primary-feature" : ""}">
      <span>${featureLabels[key] || key}</span>
      <strong>${fmt(value, 5)}</strong>
      <i><b style="width:${pct}%"></b></i>
    </article>
  `;
}

function decisionPanel(features) {
  if (!features) return "";
  const path = modelPathFor(features);
  return `
    <div class="decision-panel">
      <div>
        <p class="eyebrow">Recorrido del arbol real</p>
        <h3>${featureLabels[path.featureName]} ${path.comparison} ${fmt(path.threshold, 6)}</h3>
      </div>
      <p>
        Valor del frame: <strong>${fmt(path.value, 6)}</strong>. La hoja activa
        clasifica el frame como <strong>${path.leaf}</strong>.
      </p>
    </div>
  `;
}

function bindStream() {
  document.querySelector("#play-button").addEventListener("click", () => setPlaying(!state.playing));
  document.querySelector("#prev-button").addEventListener("click", () => seek(-1));
  document.querySelector("#next-button").addEventListener("click", () => seek(1));
  document.querySelector("#timeline").addEventListener("input", (event) => {
    jump(Number(event.target.value));
  });
}

function bindManual() {
  const input = document.querySelector("#file-input");
  const zone = document.querySelector("#drop-zone");
  input.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  });
}

async function handleFile(file) {
  try {
    const parsed = parseNpy(await file.arrayBuffer());
    const points = filterCorridor(parsed.points);
    const features = extractFeatures(points);
    const prediction = predictFromModel(features);
    state.manualCloud = points;
    state.manualResult = {
      scene: file.name,
      frame_idx: 0,
      true_label: prediction,
      true_label_name: "sin etiqueta",
      prediction,
      probabilities: prediction === 1 ? [0, 1] : [1, 0],
      alert: prediction === 1,
      n_corridor_points: points.length,
      n_critical_points: countCritical(points),
      critical_ratio: countCritical(points) / Math.max(points.length, 1),
      features,
    };
    render();
  } catch (error) {
    state.manualResult = {
      scene: file.name,
      frame_idx: 0,
      true_label: 0,
      true_label_name: "error",
      prediction: 1,
      probabilities: [0, 1],
      alert: true,
      n_corridor_points: 0,
      critical_ratio: 0,
      features: null,
    };
    render();
    window.alert(error.message);
  }
}

function parseNpy(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.slice(1, 6)) !== "NUMPY") {
    throw new Error("Archivo .npy invalido.");
  }
  const major = bytes[6];
  const view = new DataView(buffer);
  const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerStart = major === 1 ? 10 : 12;
  const header = new TextDecoder("latin1").decode(bytes.slice(headerStart, headerStart + headerLength));
  if (!header.includes("'descr': '<f4'") && !header.includes('"descr": "<f4"')) {
    throw new Error("El archivo debe ser float32 little-endian.");
  }
  const shape = header.match(/['"]shape['"]:\s*\((\d+),\s*(\d+)\)/);
  if (!shape || Number(shape[2]) !== 3) {
    throw new Error("El archivo debe tener shape (N, 3).");
  }
  const count = Number(shape[1]);
  const offset = headerStart + headerLength;
  const raw = new Float32Array(buffer.slice(offset, offset + count * 3 * 4));
  const points = [];
  for (let i = 0; i < count; i += 1) {
    points.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]);
  }
  return { points };
}

function filterCorridor(points) {
  const filtered = points.filter(([x, y, z]) => (
    x >= CORRIDOR.xMin &&
    x <= CORRIDOR.xMax &&
    Math.abs(y) <= CORRIDOR.yAbs &&
    z >= CORRIDOR.zMin &&
    z <= CORRIDOR.zMax
  ));
  return filtered.length >= 3 ? filtered : points;
}

function countCritical(points) {
  return points.filter(([x, y, z]) => (
    x >= CRITICAL.xMin &&
    x <= CRITICAL.xMax &&
    Math.abs(y) <= CRITICAL.yAbs &&
    z >= CRITICAL.zMin &&
    z <= CRITICAL.zMax
  )).length;
}

function extractFeatures(points) {
  const support = supportSubset(points, state.model.support_radius_m);
  if (support.length < 3) throw new Error("Soporte insuficiente: menos de 3 puntos.");
  const centroid = meanPoint(support);
  const cov = covariance(support, centroid);
  const eig = jacobi3(cov);
  const lam = eig.values.map((value) => Math.max(value, EPS)).sort((a, b) => b - a);
  const [l1, l2, l3] = lam;
  const sum = l1 + l2 + l3;
  const v3 = eig.vectors[eig.order[2]];
  return {
    sum_eigenvalues: sum,
    omnivariance: Math.pow(l1 * l2 * l3, 1 / 3),
    eigenentropy: -(l1 * Math.log(l1) + l2 * Math.log(l2) + l3 * Math.log(l3)),
    anisotropy: (l1 - l3) / l1,
    planarity: (l2 - l3) / l1,
    linearity: (l1 - l2) / l1,
    surface_variation: l3 / sum,
    sphericity: l3 / l1,
    verticality: 1 - Math.abs(v3[2]),
    height: centroid[2],
  };
}

function supportSubset(points, radius) {
  const center = meanPoint(points);
  const r2 = radius * radius;
  return points.filter(([x, y, z]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    const dz = z - center[2];
    return dx * dx + dy * dy + dz * dz <= r2;
  });
}

function meanPoint(points) {
  const total = points.reduce((acc, point) => {
    acc[0] += point[0];
    acc[1] += point[1];
    acc[2] += point[2];
    return acc;
  }, [0, 0, 0]);
  return total.map((value) => value / points.length);
}

function covariance(points, center) {
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [x, y, z] of points) {
    const d = [x - center[0], y - center[1], z - center[2]];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) c[i][j] += d[i] * d[j];
    }
  }
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) c[i][j] /= points.length;
  }
  return c;
}

function jacobi3(matrix) {
  let a = matrix.map((row) => [...row]);
  let vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (let iteration = 0; iteration < 80; iteration += 1) {
    let p = 0;
    let q = 1;
    let max = Math.abs(a[0][1]);
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) {
        const value = Math.abs(a[i][j]);
        if (value > max) {
          max = value;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-14) break;

    const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const sign = tau >= 0 ? 1 : -1;
    const t = sign / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const cos = 1 / Math.sqrt(1 + t * t);
    const sin = t * cos;
    const next = a.map((row) => [...row]);

    next[p][p] = a[p][p] - t * a[p][q];
    next[q][q] = a[q][q] + t * a[p][q];
    next[p][q] = 0;
    next[q][p] = 0;

    for (let r = 0; r < 3; r += 1) {
      if (r !== p && r !== q) {
        next[r][p] = cos * a[r][p] - sin * a[r][q];
        next[p][r] = next[r][p];
        next[r][q] = sin * a[r][p] + cos * a[r][q];
        next[q][r] = next[r][q];
      }
    }
    a = next;

    const nextVectors = vectors.map((row) => [...row]);
    for (let r = 0; r < 3; r += 1) {
      const vp = vectors[r][p];
      const vq = vectors[r][q];
      nextVectors[r][p] = cos * vp - sin * vq;
      nextVectors[r][q] = sin * vp + cos * vq;
    }
    vectors = nextVectors;
  }

  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => Math.max(0, a[i][i])),
    vectors: order.map((i) => [vectors[0][i], vectors[1][i], vectors[2][i]]),
    order: [0, 1, 2],
  };
}

function drawCurrentCloud() {
  const canvas = document.querySelector(state.activeTab === "manual" ? "#manual-canvas" : "#stream-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const frame = state.activeTab === "manual" ? state.manualResult : activeFrame();
  const points = state.activeTab === "manual" ? state.manualCloud : frame?.points;
  drawCloud(ctx, canvas, points || []);
}

function drawCloud(ctx, canvas, points) {
  const width = canvas.width;
  const height = canvas.height;
  const pad = 34;
  const px = (x) => pad + ((x - CORRIDOR.xMin) / (CORRIDOR.xMax - CORRIDOR.xMin)) * (width - pad * 2);
  const py = (y) => height / 2 - (y / CORRIDOR.yAbs) * (height / 2 - pad);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#08111e";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(86, 122, 155, 0.18)";
  ctx.lineWidth = 1;
  for (let x = 0.5; x <= 4.5; x += 0.5) {
    ctx.beginPath();
    ctx.moveTo(px(x), pad);
    ctx.lineTo(px(x), height - pad);
    ctx.stroke();
  }
  for (let y = -1.5; y <= 1.5; y += 0.5) {
    ctx.beginPath();
    ctx.moveTo(pad, py(y));
    ctx.lineTo(width - pad, py(y));
    ctx.stroke();
  }

  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = "rgba(72, 196, 236, 0.7)";
  ctx.strokeRect(px(CORRIDOR.xMin), py(CORRIDOR.yAbs), px(CORRIDOR.xMax) - px(CORRIDOR.xMin), py(-CORRIDOR.yAbs) - py(CORRIDOR.yAbs));
  ctx.strokeStyle = "rgba(255, 87, 87, 0.82)";
  ctx.fillStyle = "rgba(255, 87, 87, 0.08)";
  ctx.fillRect(px(CRITICAL.xMin), py(CRITICAL.yAbs), px(CRITICAL.xMax) - px(CRITICAL.xMin), py(-CRITICAL.yAbs) - py(CRITICAL.yAbs));
  ctx.strokeRect(px(CRITICAL.xMin), py(CRITICAL.yAbs), px(CRITICAL.xMax) - px(CRITICAL.xMin), py(-CRITICAL.yAbs) - py(CRITICAL.yAbs));
  ctx.setLineDash([]);

  for (const [x, y, z] of points) {
    const t = clamp((z - CORRIDOR.zMin) / (CORRIDOR.zMax - CORRIDOR.zMin), 0, 1);
    const hue = 210 - t * 170;
    ctx.fillStyle = `hsla(${hue}, 88%, 63%, 0.75)`;
    ctx.beginPath();
    ctx.arc(px(x), py(y), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(210, 225, 240, 0.72)";
  ctx.font = "18px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillText("X adelante (m)", width - 180, height - 12);
  ctx.save();
  ctx.translate(18, height / 2 + 64);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Y lateral (m)", 0, 0);
  ctx.restore();
}

init().catch((error) => {
  app.innerHTML = `<div class="boot error">No se pudo cargar la app: ${error.message}</div>`;
});
