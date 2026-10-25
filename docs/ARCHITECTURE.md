# ARCHITECTURE.md — 架構說明

> 本文件描述「花漾生活 Flower Life」花卉電商 Demo 的整體架構。所有內容皆由原始碼逐檔閱讀後整理，行為以程式碼為準。

## 1. 系統總覽

單一 Node.js 行程同時負責三件事：

1. **REST API**（`/api/*`）— Express 4 路由，回傳 JSON。
2. **伺服器端頁面渲染**（`/`、`/cart`、`/admin/*` …）— EJS 只負責外殼（layout + 空的 `<div id="app">`），不注入業務資料。
3. **靜態資源**（`public/`）— 瀏覽器端 Vue 3（CDN 載入）+ Tailwind CSS 4（預先編譯）。頁面資料由前端 JS 呼叫 `/api/*` 取得。

資料層為 **better-sqlite3**（同步 API）+ 單一 SQLite 檔 `database.sqlite`（專案根目錄，WAL 模式）。

```
Browser ──GET /cart──────────► pageRoutes ──EJS(layout+page)──► HTML 外殼
   │                                                              │
   │  載入 /js/pages/cart.js (Vue 3 createApp)                     │
   └──fetch /api/cart (Authorization / X-Session-Id)──► cartRoutes ──► database.sqlite
```

## 2. 目錄結構（每個檔案的用途）

```
.
├── server.js                 # 進入點：檢查 JWT_SECRET、監聽 PORT（預設 3001）。僅在 require.main === module 時 listen，測試 require 時不會開 port
├── app.js                    # Express app 組裝：dotenv、view engine、靜態檔、CORS、body parser、sessionMiddleware、路由掛載、404、errorHandler。module.exports = app
├── generate-openapi.js       # 以 swagger-jsdoc 掃描 src/routes/*.js 的 @openapi 註解，輸出 ./openapi.json（`npm run openapi`）
├── swagger-config.js         # OpenAPI 3.0.3 設定；定義 bearerAuth（JWT）與 sessionId（X-Session-Id header）兩種 securityScheme
├── vitest.config.js          # Vitest 設定：globals、fileParallelism: false、固定 sequence.files 順序、hookTimeout 10s
├── package.json              # scripts 與依賴
├── .env / .env.example       # 環境變數（.env 被 gitignore）
├── database.sqlite(+shm/wal) # 執行時產生的 SQLite 檔（gitignore）
├── src/
│   ├── database.js           # 開 DB、PRAGMA（WAL、foreign_keys=ON）、建表、seed admin 與 8 筆花卉商品。require 時即執行 initializeDatabase()；export db 實例
│   ├── middleware/
│   │   ├── authMiddleware.js     # 強制 JWT 驗證（Bearer）；驗證成功設定 req.user
│   │   ├── adminMiddleware.js    # 要求 req.user.role === 'admin'，必須接在 authMiddleware 之後
│   │   ├── sessionMiddleware.js  # 讀取 X-Session-Id header 存入 req.sessionId（全域掛載，不驗證）
│   │   └── errorHandler.js       # 全域錯誤處理，隱藏內部錯誤細節
│   ├── services/
│   │   └── ecpayService.js       # 綠界 AIO：CheckMacValue、建立付款表單參數、QueryTradeInfo 主動查詢
│   └── routes/
│       ├── authRoutes.js         # /api/auth：register / login / profile
│       ├── productRoutes.js      # /api/products：公開商品列表與詳情
│       ├── cartRoutes.js         # /api/cart：購物車（內含 dualAuth 雙模式認證）
│       ├── orderRoutes.js        # /api/orders：建立訂單、列表、詳情、綠界付款（checkout/query）、模擬付款（僅 mock 模式）
│       ├── adminProductRoutes.js # /api/admin/products：商品 CRUD（管理員）
│       ├── adminOrderRoutes.js   # /api/admin/orders：訂單列表與詳情（管理員，唯讀）
│       └── pageRoutes.js         # EJS 頁面路由（前台 7 頁 + 後台 2 頁）
├── views/
│   ├── layouts/front.ejs     # 前台外殼：header、<main>、footer、toast、載入 Vue/auth/api/notification/header-init 與 pageScript
│   ├── layouts/admin.ejs     # 後台外殼：admin-header、sidebar、載入 Vue/auth/api/notification，內嵌腳本執行 Auth.requireAdmin()
│   ├── partials/             # head（字體、/css/output.css）、header、footer、notification（toast 容器）、admin-header、admin-sidebar
│   └── pages/                # 各頁內容（Vue template）：index、product-detail、cart、checkout、login、orders、order-detail、404、admin/products、admin/orders
├── public/
│   ├── css/input.css         # Tailwind 4 入口 + @theme 色票（rose-primary、sage、apricot、cream…）。output.css 為建置產物（gitignore）
│   ├── stylesheets/style.css # express-generator 殘留的樣式，目前未被任何 layout 引用
│   └── js/
│       ├── auth.js           # 全域物件 Auth：localStorage 的 token/user/session id 管理、requireAuth/requireAdmin
│       ├── api.js            # 全域函式 apiFetch：統一帶 header、401 自動登出導向、非 2xx 以 { status, data } throw
│       ├── notification.js   # 全域物件 Notification.show(message, type)：3 秒 toast
│       ├── header-init.js    # 前台 header 初始化：登入狀態導覽列、購物車徽章（呼叫 GET /api/cart）
│       └── pages/            # 每頁一支 Vue createApp 腳本，檔名 = pageRoutes 傳入的 pageScript
└── tests/                    # Vitest + supertest 整合測試（見 TESTING.md）
```

