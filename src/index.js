/**
 * FitPlay AI — Cloudflare Worker
 *
 * 職責：
 *  1. 派送前端靜態網站（由 [assets] 綁定自動處理）
 *  2. /api/analyze ：安全代理 Qwen API，將體適能數據變成個人化分析報告
 *
 * Qwen 國際版採用 OpenAI 相容介面（DashScope International）。
 */

const QWEN_ENDPOINT =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      return handleAnalyze(request, env);
    }

    // 其餘交俾靜態檔案（index.html / app.js / style.css …）
    return env.ASSETS.fetch(request);
  },
};

async function handleAnalyze(request, env) {
  if (!env.QWEN_API_KEY) {
    return json(
      { error: "伺服器未設定 QWEN_API_KEY，請執行 wrangler secret put QWEN_API_KEY" },
      500
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { profile = {}, results = {}, scores = {}, previous = null } = payload;

  const prompt = buildPrompt({ profile, results, scores, previous });

  let qwenRes;
  try {
    qwenRes = await fetch(QWEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.QWEN_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.QWEN_MODEL || "qwen-plus",
        messages: [
          {
            role: "system",
            content:
              "你是一位專業嘅運動科學顧問同註冊體適能教練，服務對象係中小學生。" +
              "你會根據學生嘅體適能測試數據，用繁體中文（香港用語）撰寫一份溫暖、正面、" +
              "鼓勵性但專業嘅分析報告。語氣要適合學生睇得明，避免醫療診斷，著重健康同進步。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });
  } catch (e) {
    return json({ error: "連接 Qwen 失敗：" + e.message }, 502);
  }

  if (!qwenRes.ok) {
    const text = await qwenRes.text();
    return json({ error: `Qwen API 錯誤 (${qwenRes.status})`, detail: text }, 502);
  }

  const data = await qwenRes.json();
  const report =
    data?.choices?.[0]?.message?.content || "（未能生成報告，請稍後再試）";

  return json({ report });
}

function buildPrompt({ profile, results, scores, previous }) {
  const lines = [];
  lines.push("以下係一位學生啱啱完成嘅 AI 體適能小遊戲測試數據，請你生成一份個人化分析報告。");
  lines.push("");
  lines.push("【學生資料】");
  lines.push(`- 暱稱：${profile.name || "同學"}`);
  lines.push(`- 年齡：${profile.age || "未知"} 歲`);
  lines.push(`- 性別：${profile.gender || "未知"}`);
  lines.push(`- 身高：${profile.height || "未知"} cm`);
  lines.push(`- 體重：${profile.weight || "未知"} kg`);
  if (scores.bmi) lines.push(`- BMI：${scores.bmi}（分類：${scores.bmiBand || "未評"}）`);
  if (scores.band) lines.push(`- 年齡組別：${scores.band}（評分已對照此組別常模）`);
  lines.push("");
  lines.push("【原始測試成績】");
  lines.push(`- 開合跳（30 秒）：${results.jumpingJacks ?? 0} 下`);
  lines.push(`- 深蹲（30 秒）：${results.squats ?? 0} 下`);
  lines.push(`- 單腳平衡（最長維持）：${results.balanceSec ?? 0} 秒`);
  lines.push("");
  lines.push("【五大體適能評分（0–100，已對標同齡參考值）】");
  lines.push(`- 心肺耐力：${scores.cardio ?? "-"}`);
  lines.push(`- 下肢肌力：${scores.legStrength ?? "-"}`);
  lines.push(`- 平衡力：${scores.balance ?? "-"}`);
  lines.push(`- 核心穩定：${scores.core ?? "-"}`);
  lines.push(`- 身體質量（BMI 評分）：${scores.bmiScore ?? "-"}`);
  if (previous) {
    lines.push("");
    lines.push("【對比上一次測試】");
    lines.push(`- 上次心肺耐力：${previous.cardio ?? "-"}，下肢肌力：${previous.legStrength ?? "-"}，平衡力：${previous.balance ?? "-"}`);
  }
  lines.push("");
  lines.push("請按以下結構輸出（用 Markdown，加 emoji 標題，總字數約 350–500 字）：");
  lines.push("## 🌟 總體評語（2–3 句鼓勵性總結）");
  lines.push("## 💪 強項（指出 1–2 個表現最好嘅項目並讚賞）");
  lines.push("## 🎯 可改善之處（指出最弱項目，溫和地解釋對健康嘅影響）");
  lines.push("## 🏃 個人化訓練建議（俾 3 個具體、可喺屋企做、附次數/時間嘅練習）");
  lines.push("## ⚠️ 安全小提示（1–2 句）");

  return lines.join("\n");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
