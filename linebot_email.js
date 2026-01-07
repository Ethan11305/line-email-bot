require('dotenv').config();
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');

// 1. 設定 LINE
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

// 2. 設定 Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 3. 設定 Email (Nodemailer)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// 4. 定義工具 (寄信功能)
const tools = [
  {
    function_declarations: [
      {
        name: "send_email",
        description: "Send an email to a recipient with a subject and body.",
        parameters: {
          type: "OBJECT",
          properties: {
            recipient: { type: "STRING", description: "The email address of the recipient" },
            subject: { type: "STRING", description: "The subject of the email" },
            body: { type: "STRING", description: "The plain text body content of the email" },
          },
          required: ["recipient", "subject", "body"],
        },
      },
    ],
  },
];

const model = genAI.getGenerativeModel({ model: "gemini-pro", tools: tools });

// 5. 【關鍵】使用者狀態暫存區 (記憶體)
// 格式: { userId: { step: 'IDLE' | 'WAIT_EMAIL' | 'WAIT_CONTEXT' | 'WAIT_SELECTION', data: {} } }
const userSessions = {};

// 6. 處理訊息的主邏輯
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;
  const userText = event.message.text.trim();
  
  // 初始化使用者狀態
  if (!userSessions[userId]) {
    userSessions[userId] = { step: 'IDLE', data: {} };
  }

  const userState = userSessions[userId];

  try {
    // --- 狀態機邏輯開始 ---

    // 階段 0: 閒置中，等待「寄信」指令
    if (userState.step === 'IDLE') {
      if (userText.includes('寄信')) {
        userState.step = 'WAIT_EMAIL'; // 切換狀態
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '收到！請問您要寄給誰？\n(請輸入完整的 Email 地址)'
        });
      } else {
        // 普通聊天 (可選)
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: '我是 Email 小幫手，輸入「寄信」可以啟動服務喔！'
        });
      }
    }

    // 階段 1: 等待輸入 Email
    if (userState.step === 'WAIT_EMAIL') {
      // 簡單驗證 Email 格式
      if (!userText.includes('@')) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '這看起來不像 Email 喔，請重新輸入：'
        });
      }
      
      // 存起來
      userState.data.email = userText;
      userState.step = 'WAIT_CONTEXT'; // 切換狀態
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `收件人是：${userText}\n\n請問這封信的「內容」要是什麼？\n(例如：跟李經理請款，金額3000元，感謝他)`
      });
    }

    // 階段 2: 等待輸入內容 -> 生成草稿
    if (userState.step === 'WAIT_CONTEXT') {
      userState.data.context = userText;
      
      // 呼叫 Gemini 寫草稿 (不使用 Tools，只純生成文字)
      const chat = model.startChat(); // 普通聊天模式
      const prompt = `
        使用者想要寫一封信。
        收件人: ${userState.data.email}
        信件情境: ${userText}
        
        請幫我撰寫 3 個不同風格的「信件主旨」與「內文」草稿 (例如：正式、簡潔、委婉)。
        請清楚標示 【選項 1】、【選項 2】、【選項 3】。
        不要呼叫任何工具，只要回傳文字就好。
      `;
      
      const result = await chat.sendMessage(prompt);
      const response = result.response.text();

      // 存下 Gemini 的回覆，以便下一步讓它知道選項內容
      userState.data.draftResponse = response;
      userState.step = 'WAIT_SELECTION'; // 切換狀態

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: response + '\n\n--------------\n請回覆 1、2 或 3 來選擇並寄出，或是輸入「取消」重來。'
      });
    }

    // 階段 3: 等待選擇 -> 真的寄出
    if (userState.step === 'WAIT_SELECTION') {
      if (userText === '取消') {
        userSessions[userId] = { step: 'IDLE', data: {} };
        return client.replyMessage(event.replyToken, { type: 'text', text: '已取消操作。' });
      }

      if (['1', '2', '3'].includes(userText)) {
        // 呼叫 Gemini 執行寄信 (這次要帶 Tools)
        const chat = model.startChat();
        
        const finalPrompt = `
          上一輪對話中，你提供了這三個草稿：
          ${userState.data.draftResponse}
          
          使用者的原始需求是：${userState.data.context}
          使用者現在選擇了：【選項 ${userText}】
          收件人是：${userState.data.email}

          請根據使用者的選擇，擷取該選項的「主旨」與「內文」，並立刻呼叫 send_email 工具寄出信件。
        `;

        const result = await chat.sendMessage(finalPrompt);
        const calls = result.response.functionCalls();

        if (calls && calls.length > 0) {
          const call = calls[0];
          if (call.name === "send_email") {
            const { recipient, subject, body } = call.args;
            
            // 真正執行寄信
            await transporter.sendMail({
              from: process.env.GMAIL_USER,
              to: recipient,
              subject: subject,
              text: body,
            });

            // 寄完後，重置狀態
            userSessions[userId] = { step: 'IDLE', data: {} };

            return client.replyMessage(event.replyToken, {
              type: 'text',
              text: `✅ 寄信成功！\n\n主旨：${subject}\n收件人：${recipient}`
            });
          }
        } else {
            // 如果 Gemini 沒呼叫工具 (極少發生)
            return client.replyMessage(event.replyToken, { type: 'text', text: '發生錯誤，無法寄出，請稍後再試。' });
        }
      } else {
          return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入 1, 2, 3 來選擇，或輸入「取消」。' });
      }
    }

  } catch (error) {
    console.error('Error:', error);
    // 發生錯誤時重置狀態
    userSessions[userId] = { step: 'IDLE', data: {} };
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '哎呀，發生了一點錯誤，請重新輸入「寄信」來開始。'
    });
  }
}

// 7. 啟動伺服器
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});