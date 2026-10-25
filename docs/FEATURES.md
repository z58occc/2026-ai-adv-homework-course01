# FEATURES.md — 功能清單與行為描述

狀態圖例：✅ 已完成　🟡 部分完成／有已知限制　⬜ 未實作

所有 API 回應格式皆為 `{ data, error, message }`（見 ARCHITECTURE.md §5）。分頁參數通用規則：
`page = max(1, parseInt(page) || 1)`；`limit = clamp(parseInt(limit) || 10, 1, 100)`（非數字或 0 → 預設 10，超過 100 → 100）；回傳 `pagination: { total, page, limit, totalPages }`。

## 功能總表

| 區塊 | 功能 | 狀態 |
|------|------|------|
| 認證 | 註冊 / 登入 / 取得個人資料 | ✅ |
| 認證 | 登出（前端清除 localStorage） | ✅ |
| 認證 | 修改個人資料 / 密碼 / 忘記密碼 | ⬜ |
| 商品 | 前台商品列表（分頁）、商品詳情 | ✅ |
| 商品 | 搜尋 / 分類 / 排序 | ⬜ |
| 購物車 | 訪客（Session）與會員（JWT）雙模式購物車 | ✅ |
| 購物車 | 登入後合併訪客購物車 | ⬜ |
| 訂單 | 由購物車建立訂單（transaction 扣庫存） | ✅ |
| 訂單 | 我的訂單列表 / 詳情 | ✅ |
| 訂單 | 模擬付款（success / fail） | 🟡（未串接 ECPay；failed 不可重試、不回補庫存） |
| 訂單 | 取消訂單 / 運費計入金額 | ⬜ |
| 後台 | 商品管理（列表 / 新增 / 編輯 / 刪除） | 🟡（刪除會被購物車 FK 卡住） |
| 後台 | 訂單管理（列表 / 狀態篩選 / 詳情） | ✅（唯讀） |
| 後台 | 訂單狀態手動修改、使用者管理 | ⬜ |
| 文件 | OpenAPI 產生（`npm run openapi`） | ✅ |
| 金流 | ECPay 串接 | ⬜（僅有 `.env` 設定佔位） |

---

## 1. 認證（`/api/auth`）

### POST `/api/auth/register`
- **Body**（皆必填）：`email`、`password`、`name`。
- **驗證順序**與錯誤：
  1. 任一欄位缺漏（falsy）→ `400 VALIDATION_ERROR「email、password、name 為必填欄位」`
  2. Email 不符 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → `400「Email 格式不正確」`
  3. `password.length < 6` → `400「密碼至少需要 6 個字元」`
  4. Email 已存在（精確比對，區分大小寫）→ `409 CONFLICT「Email 已被註冊」`
- **行為**：bcrypt（10 rounds，同步 `hashSync`）雜湊密碼；role 固定為 `user`（無法由請求指定）；成功即簽發 7 天 JWT，**註冊後直接視為登入**。
- **回應 201**：`data: { user: { id, email, name, role }, token }`，message「註冊成功」。

### POST `/api/auth/login`
- **Body**：`email`、`password`（必填，缺漏 → `400 VALIDATION_ERROR「email 和 password 為必填欄位」`）。
- 找不到使用者與密碼錯誤**回傳相同訊息**（防帳號枚舉）：`401 UNAUTHORIZED「Email 或密碼錯誤」`。
- **回應 200**：`data: { user: { id, email, name, role }, token }`，message「登入成功」。
- 前端行為：成功後 `Auth.login(token, user)`，導向 `?redirect=` 參數或 `/`。注意前端 401 會被 `apiFetch` 攔截（見 ARCHITECTURE.md §9）。

### GET `/api/auth/profile`（需 JWT）
回傳 `data: { id, email, name, role, created_at }`。token 有效但使用者不存在 → authMiddleware 先回 401；（理論上不會到達的）`404「使用者不存在」`。

---

## 2. 商品（前台，公開）

### GET `/api/products`
- **查詢參數**：`page`（預設 1）、`limit`（預設 10，上限 100）。首頁前端使用 `limit=9`。
- 排序：`created_at DESC`。**seed 商品同秒寫入，彼此順序不保證穩定**。
- 回傳完整商品列（含 `description`、`stock`、`image_url`、`created_at`、`updated_at`）。