### 前端載入順序（front.ejs）
`Vue CDN → auth.js → api.js → notification.js → header-init.js → pages/<pageScript>.js`。
`apiFetch` 依賴 `Auth`，所以 `auth.js` 必須在 `api.js` 前。admin layout 不載入 `header-init.js`。

## 3. 啟動流程

1. `node server.js`（或 `npm start`，後者先 `npm run css:build`）。
2. `server.js` → `require('./app')`：
   1. `dotenv.config()` 載入 `.env`。
   2. `require('./src/database')`：開啟/建立 `database.sqlite` → `journal_mode = WAL`、`foreign_keys = ON` → `CREATE TABLE IF NOT EXISTS` ×5 → `seedAdminUser()`（admin email 不存在才建立）→ `seedProducts()`（products 表為空才寫入 8 筆，單一 transaction）。
   3. 建立 Express app，設定 EJS、靜態檔、CORS、`express.json()`、`express.urlencoded({extended:false})`、`sessionMiddleware`。
   4. 掛載路由，順序見 §4；最後是 404 與 `errorHandler`。
3. `server.js` 僅在直接執行時檢查 `JWT_SECRET`（缺少則 `process.exit(1)`）並 `listen`。**注意**：被測試 require 時不會做此檢查，JWT_SECRET 由 `.env` 提供，缺少時簽發 token 會丟例外。

### 中介層順序（app.js）
`express.static(public)` → `cors({origin: FRONTEND_URL || 'http://localhost:3001'})` → `express.json()` → `express.urlencoded` → `sessionMiddleware` → API 路由 → `pageRoutes` → 404 → `errorHandler`。

### 路由掛載順序（重要）
```
/api/auth → /api/admin/products → /api/admin/orders → /api/products → /api/cart → /api/orders → / (pageRoutes)
```
`/api/admin/*` 掛在 `/api/products` 之前只是慣例；前綴不重疊，不影響比對。

## 4. API 路由總覽表

| 前綴 | 檔案 | 認證 | 說明 |
|------|------|------|------|
| `/api/auth` | authRoutes.js | `register`/`login` 無；`profile` 需 JWT | 註冊、登入、取得個人資料 |
| `/api/products` | productRoutes.js | 無（公開） | 商品列表（分頁）、商品詳情 |
| `/api/cart` | cartRoutes.js | **雙模式**：JWT 或 `X-Session-Id` | 取得/新增/修改數量/刪除購物車項目 |
| `/api/orders` | orderRoutes.js | JWT（`router.use(authMiddleware)`） | 由購物車建單、我的訂單列表/詳情、綠界付款表單與主動查詢、模擬付款（ECPay 啟用時 403） |
| `/api/admin/products` | adminProductRoutes.js | JWT + admin | 商品列表、新增、更新（部分欄位）、刪除 |
| `/api/admin/orders` | adminOrderRoutes.js | JWT + admin | 訂單列表（分頁 + 狀態篩選）、訂單詳情（含買家） |
| `/` | pageRoutes.js | 無（頁面外殼公開） | EJS 頁面；後台頁面的權限僅在瀏覽器端檢查 |

