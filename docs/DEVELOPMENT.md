# DEVELOPMENT.md — 開發規範

## 1. 模組系統與技術約束

| 範圍 | 規範 |
|------|------|
| 後端（`app.js`、`server.js`、`src/`、`tests/`） | **CommonJS**：`require` / `module.exports`。不要使用 `import`。 |
| `vitest.config.js` | 唯一的 ESM 檔（`import { defineConfig } from 'vitest/config'`），package.json 未設定 `"type"`；測試檔案本身仍用 CommonJS `require`。 |
| 前端（`public/js/`） | **不使用模組**。以 `<script>` 依序載入，靠全域變數 `Auth`、`apiFetch`、`Notification`、`Vue`（CDN）溝通。頁面腳本用 `const { createApp, ref, ... } = Vue;` 解構。 |
| 資料庫 | better-sqlite3 **同步 API**：`db.prepare(sql).get/all/run`，不使用 `await`。多步驟寫入用 `db.transaction(fn)`。 |
| SQL | 一律使用 `?` 參數化。唯一例外是 `cartRoutes.js` 用 `${owner.field}` 內插欄位名（值僅來自程式內固定的 `user_id`/`session_id`，不可改成來自使用者輸入）。 |
| 縮排與風格 | 2 空格、單引號、結尾分號；沒有 ESLint/Prettier 設定，請對齊相鄰檔案。 |
| 語言 | API `message`、UI 文案、`@openapi` 摘要使用**繁體中文**；程式碼識別字、錯誤碼使用英文。 |

## 2. 命名規則對照表

| 對象 | 規則 | 範例 |
|------|------|------|
| 路由檔 | `<領域>Routes.js`（camelCase） | `authRoutes.js`、`adminProductRoutes.js` |
| 中介層檔 | `<名稱>Middleware.js`；錯誤處理為 `errorHandler.js` | `authMiddleware.js` |
| 測試檔 | `<領域>.test.js`（camelCase），共用輔助為 `setup.js` | `adminOrders.test.js` |
| 前端頁面腳本 | `kebab-case.js`，檔名 = `pageRoutes` 傳入的 `pageScript` | `order-detail.js` ↔ `pageScript: 'order-detail'` |
| EJS 頁面 | `kebab-case.ejs`，後台放 `pages/admin/` | `product-detail.ejs` |
| 資料表 | 小寫 snake_case、複數 | `cart_items`、`order_items` |
| 欄位 | snake_case | `password_hash`、`recipient_name` |
| **API 回應欄位** | snake_case（直接回傳 DB 欄位） | `order_no`、`total_amount`、`image_url` |
| **API 請求 body 欄位** | **camelCase**（與回應不同！） | `productId`、`recipientName`；例外：商品 CRUD 的 body 用 `image_url` |
| JS 變數/函式 | camelCase | `getOwnerCondition`、`generateOrderNo` |
| 常數 | UPPER_SNAKE_CASE | `TOKEN_KEY`、`SAFE_MESSAGES` |
| 錯誤碼 | UPPER_SNAKE_CASE 字串 | `STOCK_INSUFFICIENT` |
| 主鍵 | `uuid` v4 字串 | `uuidv4()` |
| 訂單編號 | `ORD-YYYYMMDD-XXXXX` | `ORD-20261025-A1B2C` |
| localStorage key | `flower_` 前綴 | `flower_token`、`flower_user`、`flower_session_id` |
| Git 分支/提交 | 目前僅 `main` + `init`；建議 Conventional Commits（`feat:`、`fix:`、`docs:`） | — |

> 請求與回應欄位大小寫不一致是現況（如 `POST /api/cart` 收 `productId`，`GET /api/cart` 回 `product_id`）。新增 API 時沿用「請求 camelCase、回應 snake_case」，不要自行混用。

## 3. 環境變數

由 `dotenv` 在 `app.js` 載入根目錄 `.env`（`.env` 被 gitignore，範本為 `.env.example`）。

