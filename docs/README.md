# 花漾生活 Flower Life — 花卉電商 Demo

一個以 Node.js + Express 打造的全端花卉電商範例：前台商品瀏覽、訪客/會員雙模式購物車、下單與綠界 ECPay 信用卡付款（本機以主動查詢驗證付款結果；未設定金流憑證時退回模擬付款），以及管理員後台（商品 CRUD、訂單檢視）。API 與頁面由同一個 Express 服務提供，資料存於單一 SQLite 檔。

## 技術棧

| 層級 | 技術 |
|------|------|
| 執行環境 | Node.js（CommonJS；建議 Node 18+，開發環境為 v22） |
| Web 框架 | Express `~4.16.1` |
| 資料庫 | SQLite，`better-sqlite3`（同步 API，WAL 模式，`foreign_keys=ON`） |
| 認證 | `jsonwebtoken`（HS256，7 天）、`bcrypt`（密碼雜湊） |
| 模板 | EJS 5（layout + partial，僅作頁面外殼） |
| 前端 | Vue 3（unpkg CDN，Composition API）、Tailwind CSS 4（`@tailwindcss/cli` 預先編譯） |
| API 文件 | `swagger-jsdoc`（OpenAPI 3.0.3，產出 `openapi.json`） |
| 其他 | `cors`、`dotenv`、`uuid` |
| 金流 | 綠界 ECPay AIO（信用卡）；使用 Node 內建 `fetch`（Node 18+）呼叫 `QueryTradeInfo/V5` |
| 測試 | Vitest 2 + supertest |

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 建立環境變數（至少需要 JWT_SECRET）
cp .env.example .env
# 編輯 .env，把 JWT_SECRET 換成自己的隨機字串

# 3. 建置 CSS 並啟動（首次啟動會自動建表 + seed 管理員與 8 筆商品）
npm start
```

開啟 <http://localhost:3001>。

- 管理員帳號（預設 seed）：`admin@hexschool.com` / `12345678`，登入後 header 會出現「後台管理」。
- 一般會員：在 `/login` 的「註冊」分頁自行註冊（密碼至少 6 字元）。
- 訪客可直接加入購物車；**結帳需登入**，且登入後看到的是會員購物車（不會合併訪客購物車）。
- 付款走綠界測試環境：訂單詳情頁按「前往綠界付款」（測試卡 4311-9522-2222-2222、3D 碼 1234），付款後返回商店會自動查詢結果；`.env` 未設定 `ECPAY_*` 時退回模擬付款按鈕。

開發模式（兩個終端機）：
```bash
npm run dev:css      # Tailwind watch
npm run dev:server   # node server.js（需先有 public/css/output.css）
```

執行測試：
```bash
npm test
```
> ⚠️ 測試會寫入與開發相同的 `database.sqlite`（新增使用者/訂單並扣庫存），詳見 [TESTING.md](./TESTING.md)。

## 常用指令表

| 指令 | 說明 |
|------|------|
| `npm start` | 建置 CSS 後啟動 server（埠 `PORT`，預設 3001） |
| `npm run dev:server` | 僅啟動 server |
| `npm run dev:css` | Tailwind watch 模式 |
| `npm run css:build` | 建置並壓縮 `public/css/output.css` |
| `npm run openapi` | 掃描 `src/routes/*.js` 產生 `openapi.json` |
| `npm test` | 執行 Vitest 整合測試（44 個） |

## 環境變數（摘要）

| 變數 | 必要 | 預設 |
|------|------|------|
| `JWT_SECRET` | 是 | — |
| `PORT` | 否 | 3001 |
| `FRONTEND_URL` | 否 | `http://localhost:3001`（CORS origin） |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 否 | `admin@hexschool.com` / `12345678` |
| `ECPAY_MERCHANT_ID/HASH_KEY/HASH_IV/ECPAY_ENV` | 否（缺少則為模擬付款） | staging 測試帳號 |
| `BASE_URL` | 否 | `http://localhost:3001` |

完整說明見 [DEVELOPMENT.md](./DEVELOPMENT.md#3-環境變數)。

## 專案結構（精簡）

```
app.js / server.js     # Express 組裝與啟動
src/database.js        # SQLite 初始化 + seed
src/middleware/        # auth、admin、session、errorHandler
src/services/          # ecpayService（綠界 AIO：CheckMacValue、付款參數、QueryTradeInfo）
src/routes/            # 6 組 API 路由 + pageRoutes
views/                 # EJS layouts / partials / pages
public/js/             # 前端 auth/api/notification 與各頁 Vue 腳本
tests/                 # Vitest + supertest
docs/                  # 本文件集
```

## 文件索引

| 文件 | 內容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 目錄結構、啟動流程、API 路由總覽、回應格式、認證授權、資料庫 schema、付款流程 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 命名規則、模組系統、環境變數、新增 API/middleware/DB 步驟、OpenAPI 註解、計畫歸檔流程 |
| [FEATURES.md](./FEATURES.md) | 功能清單與完成狀態、各端點行為、錯誤情境、已知問題 |
| [TESTING.md](./TESTING.md) | 測試檔表、執行順序、輔助函式、撰寫範例、常見陷阱 |
| [CHANGELOG.md](./CHANGELOG.md) | 更新日誌 |
| [plans/](./plans/) | 進行中的開發計畫；完成後移至 [plans/archive/](./plans/archive/) |
