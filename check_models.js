// check_models.js
require('dotenv').config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  console.log("🔍 正在查詢您的 API Key 可用的模型列表...");

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("❌ 查詢失敗，原因：", data.error.message);
      return;
    }

    if (!data.models) {
      console.log("⚠️ 沒有找到任何可用模型，請檢查專案設定。");
      return;
    }

    console.log("✅ 您的 API Key 可以使用以下模型：");
    console.log("------------------------------------------------");
    data.models.forEach(model => {
      // 只列出 generateContent (對話用) 的模型
      if (model.supportedGenerationMethods.includes("generateContent")) {
        console.log(`- ${model.name.replace("models/", "")}`);
      }
    });
    console.log("------------------------------------------------");

  } catch (error) {
    console.error("連線錯誤：", error);
  }
}

listModels();