# TESTING.md — 測試規範與指南

## 1. 技術與執行方式

- 框架：**Vitest 2**（`globals: true`，不需 import `describe/it/expect/beforeAll`）+ **supertest**（直接把 Express `app` 丟給 `request(app)`，不佔用 port）。
- 指令：`npm test`（= `vitest run`）。單檔：`npx vitest run tests/cart.test.js`。
- 最近一次執行結果：7 個檔案、44 個測試全數通過（約 4 秒）。
- 前置條件：根目錄有 `.env` 且含 `JWT_SECRET`（`app.js` 載入 dotenv；測試不會經過 `server.js` 的 JWT_SECRET 檢查，缺少時註冊/登入會因簽章失敗而出錯）。

### vitest.config.js 重點
| 設定 | 值 | 原因 |
|------|----|------|
| `globals` | `true` | 測試檔直接使用 `describe/it/expect` |
| `fileParallelism` | `false` | 所有測試檔共用同一個 SQLite 檔，必須串行 |
| `sequence.files` | auth → products → cart → orders → ecpay → adminProducts → adminOrders | 固定檔案執行順序 |
| `hookTimeout` | `10000` | `beforeAll` 內有註冊/下單等較慢操作（bcrypt） |

> Vitest 會自動把 `NODE_ENV` 設為 `test`，所以 seed admin 用 bcrypt 1 round；測試內註冊的使用者仍走 `authRoutes` 的 10 rounds。

## 2. 測試檔案表

| 檔案 | 測試數 | 涵蓋範圍 | 依賴 |
|------|--------|----------|------|
| `tests/setup.js` | — | 輔助函式與 `app`/`request` 匯出（不是測試檔） | — |
| `tests/auth.test.js` | 6 | 註冊成功、重複 Email 409、登入成功（admin）、錯誤密碼 401、帶 token 取 profile、無 token 取 profile 401 | 檔內 `userToken` 由第 1 個測試產生，**第 5 個測試依賴它** |
| `tests/products.test.js` | 4 | 列表、分頁（`page=1&limit=2`）、詳情、不存在 404 | 需有 seed 商品；`productId` 由第 1 個測試取得，後續測試依賴 |
| `tests/cart.test.js` | 6 | 訪客：新增/取得/改數量/刪除並確認清空；會員：新增；加入不存在商品 404 | `beforeAll` 取第一個商品；`cartItemId` 在測試間傳遞 |
| `tests/orders.test.js` | 6 | 建單（201、status pending）、空購物車 400、無 token 401、訂單列表、訂單詳情、不存在 404 | `beforeAll` 註冊使用者並加入購物車；第 2 個測試依賴第 1 個已清空購物車 |
| `tests/ecpay.test.js` | 12 | CMV 官方測試向量與竄改偵測；checkout 參數與簽章、他人訂單 404；query：未發起付款 400、TradeStatus 0 維持 pending + 429 節流、1→paid 且冪等、10200095→failed、金額不符、CMV 錯誤/HTTP 403 → 502；ECPay 啟用時 `/pay` 403 | 以 `vi.spyOn(global,'fetch')` mock 綠界、`Date.now` 推進以避開節流；**不打真實網路**；依賴 `.env` 的 `ECPAY_*` |
| `tests/adminProducts.test.js` | 6 | 列表、新增、更新、刪除（並確認前台 404）、一般使用者 403、無 token 401 | `beforeAll` 取 admin token（seed admin） |
| `tests/adminOrders.test.js` | 4 | 列表、`status=pending` 篩選、詳情（含 `user`）、一般使用者 403 | `beforeAll`：註冊 → 加入購物車 → 建單 |

**未覆蓋**：mock 模式的 `PATCH /api/orders/:id/pay` 成功路徑、`GET /api/auth/profile` 的已刪除使用者情境、商品庫存不足、購物車累加、購物車 token 無效、`PUT` 驗證錯誤、`DELETE` 受 pending 訂單阻擋（409）、購物車 FK 導致的 500、分頁邊界、頁面路由（EJS）與前端 JS。新增相關功能時優先補這些。

## 3. 執行順序與依賴關係

```
auth ─► products ─► cart ─► orders ─► ecpay ─► adminProducts ─► adminOrders
```
- 順序由 `vitest.config.js` 固定；**每個檔案獨立註冊自己需要的使用者**，檔案之間沒有資料共享，順序主要是為了可預期性與減少鎖競爭。
- **檔案內的 `it` 依序執行且互相依賴**（例如 `cartItemId`、`orderId`、`userToken` 以閉包變數傳遞）。單獨用 `-t` 只跑其中一個 `it` 會因前置變數為 `undefined` 而失敗。
- 新增測試檔必須加進 `sequence.files`，否則會以預設順序執行。

## 4. ⚠️ 資料庫共用（最重要的陷阱）