### 頁面路由
| 路徑 | 模板 | pageScript | 備註 |
|------|------|-----------|------|
| `/` | pages/index | index | 商品列表（每頁 9 筆） |
| `/products/:id` | pages/product-detail | product-detail | `productId` 以 `data-product-id` 傳給前端 |
| `/cart` | pages/cart | cart | |
| `/checkout` | pages/checkout | checkout | 未登入導向 `/login?redirect=...` |
| `/login` | pages/login | login | 登入/註冊分頁，支援 `?redirect=` |
| `/orders` | pages/orders | orders | |
| `/orders/:id` | pages/order-detail | order-detail | `?payment=return`（綠界 ClientBackURL）載入後自動查詢付款結果；`?payment=success\|failed\|cancel` 顯示付款結果橫幅 |
| `/admin/products` | pages/admin/products | admin-products | 使用 admin layout |
| `/admin/orders` | pages/admin/orders | admin-orders | 使用 admin layout |
| 其他 | pages/404 | — | 非 `/api` 路徑渲染 404 頁（HTTP 404） |

### 全部 API 端點速查
| Method | Path | 認證 | 成功碼 |
|--------|------|------|--------|
| POST | /api/auth/register | — | 201 |
| POST | /api/auth/login | — | 200 |
| GET | /api/auth/profile | JWT | 200 |
| GET | /api/products | — | 200 |
| GET | /api/products/:id | — | 200 |
| GET | /api/cart | JWT 或 Session | 200 |
| POST | /api/cart | JWT 或 Session | 200（新增與累加都是 200，非 201） |
| PATCH | /api/cart/:itemId | JWT 或 Session | 200 |
| DELETE | /api/cart/:itemId | JWT 或 Session | 200 |
| POST | /api/orders | JWT | 201 |
| POST | /api/orders/:id/ecpay/checkout | JWT | 200 |
| POST | /api/orders/:id/ecpay/query | JWT | 200 |
| GET | /api/orders | JWT | 200 |
| GET | /api/orders/:id | JWT | 200 |
| PATCH | /api/orders/:id/pay | JWT | 200 |
| GET | /api/admin/products | JWT+admin | 200 |
| POST | /api/admin/products | JWT+admin | 201 |
| PUT | /api/admin/products/:id | JWT+admin | 200 |
| DELETE | /api/admin/products/:id | JWT+admin | 200 |
| GET | /api/admin/orders | JWT+admin | 200 |
| GET | /api/admin/orders/:id | JWT+admin | 200 |

## 5. 統一回應格式

**所有 `/api/*` 回應（含 404 與全域錯誤）一律為三欄位物件**：`{ data, error, message }`。

成功：
```json
{ "data": { "...": "..." }, "error": null, "message": "成功" }
```
失敗：
```json
{ "data": null, "error": "VALIDATION_ERROR", "message": "price 必須為正整數" }
```

