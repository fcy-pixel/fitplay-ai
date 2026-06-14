// FitPlay AI — 前端主程式
// 用 MediaPipe Pose 偵測動作，玩 3 個挑戰，計分後叫 Qwen 生成報告。
//
// 注意：MediaPipe 唔再喺頂層 import，而係喺 initPose() 用「動態 import」載入。
// 咁樣即使 CDN 被網絡擋住，呢個程式仍會完整載入，鏡頭同所有按鈕照樣運作。
let PoseLandmarker, FilesetResolver;

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
  // 動態載入 MediaPipe（CDN 失敗只會影響呢度，唔會拖垮成個程式）
  if (!PoseLandmarker) {
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs"
    );
    PoseLandmarker = mod.PoseLandmarker;
    FilesetResolver = mod.FilesetResolver;
  }
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
  );
  const opts = (delegate) => ({
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate,
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, opts("GPU"));
  } catch (e) {
    // 部分裝置 / 瀏覽器無 WebGL，改用 CPU 後備
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, opts("CPU"));
  }
}

// ---------- 鏡頭 ----------
async function enableCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("呢個瀏覽器唔支援鏡頭（需要 https 或較新版本 Chrome/Safari）");
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  } catch (err) {
    // 將瀏覽器錯誤碼轉成人話
    const map = {
      NotAllowedError: "鏡頭權限被拒絕。請喺網址列左邊嘅鎖頭🔒 → 允許「相機」，再重新整理。",
      NotFoundError: "搵唔到鏡頭。請確認裝置有鏡頭並無被其他程式佔用。",
      NotReadableError: "鏡頭被其他程式（Zoom／Teams／另一個分頁）佔用，請先關閉佢哋。",
      OverconstrainedError: "鏡頭唔支援要求嘅設定，請換另一部裝置試。",
      SecurityError: "因安全限制無法開啟鏡頭，請用 https 網址開啟。",
    };
    throw new Error(map[err.name] || `${err.name}：${err.message}`);
  }
  video.srcObject = stream;
  await new Promise((res) => (video.onloadedmetadata = res));
  await video.play();
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
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

// 圓形倒數環：周長 = 2πr，r = 52
const RING_C = 2 * Math.PI * 52;
function setTimer(remaining, duration) {
  $("game-timer").textContent = remaining;
  const frac = Math.max(0, remaining / duration);
  $("ring-fg").style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(1);
  $("timer-ring").classList.toggle("low", remaining <= 5 && remaining > 0);
}

// 大大個 3-2-1 倒數
function flashBig(text) {
  const bc = $("big-countdown");
  bc.textContent = text;
  bc.classList.remove("show");
  void bc.offsetWidth; // 重觸發動畫
  bc.classList.add("show");
}