### GET `/api/products/:id`
- 找不到 → `404 NOT_FOUND「商品不存在」`。
- 前端商品詳情頁：數量選擇器上限為 `stock`；`stock` 為 0 時仍可嘗試加入但會被 API 擋下（`STOCK_INSUFFICIENT`）。

### 前台頁面
首頁含 hero 區與 3 欄商品卡片（點卡片進詳情、卡片上有「加入購物車」按鈕，固定數量 1）；分頁以頁碼按鈕呈現。

---

## 3. 購物車（`/api/cart`）

### 雙模式認證（非標準機制）
| 請求帶了 | 行為 |
|----------|------|
| `Authorization: Bearer <有效 JWT>` | 以 `user_id` 操作「會員購物車」（同時帶 `X-Session-Id` 也一樣忽略 session） |
| `Authorization: Bearer <無效/過期 JWT>` | **直接 401**，不會退回 session 模式 |
| 只有 `X-Session-Id` | 以 `session_id` 操作「訪客購物車」 |
| 都沒有 | `401「請提供有效的登入 Token 或 X-Session-Id」` |

- 會員 JWT 通過後仍會查 DB 確認使用者存在，否則 `401「使用者不存在，請重新登入」`。
- **訪客購物車與會員購物車是兩份獨立資料**。使用者以訪客身分加入商品、再登入後，購物車會「變空」（原訪客項目仍留在 DB，以 session_id 存在，登出後又會看到）。目前**沒有合併邏輯**。
- 所有項目級操作（PATCH/DELETE）以 `id AND (user_id|session_id) = owner` 查詢，**不能操作別人的項目**（回 404 而非 403）。

### GET `/api/cart`
回傳 `data: { items: [{ id, product_id, quantity, product: { name, price, stock, image_url } }], total }`；`total = Σ price × quantity`（以商品**當前**價格計算）。購物車為空時 `items: []`、`total: 0`。

### POST `/api/cart`
- **Body**：`productId`（必填）、`quantity`（選填，預設 1）。
- `quantity` 以 `parseInt` 解析（`"2abc"` → 2；`"abc"` → NaN），必須 ≥ 1 整數，否則 `400 VALIDATION_ERROR「quantity 必須為正整數」`。
- 商品不存在 → `404「商品不存在」`。
- **累加邏輯**：同一擁有者已有該商品 → `newQty = 原數量 + qty`；`newQty > stock` → `400 STOCK_INSUFFICIENT「庫存不足」`，否則更新該列。沒有該商品 → `qty > stock` 同樣擋下，否則新增一列。
- 成功**一律回 200**（新增也不是 201），`data: { id, product_id, quantity }`（quantity 為累加後數量），message「已加入購物車」。

### PATCH `/api/cart/:itemId`
- **Body**：`quantity`（必填，解析規則同上；是「設定為」而非累加）。
- 項目不屬於呼叫者或不存在 → `404「購物車項目不存在」`；`qty > stock` → `400 STOCK_INSUFFICIENT`。
- 回傳 `data: { id, product_id, quantity }`，message「數量已更新」。

### DELETE `/api/cart/:itemId`
不存在/非己有 → 404；成功 `data: null`，message「已從購物車移除」。

### 前端行為
- 購物車頁調整數量 `qty < 1` 時直接忽略（不呼叫 API）；刪除前有確認視窗；結帳按鈕在未登入時導向 `/login?redirect=/checkout`。
- 購物車徽章在 `header-init.js` 以 `GET /api/cart` 的 `items.length` 初始化。

---

## 4. 訂單（`/api/orders`，全部需 JWT）

