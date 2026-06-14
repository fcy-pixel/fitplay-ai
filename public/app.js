// FitPlay AI — 前端主程式
// 用 MediaPipe Pose 偵測動作，玩 3 個挑戰，計分後叫 Qwen 生成報告。
import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22";

// ---------- 全域狀態 ----------
const state = {
  profile: {},
  results: { jumpingJacks: 0, squats: 0, balanceSec: 0 },
  scores: {},
  currentChallenge: 0,
  mode: null, // "jumpingJacks" | "squats" | "balance" | null
};

// 三個挑戰定義
const CHALLENGES = [
  {
    key: "jumpingJacks",
    title: "🌟 開合跳",
    unit: "下",
    duration: 30,
    instruction: "雙手舉高過頭、雙腳張開，然後合返。盡量喺 30 秒內做多啲！",
  },
  {
    key: "squats",
    title: "⚡ 深蹲",
    unit: "下",
    duration: 30,
    instruction: "慢慢蹲低（大腿接近水平）再企返直，背要挺。30 秒挑戰！",
  },
  {
    key: "balance",
    title: "🧘 單腳平衡",
    unit: "秒",
    duration: 30,
    instruction: "單腳企，另一隻腳抬起，盡量企耐啲，會記錄你最長維持時間。",
  },
];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("webcam");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");

// ---------- MediaPipe ----------
let poseLandmarker = null;
let lastVideoTime = -1;
let rafId = null;

async function initPose() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

// ---------- 鏡頭 ----------
async function enableCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((res) => (video.onloadedmetadata = res));
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

// ---------- 偵測迴圈 ----------
function loop() {
  rafId = requestAnimationFrame(loop);
  if (!poseLandmarker || video.readyState < 2) return;

  const now = performance.now();
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const res = poseLandmarker.detectForVideo(video, now);
  const lm = res.landmarks && res.landmarks[0];

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (lm) {
    drawSkeleton(lm);
    if (state.mode) updateCounter(state.mode, lm, now);
  }
}

// ---------- 幾何 ----------
function angle(a, b, c) {
  // b 為頂點，回傳角度（度）
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y) || 1e-6;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}
const vis = (p) => p && (p.visibility === undefined || p.visibility > 0.5);

// BlazePose 索引
const L = { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ank: 27 };
const R = { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ank: 28 };
const NOSE = 0;

// ---------- 計數狀態機 ----------
const counter = {
  jjOpen: false,
  squatDown: false,
  balanceStart: 0,
  balanceMax: 0,
};

function updateCounter(mode, lm, now) {
  if (mode === "jumpingJacks") {
    const wristUp =
      vis(lm[L.wr]) && vis(lm[R.wr]) && vis(lm[L.sh]) &&
      lm[L.wr].y < lm[L.sh].y && lm[R.wr].y < lm[R.sh].y;
    const shoulderW = Math.abs(lm[L.sh].x - lm[R.sh].x) || 0.1;
    const legsApart =
      vis(lm[L.ank]) && vis(lm[R.ank]) &&
      Math.abs(lm[L.ank].x - lm[R.ank].x) > shoulderW * 1.3;
    const open = wristUp && legsApart;
    if (open && !counter.jjOpen) {
      counter.jjOpen = true;
      addCount("jumpingJacks");
    } else if (!open) {
      counter.jjOpen = false;
    }
  }

  if (mode === "squats") {
    const lk = vis(lm[L.hip]) && vis(lm[L.knee]) && vis(lm[L.ank])
      ? angle(lm[L.hip], lm[L.knee], lm[L.ank]) : 180;
    const rk = vis(lm[R.hip]) && vis(lm[R.knee]) && vis(lm[R.ank])
      ? angle(lm[R.hip], lm[R.knee], lm[R.ank]) : 180;
    const knee = Math.min(lk, rk);
    if (knee < 110 && !counter.squatDown) {
      counter.squatDown = true;
    } else if (knee > 160 && counter.squatDown) {
      counter.squatDown = false;
      addCount("squats");
    }
  }

  if (mode === "balance") {
    // 一隻腳明顯抬起（兩腳踝高度差），即計時
    const ankleDiff =
      vis(lm[L.ank]) && vis(lm[R.ank]) ? Math.abs(lm[L.ank].y - lm[R.ank].y) : 0;
    const balancing = ankleDiff > 0.08;
    if (balancing) {
      if (!counter.balanceStart) counter.balanceStart = now;
      const held = (now - counter.balanceStart) / 1000;
      counter.balanceMax = Math.max(counter.balanceMax, held);
      $("game-count").textContent = held.toFixed(1);
    } else {
      counter.balanceStart = 0;
    }
  }
}

