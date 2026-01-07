require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require("nodemailer");
const readline = require('readline');

// --- 設定互動介面 ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

//這是一個小工具函數，讓我們可以用 await 等待使用者的輸入
const askQuestion = (query) => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
  // 1. 設定收件人 (優先讀取指令參數，否則預設寄給自己)
  let targetEmail = process.argv[2] || process.env.GMAIL_USER;
  
  console.log("==========================================");
  console.log("🚀 AI 郵件助理 v2.0 (互動版) 已啟動");
  console.log(`📨 預計收件人: ${targetEmail}`);
  console.log("==========================================\n");

  // 2. 詢問使用者關鍵字
  const userKeywords = await askQuestion("請輸入信件關鍵字或情境 (例如: 遲到道歉、拒絕報價...): ");
  
  if (!userKeywords) {
    console.log("❌ 未輸入關鍵字，程式結束。");
    rl.close();
    return;
  }

  // 3. 設定 Gemini
  console.log("\n🤖 AI 正在思考並撰寫 3 種版本，請稍候...");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-pro-latest" });

  // ★★★ 這裡是最關鍵的 Prompt 設計 ★★★
  // 我們要求 AI 產生三種版本，並用 "###SEPERATOR###" 這個字串隔開，這樣程式才切得開
  const prompt = `
    你是一個專業的郵件撰寫助理。請根據使用者提供的關鍵字：「${userKeywords}」，
    撰寫 3 封不同風格的 Email。
    
    需求：
    1. 第一版：非常正式、專業 (Professional)
    2. 第二版：溫和、親切 (Friendly)
    3. 第三版：簡潔有力 (Direct/Concise)
    
    格式規定：
    - 請直接提供信件內容，不要有任何開場白或結語。
    - 請在每一個版本之間，插入 "###SEPERATOR###" 這個字串作為分隔線。
    - 不要包含主旨 (Subject)，只包含內文。
  `;

  try {
    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    
    // 用我們設定的分隔線，把一大串文字切成三個陣列
    const versions = rawText.split('###SEPERATOR###').map(v => v.trim()).filter(v => v.length > 0);

    // 4. 顯示選項給使用者看
    console.log("\n------------------------------------------");
    versions.forEach((version, index) => {
      console.log(`\n【選項 ${index + 1}】：\n${version}`);
      console.log("\n------------------------------------------");
    });

    // 5. 讓使用者選擇
    const choice = await askQuestion("請選擇你要寄出的版本 (輸入 1, 2 或 3，輸入其他鍵取消): ");
    const selectedIndex = parseInt(choice) - 1;

    if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= versions.length) {
      console.log("🚫 取消發送或輸入錯誤。");
      rl.close();
      return;
    }

    const finalContent = versions[selectedIndex];
    console.log(`\n✅ 你選擇了【選項 ${choice}】，準備發送...`);

    // 6. 準備發送 Gmail
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: targetEmail,
      subject: `【來自 AI 助理的信件】關於：${userKeywords}`, // 自動把關鍵字帶入主旨
      text: finalContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("🎉 發送成功！信件 ID:", info.messageId);

  } catch (error) {
    console.error("❌ 發生錯誤:", error);
  } finally {
    rl.close(); // 記得關閉輸入介面
  }
}

main();