# 🏃 FitPlay AI

> STEAM in PE 作品 — 用 AI 邊玩邊做體適能測試，再由 Qwen AI 生成個人化分析報告。

學生喺鏡頭前玩 3 個小遊戲（開合跳、深蹲、單腳平衡），AI 用 **MediaPipe Pose**
即時偵測動作並計數計分；完成後系統會計算「五大體適能」雷達圖，並呼叫
**Qwen AI** 撰寫一份溫暖又專業嘅個人化運動建議報告。

```
玩遊戲(動作偵測) → 即時計分 → 五大體適能雷達圖 → Qwen 個人化報告
```

## ✨ 特色
- 🎮 **有得玩**：體感小遊戲，提升做運動嘅動機
- 📊 **有數據**：自動記錄成績，localStorage 做進度對比
- 🤖 **AI 真有用**：① 動作偵測計數 ② 個人化文字報告
- 🔒 **安全**：Qwen API key 收喺 Cloudflare Worker，唔會外洩前端
- 🖨️ **可列印**：報告可一鍵存做 PDF

## 🛠️ 技術
| 部分 | 技術 |
|---|---|
| 動作偵測 | MediaPipe Tasks Vision（PoseLandmarker）|
| 遊戲/介面 | 原生 JS + Canvas |
| 圖表 | Chart.js（雷達圖）|
| AI 報告 | Qwen 國際版（OpenAI 相容介面）|
| 後端/部署 | Cloudflare Workers + Wrangler |

## 🚀 本機開發
```bash
npm install
cp .dev.vars.example .dev.vars   # 填入你嘅 QWEN_API_KEY
npm run dev                      # http://localhost:8787
```
> ⚠️ 鏡頭需要 https 或 localhost 先用得。`wrangler dev` 嘅 localhost 已符合。

## ☁️ 部署到 Cloudflare
```bash
npx wrangler login
npx wrangler secret put QWEN_API_KEY   # 貼上你嘅 Qwen key（唔會入 git）
npm run deploy
```
部署後會得到一個 `https://fitplay-ai.<你的帳號>.workers.dev` 網址。

## 📐 計分門檻（可調整）
分數門檻喺 `public/app.js` 的 `computeScores()`，
建議按**香港學校體適能獎勵計劃**或 **FITNESSGRAM** 同齡常模校準。

## ⚠️ 免責聲明
本工具僅供教育用途，並非醫療診斷。動作偵測準確度受燈光、鏡頭角度、衣著影響。