### POST `/api/orders` — 由購物車建立訂單
- **Body**（皆必填）：`recipientName`、`recipientEmail`、`recipientAddress`。缺漏 → `400 VALIDATION_ERROR「收件人姓名、Email 和地址為必填欄位」`；Email 格式錯 → `400「Email 格式不正確」`。
- **只讀取會員購物車**（`cart_items.user_id = 目前使用者`），訪客購物車不參與。
- 流程與錯誤：
  1. 購物車為空 → `400 CART_EMPTY「購物車為空」`
  2. 任一項目 `quantity > 當前 stock` → `400 STOCK_INSUFFICIENT「以下商品庫存不足：A, B」`
  3. `total_amount = Σ price × quantity`（**不含運費**）
  4. `order_no = ORD-<UTC yyyymmdd>-<uuid 前 5 碼大寫>`
  5. **單一 SQLite transaction**（`db.transaction`）：寫入 `orders`（status=pending）→ 每個項目寫入 `order_items`（快照 name/price）並 `UPDATE products SET stock = stock - qty` → `DELETE FROM cart_items WHERE user_id = ?`。任何一步丟例外則整體回滾。
- 庫存檢查在 transaction **之外**；better-sqlite3 同步執行且單進程，實務上不會交錯，但若改成多進程或非同步驅動需把檢查移入 transaction。商品表有 `CHECK(stock >= 0)` 作為最後防線（違反時 transaction 回滾並回 500）。
- **回應 201**：`data: { id, order_no, total_amount, status: 'pending', items: [{ product_name, product_price, quantity }], created_at }`，message「訂單建立成功」。

### GET `/api/orders`
只回傳自己的訂單，`created_at DESC`，**無分頁**。`data: { orders: [{ id, order_no, total_amount, status, created_at }] }`。

### GET `/api/orders/:id`
以 `id AND user_id` 查詢；不存在或屬於他人 → `404 NOT_FOUND「訂單不存在」`。回傳 `data: { ...order 全欄位, items: [order_items 全欄位] }`。

### PATCH `/api/orders/:id/pay` — 模擬付款
- **Body**：`action` 必須為 `"success"`（→ `paid`）或 `"fail"`（→ `failed`），否則 `400 VALIDATION_ERROR「action 必須為 success 或 fail」`。
- 訂單不存在/非己有 → 404；`status !== 'pending'` → `400 INVALID_STATUS「訂單狀態不是 pending，無法付款」`。
- 成功回 `data: { ...order, items }`，message「付款成功」或「付款失敗」。
- **限制**：這是無需任何憑證的狀態切換端點，任何登入者可把自己的 pending 訂單標為已付款。串接真實金流時必須移除或改為金流 callback 驗簽。`failed` 為終態，庫存不回補。

### 訂單狀態機
```
pending ──(action=success)──► paid     （終態）
   └──────(action=fail)─────► failed   （終態）
```

### 前台頁面
- `/checkout`：載入購物車，若空則導回 `/cart`；前端驗證三欄位與 Email 格式；成功後導向 `/orders/<id>`。頁面另顯示運費（小計 ≥ 500 免運，否則 NT$150），**此運費未送進後端**。
- `/orders`：訂單卡片列表，狀態標籤 待付款/已付款/付款失敗。
- `/orders/:id`：明細 + pending 時顯示「模擬付款成功／失敗」按鈕；`?payment=` 查詢參數預設顯示對應橫幅。

---

## 5. 後台商品管理（`/api/admin/products`，JWT + admin）

所有路由先經 `authMiddleware` 再 `adminMiddleware`：未帶 token → 401；一般使用者 → `403 FORBIDDEN「權限不足」`。

### GET `/`
`page`/`limit` 同通用規則，`created_at DESC`，回 `data: { products, pagination }`。

### POST `/`
- **Body**：`name`（必填，falsy 則 400「name 為必填欄位」）、`price`（必填，**必須是 JSON 數字型態的正整數**，字串 `"500"` 會被拒絕）、`stock`（必填，非負整數，**0 合法**）、`description`、`image_url`（選填，缺省存 NULL）。
- 錯誤皆 `400 VALIDATION_ERROR`：「price 必須為正整數」「stock 必須為非負整數」。
- 回 `201`，`data` 為完整商品列，message「商品新增成功」。