- `error` 是**機器可讀的錯誤碼**（字串），成功時為 `null`；`message` 是繁體中文人類可讀訊息。前端以 `err.data.message` 顯示 toast。
- 分頁清單的 `data` 為 `{ <複數名詞>: [...], pagination: { total, page, limit, totalPages } }`。
- 錯誤碼清單：`VALIDATION_ERROR`、`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`STOCK_INSUFFICIENT`、`CART_EMPTY`、`INVALID_STATUS`、`PAYMENT_AMOUNT_MISMATCH`、`PAYMENT_QUERY_FAILED`、`RATE_LIMITED`、`INTERNAL_ERROR`。
- **陷阱**：`errorHandler` 不論狀態碼一律回 `error: 'INTERNAL_ERROR'`（即使 `err.status` 是 400/404）。只有 `statusCode === 500` 時 message 固定為「伺服器內部錯誤」；其他狀態碼若 `err.isOperational` 為真才回 `err.message`，否則回 `SAFE_MESSAGES` 對照文字。目前沒有任何程式碼設定 `isOperational`，路由皆自行 `res.status().json()`。
- 未匹配的 `/api/*` 路徑回 `404 { data:null, error:'NOT_FOUND', message:'找不到該路徑' }`。

## 6. 認證與授權機制

### 6.1 JWT
| 項目 | 值 |
|------|----|
| 演算法 | HS256（簽發為預設 HS256；驗證時明確限制 `algorithms: ['HS256']`） |
| 密鑰 | `process.env.JWT_SECRET`（必填） |
| 有效期 | `7d`（register 與 login 皆為 `expiresIn: '7d'`） |
| Payload | `{ userId, email, role, iat, exp }` |
| 傳遞方式 | `Authorization: Bearer <token>` |
| 前端儲存 | `localStorage['flower_token']`、`localStorage['flower_user']`（JSON） |

### 6.2 authMiddleware（`src/middleware/authMiddleware.js`）
1. 無 `Authorization` 或不是 `Bearer ` 開頭 → `401 UNAUTHORIZED 請先登入`。
2. `jwt.verify` 失敗（簽章錯、過期、格式錯）→ `401 Token 無效或已過期`。
3. 驗證通過後**再查 DB** `SELECT id FROM users WHERE id = ?`；使用者已被刪除 → `401 使用者不存在，請重新登入`。
4. 設定 `req.user = { userId, email, role }`，其中 **`role` 取自 token，不重查 DB**。→ 若 DB 內使用者角色變更，舊 token 在到期前仍帶舊角色。

### 6.3 adminMiddleware
`!req.user || req.user.role !== 'admin'` → `403 FORBIDDEN 權限不足`。後台路由以 `router.use(authMiddleware, adminMiddleware)` 整個 router 套用。

### 6.4 sessionMiddleware 與雙模式認證（僅購物車）
- `sessionMiddleware` 全域執行：若有 `X-Session-Id` header 就設定 `req.sessionId`，**不驗證格式或來源**。
- `cartRoutes.js` 內部的 `dualAuth` 才是決定性邏輯：
  1. 有 `Authorization: Bearer` → 走 JWT 驗證（同 6.2，含查 DB）；**只要帶了 Bearer 但 token 無效就直接 401，不會 fallback 到 session**。
  2. 沒有 Bearer 但有 `req.sessionId` → 放行（訪客）。
  3. 兩者皆無 → `401 請提供有效的登入 Token 或 X-Session-Id`。
- `getOwnerCondition(req)`：有 `req.user` → 以 `user_id` 查詢；否則以 `session_id`。**同一個瀏覽器登入前後使用不同的購物車**（見 FEATURES.md「購物車」）。
- 前端 `Auth.getAuthHeaders()` **每個請求都同時帶 Bearer（若已登入）與 `X-Session-Id`**；session id 為 `crypto.randomUUID()`，存於 `localStorage['flower_session_id']`。

### 6.5 前端權限檢查（僅 UX，非安全邊界）
- `Auth.requireAuth()`：未登入 → 導向 `/login?redirect=<目前路徑>`。
- `Auth.requireAdmin()`：未登入或 `user.role !== 'admin'`（讀 localStorage）→ 導向 `/login`。
- **後台頁面 HTML 任何人都可取得**（`pageRoutes` 無認證）；真正的保護是 `/api/admin/*` 的 JWT+admin 檢查。
- `apiFetch` 收到任何 401 → 清除 localStorage 的 token/user 並 `location.href = '/login'`（見 §9 陷阱）。

## 7. 資料庫 Schema

連線設定：`journal_mode = WAL`、`foreign_keys = ON`。所有 id 為 `uuid v4` 字串（TEXT）；時間為 SQLite `datetime('now')` 產生的 UTC 字串 `YYYY-MM-DD HH:MM:SS`（無時區標記）。金額一律為**整數（新台幣元）**。

### users
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| email | TEXT | UNIQUE NOT NULL（區分大小寫） |
| password_hash | TEXT | NOT NULL（bcrypt） |
| name | TEXT | NOT NULL |
| role | TEXT | NOT NULL DEFAULT 'user'，CHECK IN ('user','admin') |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |

### products
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| name | TEXT | NOT NULL |
| description | TEXT | 可為 NULL |
| price | INTEGER | NOT NULL，CHECK(price > 0) |
| stock | INTEGER | NOT NULL DEFAULT 0，CHECK(stock >= 0) |
| image_url | TEXT | 可為 NULL |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |
| updated_at | TEXT | NOT NULL DEFAULT datetime('now')（PUT 時手動更新） |

### cart_items
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| session_id | TEXT | 可為 NULL（訪客購物車用） |
| user_id | TEXT | 可為 NULL，FK → users(id) |
| product_id | TEXT | NOT NULL，FK → products(id) |
| quantity | INTEGER | NOT NULL DEFAULT 1，CHECK(quantity > 0) |

> `session_id` 與 `user_id` 互斥由應用層保證（INSERT 只寫其中一欄），**資料庫沒有 CHECK 約束，也沒有 UNIQUE(owner, product_id)**；「同商品只一列」靠應用層先查再寫。

### orders
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| order_no | TEXT | UNIQUE NOT NULL，格式 `ORD-YYYYMMDD-XXXXX`（XXXXX = uuid 前 5 碼大寫） |
| user_id | TEXT | NOT NULL，FK → users(id) |
| recipient_name | TEXT | NOT NULL |
| recipient_email | TEXT | NOT NULL |
| recipient_address | TEXT | NOT NULL |
| total_amount | INTEGER | NOT NULL（**商品小計，不含運費**） |
| status | TEXT | NOT NULL DEFAULT 'pending'，CHECK IN ('pending','paid','failed') |
| merchant_trade_no | TEXT | 綠界特店交易編號（UNIQUE index；每次發起付款重新產生） |
| ecpay_trade_no | TEXT | 綠界交易編號（查詢確認已付款後寫入） |
| payment_type | TEXT | 綠界付款方式（如 `Credit_CreditCard`） |
| paid_at | TEXT | 綠界回報付款時間 |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') |

> 舊資料庫由 `migrateOrdersForEcpay()` 以 `PRAGMA table_info` + `ALTER TABLE` 補欄位。

### order_items
| 欄位 | 型別 | 約束 |
|------|------|------|
| id | TEXT | PRIMARY KEY |
| order_id | TEXT | NOT NULL，FK → orders(id) |
| product_id | TEXT | NOT NULL（**無 FK**，商品刪除後訂單明細仍保留） |
| product_name | TEXT | NOT NULL（下單當下快照） |
| product_price | INTEGER | NOT NULL（下單當下快照） |
| quantity | INTEGER | NOT NULL |

### 關聯與刪除行為
```
users 1──n orders 1──n order_items        (order_items.product_id 僅記錄，無 FK)
users 1──n cart_items n──1 products       (cart_items.session_id 訪客)
```
- 因 `foreign_keys = ON` 且 `cart_items.product_id` 有 FK、無 `ON DELETE`，**刪除一個仍在任何購物車中的商品會觸發 `SQLITE_CONSTRAINT_FOREIGNKEY`，被 Express 當成未處理錯誤回 500**（已實測驗證 FK 行為；admin DELETE 只檢查 pending 訂單，不檢查購物車）。
- 訂單明細存「快照」欄位（`product_name`、`product_price`），所以商品改價/改名/刪除不影響歷史訂單。

### Seed 資料
- Admin：`ADMIN_EMAIL`（預設 `admin@hexschool.com`）/ `ADMIN_PASSWORD`（預設 `12345678`），name = `Admin`，role = `admin`；bcrypt rounds：`NODE_ENV === 'test'` 為 1，否則 10。已存在同 email 則略過（**不會更新密碼**）。
- 商品：products 表**完全為空**時才寫入 8 筆（粉色玫瑰花束 1680、白色百合花禮盒 1280、繽紛向日葵花束 980、紫色鬱金香盆栽 750、乾燥花藝術花圈 1450、迷你多肉組合盆 580、經典紅玫瑰花束 3980、季節鮮花訂閱 890），圖片為 Unsplash 外連。

## 8. 訂單與付款流程（金流）

### 綠界 ECPay AIO（信用卡）+ 主動查詢驗證
本專案僅在本機執行，綠界無法呼叫 ReturnURL（Server Notify），因此**付款結果由後端主動呼叫 `QueryTradeInfo/V5` 驗證**，不實作 callback 接收端。`ECPAY_MERCHANT_ID/HASH_KEY/HASH_IV` 未設定時退回「模擬付款」。

```
購物車 ──POST /api/orders──► 建單（status=pending，扣庫存）
訂單頁「前往綠界付款」──POST /api/orders/:id/ecpay/checkout──► { action, params(含 CheckMacValue) }
前端動態 form POST ──► 綠界 AioCheckOut/V5 ──消費者付款──► 按「返回商店」(ClientBackURL)
/orders/:id?payment=return ──自動 POST /api/orders/:id/ecpay/query──► QueryTradeInfo/V5
     驗 CheckMacValue + TradeAmt == total_amount ──► TradeStatus 1→paid / 10200095→failed / 其他→維持 pending
```
- 環境：`ECPAY_ENV=staging` → `payment-stage.ecpay.com.tw`，`production` → `payment.ecpay.com.tw`；測試卡 `4311-9522-2222-2222`、3D 驗證碼 `1234`。
- 只支援 `ChoosePayment=Credit`。ATM／超商代碼／條碼屬離線付款，主動查詢不適用（官方建議等 Server Notify）。
- 查詢節流：同一訂單 5 秒冷卻；綠界高頻查詢會回 403 並封鎖 30 分鐘。
- `ReturnURL` 為佔位網址（AIO 必填），不會被實作。使用者付款後若未返回網站，訂單維持 pending，可按「查詢付款結果」。

### 共通規則
- **庫存在「建單」時扣除**，不是付款時。`failed` 訂單**不會回補庫存**，也沒有取消訂單的 API。
- `failed` 是終態；`pending`（含綠界回報未付款）可重新按「前往綠界付款」，會產生新的 `merchant_trade_no`。
- mock 模式：`PATCH /api/orders/:id/pay { action: 'success' | 'fail' }`，ECPay 啟用時回 403。

### 金額一致性陷阱
- 前端 `checkout.ejs` 顯示「運費：小計 ≥ 500 免運，否則 NT$ 150」，並顯示含運費總額；
- 後端 `total_amount` **只有商品小計**，不含運費，且送綠界的 `TotalAmount` 即此值。結帳頁顯示總額在小計 < 500 時比實際刷卡金額多 150。上線前必須先決定以誰為準。

## 9. 前端架構與陷阱

- 每頁一個 Vue 3 Composition API `createApp({ setup() {...} }).mount('#app')`；模板直接寫在 EJS 裡（Vue `{{ }}` 與 EJS `<%= %>` 不衝突，因為 EJS 只處理 `<% %>`）。
- 伺服器傳給前端的值只有透過 `data-*` 屬性：`data-product-id`、`data-order-id`、`data-payment-result`。
- 全域變數（非模組）：`Auth`、`apiFetch`、`Notification`（**會遮蔽瀏覽器內建 `Notification` API**，本專案不使用瀏覽器通知）。
- **401 陷阱**：`apiFetch` 對任何 401 都清除登入資訊並導向 `/login`。因此登入失敗（`POST /api/auth/login` 回 401「Email 或密碼錯誤」）時，`apiFetch` 在導向後 `return undefined`，`login.js` 隨即在 `res.data.token` 丟 TypeError 進入 catch，只會閃現通用的「登入失敗」toast（`err.data.message` 為 undefined，伺服器的「Email 或密碼錯誤」文字拿不到），接著頁面重新載入。新增「預期會回 401 的呼叫」時要繞過 `apiFetch` 或調整此行為。
- 購物車徽章數字 = 購物車**項目種類數**（`items.length`），加入購物車後前端以 +1 樂觀更新（累加同商品時徽章會多算，重新載入頁面後恢復）。
- `Auth.logout()` 只清 token/user，**保留** `flower_session_id`。
- Tailwind：`public/css/output.css` 是建置產物且被 gitignore；`npm run dev:server` **不會**產生它，首次或改動 `input.css`/模板 class 後需 `npm run css:build`（`npm start` 已包含）。
- Vue 以 `https://unpkg.com/vue@3/...` 載入，需要外網；字體來自 Google Fonts。

## 10. 關鍵知識點（影響跨模組整合者）

1. 回應格式 `{data,error,message}` 是前後端契約，新增 API 必須遵守，前端 `err.data.message` 依賴它。
2. 購物車有兩種擁有者（user_id / session_id）；**登入不會合併訪客購物車**。
3. `req.user.role` 來自 JWT 而非 DB。
4. 庫存只在建單時檢查與扣除；加入購物車只做「購物車數量 ≤ 當前庫存」的軟檢查，不保留庫存。
5. 付款為綠界 AIO（信用卡）+ 主動 QueryTradeInfo 驗證；未設定 `ECPAY_*` 時退回模擬付款。
6. 資料庫在 `require('./src/database')` 時立即初始化（副作用），測試與 app 共用同一個 `database.sqlite`。
7. 訂單 `total_amount` 不含運費。