function addCount(key) {
  state.results[key]++;
  $("game-count").textContent = state.results[key];
  $("game-count").animate(
    [{ transform: "scale(1.4)" }, { transform: "scale(1)" }],
    { duration: 200 }
  );
}

// ---------- 畫骨架 ----------
const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
function drawSkeleton(lm) {
  ctx.strokeStyle = "#36e0a4";
  ctx.lineWidth = 4;
  ctx.fillStyle = "#4f8cff";
  for (const [a, b] of CONNECTIONS) {
    if (!vis(lm[a]) || !vis(lm[b])) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
    ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
    ctx.stroke();
  }
  for (const p of lm) {
    if (!vis(p)) continue;
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- 挑戰流程 ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function renderDots() {
  const dots = $("progress-dots");
  dots.innerHTML = "";
  CHALLENGES.forEach((_, i) => {
    const d = document.createElement("span");
    if (i < state.currentChallenge) d.className = "done";
    else if (i === state.currentChallenge) d.className = "active";
    dots.appendChild(d);
  });
}

function prepareChallenge() {
  const c = CHALLENGES[state.currentChallenge];
  state.mode = null;
  $("game-title").textContent = c.title;
  $("game-unit").textContent = c.unit;
  $("game-count").textContent = "0";
  $("game-timer").textContent = c.duration + "s";
  $("game-instruction").textContent = c.instruction;
  $("btn-start-challenge").textContent = `開始：${c.title}`;
  $("btn-start-challenge").disabled = false;
  renderDots();
}

function runChallenge() {
  const c = CHALLENGES[state.currentChallenge];
  $("btn-start-challenge").disabled = true;
  // 重設狀態機
  counter.jjOpen = false;
  counter.squatDown = false;
  counter.balanceStart = 0;
  counter.balanceMax = 0;

  let remaining = c.duration;
  $("game-timer").textContent = remaining + "s";

  // 3 秒倒數
  let pre = 3;
  $("game-instruction").textContent = `準備… ${pre}`;
  const preTimer = setInterval(() => {
    pre--;
    if (pre > 0) {
      $("game-instruction").textContent = `準備… ${pre}`;
    } else {
      clearInterval(preTimer);
      $("game-instruction").textContent = c.instruction;
      state.mode = c.key; // 開始計數
      const timer = setInterval(() => {
        remaining--;
        $("game-timer").textContent = remaining + "s";
        if (remaining <= 0) {
          clearInterval(timer);
          finishChallenge();
        }
      }, 1000);
    }
  }, 1000);
}

function finishChallenge() {
  const c = CHALLENGES[state.currentChallenge];
  state.mode = null;
  if (c.key === "balance") {
    state.results.balanceSec = Math.round(counter.balanceMax * 10) / 10;
  }
  state.currentChallenge++;
  if (state.currentChallenge < CHALLENGES.length) {
    prepareChallenge();
  } else {
    goToReport();
  }
}

// ---------- 計分（0–100，門檻可按官方常模調整）----------
function computeScores() {
  const r = state.results;
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

  const cardio = clamp((r.jumpingJacks / 40) * 100); // 30秒40下 ≈ 滿分
  const legStrength = clamp((r.squats / 25) * 100); // 30秒25下 ≈ 滿分
  const balance = clamp((r.balanceSec / 30) * 100); // 維持30秒 ≈ 滿分
  const core = clamp((balance + legStrength) / 2); // 核心穩定（估算）

  // BMI
  const h = parseFloat(state.profile.height) / 100;
  const w = parseFloat(state.profile.weight);
  let bmi = null, bmiScore = 70;
  if (h > 0 && w > 0) {
    bmi = Math.round((w / (h * h)) * 10) / 10;
    // 18.5–23 視為理想；偏離愈遠分愈低（教育用簡化模型）
    const ideal = 20.75;
    bmiScore = clamp(100 - Math.abs(bmi - ideal) * 7);
  }

  state.scores = { cardio, legStrength, balance, core, bmi, bmiScore };
}

// ---------- 報告 ----------
let radarChart = null;
function drawRadar() {
  const s = state.scores;
  const data = [s.cardio, s.legStrength, s.balance, s.core, s.bmiScore];
  const labels = ["心肺耐力", "下肢肌力", "平衡力", "核心穩定", "身體質量"];
  if (radarChart) radarChart.destroy();
  radarChart = new Chart($("radar"), {
    type: "radar",
    data: {
      labels,
      datasets: [{
        label: "你的分數",
        data,
        backgroundColor: "rgba(54,224,164,.25)",
        borderColor: "#36e0a4",
        pointBackgroundColor: "#4f8cff",
        borderWidth: 2,
      }],
    },
    options: {
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 20, color: "#9aa3c7", backdropColor: "transparent" },
          grid: { color: "rgba(255,255,255,.12)" },
          angleLines: { color: "rgba(255,255,255,.12)" },
          pointLabels: { color: "#eef1ff", font: { size: 13 } },
        },
      },
      plugins: { legend: { labels: { color: "#eef1ff" } } },
    },
  });
  const s2 = state.scores;
  $("bmi-badge").textContent = s2.bmi ? `BMI：${s2.bmi}` : "未填身高體重";
}