### PUT `/:id` — 部分更新
- 雖然是 PUT，**所有欄位皆選填**；未提供的欄位保留原值（`undefined` 才算未提供；可傳 `null`/空字串覆蓋 `description`、`image_url`）。
- 商品不存在 → `404「商品不存在」`（在驗證前檢查）。
- 驗證：提供 `name` 時 `name.trim() === ''` → `400「商品名稱不能為空」`（**若 name 非字串，`.trim` 會丟例外 → 500**）；`price`、`stock` 規則同 POST。
- 更新時同步 `updated_at = datetime('now')`。message「商品更新成功」。

### DELETE `/:id`
- 不存在 → 404。
- 若該商品出現在任何 **`pending` 訂單**的明細中 → `409 CONFLICT「此商品存在未完成的訂單，無法刪除」`。`paid`/`failed` 訂單不阻擋（明細有快照，無 FK）。
- **已知缺陷**：未檢查 `cart_items`。商品若在任何人（含訪客）購物車中，`DELETE` 會觸發外鍵約束錯誤，回傳 500「伺服器內部錯誤」。
- 成功 `data: null`，message「商品刪除成功」。

### 後台頁面（`/admin/products`）
表格 + 新增/編輯 modal + 刪除確認視窗。前端驗證僅檢查 `name` 非空與 `price > 0`；`price`、`stock` 輸入框使用 `v-model.number`，確保送出的是數字型態（API 拒絕字串）；改動表單時需保留此修飾詞。庫存輸入若被清空，`v-model.number` 會得到空字串而被 API 拒絕。儲存失敗只顯示通用「儲存失敗」，不顯示 API message。

---

## 6. 後台訂單管理（`/api/admin/orders`，JWT + admin）

### GET `/`
- **查詢參數**：`page`、`limit`（通用規則）、`status`（選填，僅接受 `pending|paid|failed`；**其他值被靜默忽略**，等同不篩選）。
- 排序 `created_at DESC`；回 `data: { orders: [orders 全欄位], pagination }`（含 `recipient_*`、`user_id`，不含明細）。

### GET `/:id`
- 不存在 → `404「訂單不存在」`（不限擁有者）。
- 回 `data: { ...order, items: [...], user: { name, email } | null }`（買家已被刪除時為 null）。

### 後台頁面（`/admin/orders`）
狀態下拉篩選（切換即回第 1 頁）、分頁、點列開啟明細 modal（買家、收件資訊、商品明細、總計）。**後台無法更改訂單狀態**。

---

## 7. 後台權限與導覽（非 API）

- `layouts/admin.ejs` 在 `DOMContentLoaded` 執行 `Auth.requireAdmin()`：未登入或非 admin 導向 `/login`；通過時顯示使用者名稱。
- 前台 header 對 admin 顯示「後台管理」連結（`header-init.js`）。
- 這只是 UX；API 層才是真正保護。

## 8. OpenAPI 文件

`npm run openapi` 讀取 `src/routes/*.js` 中的 `@openapi` JSDoc，輸出專案根目錄 `openapi.json`（未被 gitignore，也沒有 Swagger UI 路由）。新增 API 時需同步寫 `@openapi` 註解（格式見 DEVELOPMENT.md）。

## 9. 已知問題與待辦（來自程式碼審閱）

| # | 問題 | 影響 | 位置 |
|---|------|------|------|
| 1 | 登入後不合併訪客購物車 | 使用者體驗：登入前加的商品「消失」 | cartRoutes.js |
| 2 | 結帳頁顯示運費，後端金額不含運費 | 金額不一致 | checkout.ejs vs orderRoutes.js |
| 3 | 商品在購物車時刪除 → 500 | 後台刪除失敗 | adminProductRoutes.js / schema FK |
| 4 | `apiFetch` 對登入失敗的 401 也強制導向 | 看不到伺服器錯誤訊息 | public/js/api.js |
| 5 | `pay` 端點無金流驗證；failed 不可重試且不回補庫存 | 僅適用 Demo | orderRoutes.js |
| 6 | PUT 商品 `name` 非字串 → 500 | 輸入驗證不完整 | adminProductRoutes.js |
| 7 | `errorHandler` 一律回 `error: 'INTERNAL_ERROR'` | 4xx 的錯誤碼不準確 | errorHandler.js |
| 8 | ECPay 環境變數未使用 | 金流未實作 | .env.example |