| 變數 | 用途 | 必要性 | 預設值 | 使用位置 |
|------|------|--------|--------|----------|
| `JWT_SECRET` | JWT 簽章/驗證密鑰 | **必填**（`node server.js` 缺少時直接結束；測試時由 `.env` 提供） | 無 | server.js、authRoutes、authMiddleware、cartRoutes |
| `PORT` | 監聽埠 | 選填 | `3001` | server.js |
| `FRONTEND_URL` | CORS 允許的 origin（單一值） | 選填 | `http://localhost:3001`（`.env.example` 範例為 `http://localhost:5173`） | app.js |
| `ADMIN_EMAIL` | seed 管理員 email | 選填 | `admin@hexschool.com` | database.js |
| `ADMIN_PASSWORD` | seed 管理員密碼 | 選填 | `12345678` | database.js |
| `NODE_ENV` | `test` 時 seed admin 的 bcrypt rounds 降為 1（Vitest 會自動設為 `test`） | 選填 | 未設 | database.js |
| `BASE_URL` | 本站對外網址，組成綠界 `ClientBackURL`/`ReturnURL` | 選填 | `http://localhost:3001` | ecpayService.js |
| `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` | 綠界 AIO 金流憑證（範例為公開 staging 測試帳號）；**三者缺一則退回模擬付款** | 選填 | 無 | ecpayService.js、orderRoutes.js |
| `ECPAY_ENV` | `staging`（測試）或 `production`（正式） | 選填 | `staging` | ecpayService.js |

注意：
- seed admin 只在「該 email 尚不存在」時建立；之後修改 `ADMIN_PASSWORD` **不會更新**既有帳號，需刪除 `database.sqlite*` 或直接改 DB。
- 測試輔助 `getAdminToken()` 寫死 `admin@hexschool.com / 12345678`；若 `.env` 改了 admin 憑證，測試會失敗。
- `.env` 有 `ADMIN_PASSWORD` 等明文機敏資訊時請勿提交（已被 gitignore）。

## 4. 常用指令

| 指令 | 說明 |
|------|------|
| `npm install` | 安裝依賴（bcrypt、better-sqlite3 為原生模組，需可編譯/預編譯環境） |
| `npm start` | `css:build` + `node server.js`（正式啟動，Tailwind 壓縮輸出） |
| `npm run dev:server` | 只啟動 server（**不會**建置 CSS，需先跑過 `css:build`） |
| `npm run dev:css` | Tailwind watch 模式（與 `dev:server` 同時開兩個終端機） |
| `npm run css:build` | 建置 `public/css/output.css`（minify） |
| `npm run openapi` | 產生 `openapi.json` |
| `npm test` | `vitest run`（全部整合測試） |

沒有 nodemon／熱重載；改後端程式碼需重啟 server。

## 5. 新增功能的步驟

### 5.1 新增一個 API 端點
1. **決定檔案**：屬於既有領域就加在該 `src/routes/*Routes.js`；全新領域則新增 `<領域>Routes.js`，並在 `app.js` 的 `// API Routes` 區塊以 `app.use('/api/<prefix>', require(...))` 掛載（放在 `// Page Routes` 之前）。
2. **套用認證**：
   - 整個 router 都需登入：`router.use(authMiddleware)`（如 orderRoutes）。
   - 需管理員：`router.use(authMiddleware, adminMiddleware)`，**順序不可顛倒**。
   - 單一路由：`router.get('/x', authMiddleware, handler)`（如 `/api/auth/profile`）。
   - 需要訪客也能用的資源：參考 `cartRoutes.js` 的 `dualAuth` + `getOwnerCondition`。
3. **驗證輸入**，失敗時 `return res.status(400).json({ data: null, error: 'VALIDATION_ERROR', message: '...' })`（記得 `return`）。
4. **回應**固定 `{ data, error, message }`；建立資源回 `201`，其餘 `200`；找不到 `404 NOT_FOUND`。
5. 多表寫入包 `db.transaction(() => { ... })()`。
6. 寫 `@openapi` JSDoc（§7）。
7. 在 `tests/` 新增或擴充測試（TESTING.md），若新增測試檔要加進 `vitest.config.js` 的 `sequence.files`。
8. 更新 `docs/FEATURES.md`、`docs/ARCHITECTURE.md` 路由表與 `docs/CHANGELOG.md`。

### 5.2 新增一個 middleware
1. 在 `src/middleware/<名稱>Middleware.js` 匯出 `function (req, res, next)`；失敗用統一格式回應，成功呼叫 `next()`。
2. 全域性質的在 `app.js` 於 `express.json()` 之後、路由之前 `app.use`；路由專屬的在 router 內掛載。
3. 錯誤處理型（四參數）必須是 `app.use` 的**最後一個**。
4. 需要把資料帶給後續 handler 時掛在 `req` 上（現有：`req.user`、`req.sessionId`），並更新 ARCHITECTURE.md。

### 5.3 變更資料庫
1. 所有 schema 都在 `src/database.js` 的 `initializeDatabase()`，使用 `CREATE TABLE IF NOT EXISTS`。
2. **沒有 migration 系統**：`IF NOT EXISTS` 不會修改既有資料表。新增/修改欄位必須：(a) 刪除本機 `database.sqlite*` 重建，或 (b) 自行加入 `ALTER TABLE`（需先以 `PRAGMA table_info` 判斷是否已存在，避免重複執行出錯）。
3. 新增種子資料放在 `seed*` 函式並保持冪等（先檢查是否已存在）。
4. 修改欄位後同步更新 ARCHITECTURE.md 的 schema 表格與相關查詢。
5. 注意 `foreign_keys = ON`：新增 FK 要考慮刪除行為（現有 `cart_items.product_id` 即因此阻擋商品刪除）。