async function fetchAIReport() {
  const previous = JSON.parse(localStorage.getItem("fitplay-last") || "null");
  $("ai-loading").style.display = "flex";
  $("ai-report").innerHTML = "";
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: state.profile,
        results: state.results,
        scores: state.scores,
        previous,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "伺服器錯誤");
    $("ai-report").innerHTML = marked.parse(data.report);
  } catch (e) {
    $("ai-report").innerHTML =
      `<p style="color:#ffb84f">😅 暫時生成唔到 AI 報告：${e.message}</p>` +
      `<p>不過你嘅雷達圖同分數已經出咗喺左邊喇！</p>`;
  } finally {
    $("ai-loading").style.display = "none";
    // 儲存今次成績，下次做進度對比
    localStorage.setItem("fitplay-last", JSON.stringify(state.scores));
  }
}

function goToReport() {
  computeScores();
  $("report-name").textContent = state.profile.name || "你";
  showScreen("screen-report");
  drawRadar();
  fetchAIReport();
  if (rafId) cancelAnimationFrame(rafId); // 報告畫面停止偵測，慳資源
}

// ---------- 事件 ----------
$("btn-enable-cam").addEventListener("click", async () => {
  state.profile = {
    name: $("in-name").value.trim(),
    age: $("in-age").value,
    gender: $("in-gender").value,
    height: $("in-height").value,
    weight: $("in-weight").value,
  };
  const btn = $("btn-enable-cam");
  btn.disabled = true;
  $("cam-status").textContent = "載入 AI 模型中…（第一次會耐少少）";
  try {
    await initPose();
    $("cam-status").textContent = "開啟鏡頭中…";
    await enableCamera();
    loop();
    state.currentChallenge = 0;
    showScreen("screen-game");
    prepareChallenge();
  } catch (e) {
    btn.disabled = false;
    $("cam-status").textContent = "❌ 失敗：" + e.message + "（請確認已允許鏡頭權限）";
  }
});

$("btn-start-challenge").addEventListener("click", runChallenge);

$("btn-restart").addEventListener("click", () => {
  state.results = { jumpingJacks: 0, squats: 0, balanceSec: 0 };
  state.currentChallenge = 0;
  showScreen("screen-game");
  loop();
  prepareChallenge();
});

$("btn-print").addEventListener("click", () => window.print());