- **測試使用與開發相同的 `database.sqlite`**（`src/database.js` 寫死路徑 `../database.sqlite`，沒有測試專用資料庫或清理機制）。
- 後果：
  1. 每次跑測試都會在你的開發資料庫新增使用者（`test-<ts>-<rand>@example.com`、`auth-test-<ts>@example.com`）與訂單。
  2. 訂單測試會**真的扣庫存**（每次對 `products[0]` 扣 1~2 件，seed 庫存有限）。長期反覆執行後第一個商品可能庫存耗盡，導致 `orders`／`adminOrders` 的 `beforeAll` 加入購物車失敗、測試連鎖失敗。
  3. 若要乾淨環境：停止 server，刪除 `database.sqlite`、`database.sqlite-shm`、`database.sqlite-wal`，重新啟動或重跑測試（會重新 seed）。
- 測試中的商品取法是 `products[0]`（`created_at DESC` 的第一筆；seed 商品同秒建立，順序可能不固定），因此測試**不可假設特定商品名稱**。
- 若要引入隔離：可讓 `database.js` 在 `NODE_ENV === 'test'` 時改用 `:memory:` 或暫存檔（目前未實作），並同步更新本文件。

## 5. 輔助函式（`tests/setup.js`）

```js
const { app, request, getAdminToken, registerUser } = require('./setup');
```

| 匯出 | 說明 |
|------|------|
| `app` | `require('../app')`（Express app，已初始化 DB） |
| `request` | supertest 的 `request` 函式；用法 `request(app).get('/api/...')` |
| `getAdminToken()` | 以寫死的 `admin@hexschool.com / 12345678` 登入並回傳 JWT 字串；假設 seed admin 使用預設憑證 |
| `registerUser(overrides?)` | 註冊新使用者，回傳 `{ token, user }`。`overrides` 可含 `email`、`password`（預設 `password123`）、`name`（預設「測試使用者」）。email 預設為 `test-<Date.now()>-<隨機>@example.com`，避免 409 衝突 |

> `registerUser` 若註冊失敗（例如 JWT_SECRET 缺失導致 500），`res.body.data` 為 `null`，會在讀取 `.token` 時丟 TypeError——看到此錯誤先檢查 `.env`。

## 6. 撰寫新測試的步驟

1. 在 `tests/<領域>.test.js` 建立檔案（camelCase）。
2. 第一行引入輔助函式；`describe('<領域> API', () => { ... })`。
3. 在 `beforeAll` 準備前置資料（取 admin token、註冊使用者、取得商品 id、加入購物車…）。
4. 每個 `it` 以 `should ...` 命名（現有風格為英文句子），先斷言 HTTP 狀態，再斷言三欄位格式。
5. 把檔案加到 `vitest.config.js` 的 `sequence.files` 對應位置。
6. 執行 `npx vitest run tests/<領域>.test.js`，再跑整套 `npm test`。

### 範例：測試模擬付款
```js
const { app, request, registerUser } = require('./setup');

describe('Order Pay API', () => {
  let token;
  let orderId;

  beforeAll(async () => {
    ({ token } = await registerUser());
    const prod = await request(app).get('/api/products');
    const productId = prod.body.data.products[0].id;

    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: 1 });

    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        recipientName: '付款測試',
        recipientEmail: 'pay@example.com',
        recipientAddress: '台北市測試路 1 號',
      });
    orderId = order.body.data.id;
  });

  it('should mark order as paid', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'success' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('status', 'paid');
  });

  it('should reject paying a non-pending order', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'success' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'INVALID_STATUS');
  });
});
```

### 常用斷言模式
```js
// 成功
expect(res.status).toBe(200);
expect(res.body).toHaveProperty('error', null);
// 失敗
expect(res.status).toBe(404);
expect(res.body).toHaveProperty('data', null);
expect(res.body.error).not.toBeNull();   // 或精確比對錯誤碼：toHaveProperty('error', 'NOT_FOUND')
```

### 訪客購物車測試
以 `.set('X-Session-Id', 'test-session-' + Date.now())` 代替 Authorization；每個 `describe` 使用獨一無二的 session id。

## 7. 常見陷阱

1. **共用 DB 與庫存耗盡**（§4）。測試失敗且訊息為「庫存不足」時，先重建資料庫。
2. **`it` 之間有狀態依賴**：不要用 `it.only`/`-t` 單跑中間的案例；也不要隨意調整 `it` 順序。
3. **不要用固定 email 註冊**（會 409）；一律用 `registerUser()` 的隨機 email。
4. **價格/庫存必須用 JSON 數字**：`.send({ price: '500' })` 會被 API 以 400 拒絕。
5. **401 vs 403**：沒帶 token → 401；有 token 但非 admin → 403。
6. **購物車回傳碼**：新增購物車項目成功是 `200`，不是 `201`；建立訂單與商品才是 `201`。
7. **使用 `Date.now()` 產生唯一值**時，同一毫秒內連續呼叫可能重複，`registerUser` 已加隨機後綴，自行產生時也要加。
8. **bcrypt 較慢**：大量註冊會拖慢測試，`hookTimeout` 已放寬到 10 秒；若 `beforeAll` 逾時，請減少註冊次數。
9. 測試只涵蓋 API；EJS 頁面與前端 JS 沒有自動化測試，需手動驗證（`npm start` 後以瀏覽器操作）。
10. 修改 seed admin 憑證（`.env`）會使 `getAdminToken()` 失敗。