### 5.4 新增前台/後台頁面
1. `views/pages/<name>.ejs`（後台放 `pages/admin/`）：根節點 `<div id="app">`，需要伺服器參數時用 `data-*` 屬性。
2. `public/js/pages/<name>.js`：`createApp({ setup() { ... } }).mount('#app')`；呼叫 API 一律用 `apiFetch`；通知用 `Notification.show(msg, 'success'|'error'|'warning'|'info')`；需登入的頁面開頭 `if (!Auth.requireAuth()) return {};`。
3. 在 `pageRoutes.js` 用 `renderFront` / `renderAdmin` 註冊，`pageScript` 必須等於 JS 檔名（不含 `.js`）。後台需帶 `currentPath` 以高亮側邊欄，並於 `admin-sidebar.ejs` 加連結。
4. 新增 Tailwind class 後執行 `npm run css:build`（或開 `dev:css`）。色票使用 `input.css` `@theme` 內的 token（`rose-primary`、`sage`、`apricot`…）。

## 6. 錯誤處理與回應準則

- 預期內的錯誤在路由內直接回應；不要依賴 `throw` 到 `errorHandler`（它會把錯誤碼固定成 `INTERNAL_ERROR`）。
- 不要回傳 `password_hash`；查使用者時只選必要欄位（參考 `SELECT id, email, name, role, created_at`）。
- 登入失敗訊息不得區分「帳號不存在」與「密碼錯誤」。
- 所有金額為整數新台幣；不要引入浮點數。

## 7. JSDoc / OpenAPI 格式

API 文件以 `@openapi` 區塊直接寫在每個路由處理器上方（`swagger-jsdoc` 讀 YAML）。範例（取自本專案風格）：

```js
/**
 * @openapi
 * /api/admin/orders:
 *   get:
 *     summary: 後台訂單列表
 *     tags: [Admin Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, paid, failed]
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 */
router.get('/', (req, res) => { /* ... */ });
```

規則：
- `tags` 與路由領域對應（Auth、Products、Cart、Orders、Admin Products、Admin Orders）。
- 需要 JWT 用 `security: [ { bearerAuth: [] } ]`；購物車可用 `bearerAuth` 或 `sessionId` 兩者擇一（兩個 security 項目）。
- YAML 縮排以 2 空格，`*` 後固定一空格，**縮排錯誤會導致 `npm run openapi` 解析失敗**。
- 產生後檢查 `openapi.json`；掃描範圍僅 `./src/routes/*.js`（`swagger-config.js` 的 `apis`）。
- 一般函式的 JSDoc（`@param`/`@returns`）可選；測試輔助 `tests/setup.js` 使用 `/** 說明 */` 單句描述風格。

## 8. 計畫歸檔流程

1. 計畫檔案命名格式：`YYYY-MM-DD-<feature-name>.md`
2. 計畫文件結構：User Story → Spec → Tasks
3. 功能完成後：移至 `docs/plans/archive/`
4. 更新 `docs/FEATURES.md` 和 `docs/CHANGELOG.md`

### 計畫範本
```markdown
# <功能名稱>

## User Story
身為 <角色>，我想要 <能力>，以便 <價值>。

## Spec
- 行為描述、API 契約（路徑、body、回應、錯誤碼）
- 資料表變更
- 相容性與風險（例如：是否影響訪客購物車）

## Tasks
- [ ] 後端：...
- [ ] 前端：...
- [ ] 測試：...
- [ ] 文件：FEATURES / ARCHITECTURE / CHANGELOG
```

- 進行中的計畫放在 `docs/plans/`；歸檔後保留原檔名。
- 完成定義：測試全過（`npm test`）、FEATURES.md 狀態更新、CHANGELOG.md 新增條目。

## 9. 開發陷阱速查

1. `req.user.role` 來自 JWT，改 DB 角色後需重新登入。
2. 購物車的 `owner` 在登入前後不同，新增購物車功能要同時考慮兩種模式。
3. `apiFetch` 遇到 401 會登出並跳轉；預期 401 的呼叫需特別處理。
4. 修改 `.env` 的 admin 憑證不影響既有 DB 內的 admin。
5. 全域 `Notification` 遮蔽瀏覽器原生 API。
6. 測試與開發共用 `database.sqlite`（見 TESTING.md）。
