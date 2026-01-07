require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require("nodemailer");

// --- 1. 設定 LINE 與 Express ---
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// 建立 LINE 用戶端
const client = new line.Client(config);
const app = express();

// --- 2. 狀態管理 (讓機器人擁有短暫記憶) ---
// 格式: { userId: { step: 'waiting_choice', drafts: ['內容1', '內容2'...], keywords: '...' } }
const userSessions = {};

// --- 3. 處理 LINE 網頁請求的主入口 ---
app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// --- 4. 處理事件邏輯 ---
async function handleEvent(event) {
  // 只處理文字訊息
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const userText = event.message.text.trim();
  let session = userSessions[userId];

  // 【情境 A】使用者正在選版本 (輸入 1, 2, 3)
  if (session && session.step === 'waiting_choice') {
    // 檢查是否輸入 "取消"
    if (userText === '取消') {
      delete userSessions[userId];
      return client.replyMessage(event.replyToken, { type: 'text', text: '已取消操作。' });
    }

    const choice = parseInt(userText);
    if (isNaN(choice) || choice < 1 || choice > session.drafts.length) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '❌ 請輸入 1、2 或 3 來選擇版本，或是輸入「取消」結束。'
      });
    }

    // 寄出信件
    const finalContent = session.drafts[choice - 1];
    await sendEmail(finalContent, session.keywords); // 執行寄信

    // 清除狀態
    delete userSessions[userId];

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `🎉 第 ${choice} 版已成功寄出！\n(主旨：${session.keywords})`
    });
  }

  // 【情境 B】使用者輸入關鍵字，準備生成
  try {
    // 先做一個簡單的回覆，讓使用者知道機器人活著
    // 注意：因為 LINE 回覆 token 只能用一次，我們這裡直接生成 + 回覆
    // 若生成時間過長，實際開發會改用 pushMessage，但這邊先用最簡單的寫法
    
    // 呼叫 Gemini
    const drafts = await generateDrafts(userText);

    // 存入記憶
    userSessions[userId] = {
      step: 'waiting_choice',
      keywords: userText,
      drafts: drafts
    };

    // 組合回覆文字
    let replyText = `🤖 關於「${userText}」，我寫了 3 個版本：\n\n`;
    drafts.forEach((draft, index) => {
      replyText += `【選項 ${index + 1}】\n${draft.substring(0, 60)}...\n\n`;
    });
    replyText += `👉 請回覆數字 (1, 2, 3) 寄出此版本。`;

    return client.replyMessage(event.replyToken, { type: 'text', text: replyText });

  } catch (error) {
    console.error("生成失敗:", error);
    return client.replyMessage(event.replyToken, { type: 'text', text: '❌ AI 思考失敗，請稍後再試。' });
  }
}

// --- 輔助函式：Gemini 生成 ---
async function generateDrafts(keywords) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // 使用你之前測試成功的模型
  const model = genAI.getGenerativeModel({ model: "gemini-pro-latest" });

  const prompt = `
    請根據關鍵字：「${keywords}」，撰寫 3 封不同風格的 Email。
    1. 正式 (Professional)
    2. 親切 (Friendly)
    3. 簡潔 (Direct)
    請在每封信之間插入 "###SEPERATOR###" 作為分隔。
    內容請直接寫信件內文，不要有主旨，也不要有 "第一版" 這種標題。
  `;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return text.split('###SEPERATOR###').map(v => v.trim()).filter(v => v.length > 0);
}

// --- 輔助函式：Nodemailer 寄信 ---
async function sendEmail(content, keywords) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: process.env.GMAIL_USER, // ★ 先寄給自己測試
    subject: `【LINE Bot】${keywords}`,
    text: content,
  };

  await transporter.sendMail(mailOptions);
}

// --- 啟動伺服器 ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE Bot 伺服器啟動中... Port: ${port}`);
});