# 使用輕量級的 Node.js 環境
FROM node:20-alpine

# 設定工作目錄
WORKDIR /app

# 先複製 package 設定檔 (利用 Docker 快取機制加速)
COPY package*.json ./

# 安裝套件
RUN npm install --production

# 複製所有程式碼進去
COPY . .

# 告訴雲端我們用 3000 Port
EXPOSE 3000

# 啟動指令 (你的檔名是 linbot_email.js)
CMD ["node", "linebot_email.js"]