function prepareChallenge() {
  const c = CHALLENGES[state.currentChallenge];
  state.mode = null;
  $("game-title").textContent = c.title;
  $("game-unit").textContent = c.unit;
  $("game-count").textContent = "0";
  setTimer(c.duration, c.duration);
  $("timer-ring").classList.remove("low");
  $("big-countdown").classList.remove("show");
  $("game-instruction").textContent = c.instruction;
  $("btn-start-challenge").textContent = `開始：${c.title} ▶`;
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
  setTimer(remaining, c.duration);
  $("game-instruction").textContent = "準備…";

  // 大倒數 3 → 2 → 1 → 開始！
  let pre = 3;
  flashBig(pre);
  const preTimer = setInterval(() => {
    pre--;
    if (pre > 0) {
      flashBig(pre);
    } else if (pre === 0) {
      flashBig("開始!");
    } else {
      clearInterval(preTimer);
      $("big-countdown").classList.remove("show");
      $("game-instruction").textContent = c.instruction;
      state.mode = c.key; // 開始計數
      const timer = setInterval(() => {
        remaining--;
        setTimer(remaining, c.duration);
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

// ---------- 體適能參考常模（可校準）----------
// 設計參考「香港學校體適能獎勵計劃」分齡分性別嘅理念：
//   good  = 達標（≈ 同齡第50百分位，給 80 分）
//   exc   = 優異（≈ 同齡第85百分位，給 100 分）
// 註：本計劃官方測試為 1 分鐘仰臥起坐 / 坐位體前彎 / 9 分鐘跑等，
//     與本 app 嘅動作（30 秒開合跳/深蹲、單腳平衡）唔完全對應，
//     以下數值為按生理發展推算嘅教育用參考值，老師可用全班實測中位數校準。
const NORMS = {
  // 年齡分組：'6-9' | '10-12' | '13-15' | '16+'
  // 每格 [達標(good), 優異(exc)]
  jumpingJacks: { // 30 秒下數
    male:   { "6-9": [22, 32], "10-12": [28, 40], "13-15": [32, 44], "16+": [34, 46] },
    female: { "6-9": [20, 30], "10-12": [26, 38], "13-15": [30, 42], "16+": [32, 44] },
  },
  squats: { // 30 秒下數
    male:   { "6-9": [16, 24], "10-12": [20, 30], "13-15": [24, 34], "16+": [26, 38] },
    female: { "6-9": [15, 22], "10-12": [18, 28], "13-15": [22, 32], "16+": [24, 34] },
  },
  balance: { // 單腳站立秒數
    male:   { "6-9": [12, 22], "10-12": [18, 28], "13-15": [22, 32], "16+": [24, 34] },
    female: { "6-9": [14, 24], "10-12": [20, 30], "13-15": [24, 34], "16+": [26, 36] },
  },
};

// 兒童 BMI-for-age 健康區間（參考 WHO/衞生署理念，教育用簡化值）
// 每格 [健康下限, 健康上限]
const BMI_HEALTHY = {
  male:   { "6-9": [14.0, 18.5], "10-12": [14.5, 20.5], "13-15": [16.0, 22.5], "16+": [17.5, 24.0] },
  female: { "6-9": [13.8, 18.8], "10-12": [14.5, 21.0], "13-15": [16.5, 23.0], "16+": [17.5, 24.0] },
};

function ageBand(age) {
  const a = parseInt(age, 10) || 12;
  if (a <= 9) return "6-9";
  if (a <= 12) return "10-12";
  if (a <= 15) return "13-15";
  return "16+";
}
function genderKey(g) {
  return g === "女" ? "female" : "male"; // 「其他」暫用男性常模
}

// 將實測值對照常模轉成 0–100 分
// 0 ~ good → 0–80 分；good ~ exc → 80–100 分；≥ exc → 100 分
function scoreVsNorm(value, [good, exc]) {
  if (value <= 0) return 0;
  if (value >= exc) return 100;
  if (value >= good) return Math.round(80 + ((value - good) / (exc - good)) * 20);
  return Math.round((value / good) * 80);
}

// ---------- 計分（已按分齡/分性別常模校準）----------
function computeScores() {
  const r = state.results;
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const band = ageBand(state.profile.age);
  const g = genderKey(state.profile.gender);

  const cardio = scoreVsNorm(r.jumpingJacks, NORMS.jumpingJacks[g][band]);
  const legStrength = scoreVsNorm(r.squats, NORMS.squats[g][band]);
  const balance = scoreVsNorm(r.balanceSec, NORMS.balance[g][band]);
  const core = clamp((balance + legStrength) / 2); // 核心穩定（由平衡+下肢推算）

  // BMI（分齡/分性別健康區間）
  const h = parseFloat(state.profile.height) / 100;
  const w = parseFloat(state.profile.weight);
  let bmi = null, bmiScore = 70, bmiBand = "未知";
  if (h > 0 && w > 0) {
    bmi = Math.round((w / (h * h)) * 10) / 10;
    const [lo, hi] = BMI_HEALTHY[g][band];
    if (bmi >= lo && bmi <= hi) {
      bmiScore = 100; bmiBand = "健康";
    } else if (bmi < lo) {
      bmiScore = clamp(100 - (lo - bmi) * 12); bmiBand = "偏輕";
    } else {
      bmiScore = clamp(100 - (bmi - hi) * 12); bmiBand = bmi > hi + 3 ? "肥胖" : "超重";
    }
  }

  state.scores = { cardio, legStrength, balance, core, bmi, bmiScore, bmiBand, band, gender: g };
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
        backgroundColor: "rgba(151,117,250,.25)",
        borderColor: "#9775fa",
        pointBackgroundColor: "#ff6b6b",
        pointBorderColor: "#fff",
        pointRadius: 6,
        pointHoverRadius: 8,
        borderWidth: 3,
      }],
    },
    options: {
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 20, color: "#6b6f9c", backdropColor: "transparent", font: { size: 11 } },
          grid: { color: "rgba(43,45,82,.12)" },
          angleLines: { color: "rgba(43,45,82,.12)" },
          pointLabels: { color: "#2b2d52", font: { size: 15, weight: "700", family: "Noto Sans TC" } },
        },
      },
      plugins: { legend: { labels: { color: "#2b2d52", font: { size: 14, weight: "700" } } } },
    },
  });
  const s2 = state.scores;
  $("bmi-badge").textContent = s2.bmi ? `BMI：${s2.bmi}（${s2.bmiBand}）` : "未填身高體重";
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

  // 1) 先開鏡頭（即刻彈權限視窗，唔使等模型）
  $("cam-status").textContent = "開啟鏡頭中…請喺彈出視窗按「允許」";
  try {
    await enableCamera();
  } catch (e) {
    btn.disabled = false;
    $("cam-status").textContent = "❌ " + e.message;
    return;
  }

  // 2) 入到遊戲畫面，鏡頭已經睇到自己
  loop();
  state.currentChallenge = 0;
  showScreen("screen-game");
  prepareChallenge();

  // 3) 背景載入 AI 模型；未載好之前唔俾撳「開始挑戰」
  const startBtn = $("btn-start-challenge");
  startBtn.disabled = true;
  $("game-instruction").textContent = "🤖 AI 模型載入中…（第一次會耐少少）";
  try {
    await initPose();
    $("game-instruction").textContent = CHALLENGES[state.currentChallenge].instruction;
    startBtn.disabled = false;
  } catch (e) {
    $("game-instruction").textContent = "❌ AI 模型載入失敗：" + e.message +
      "。可能係網絡擋咗 CDN，請換網絡或稍後再試。";
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
