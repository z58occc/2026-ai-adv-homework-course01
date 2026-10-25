# 串接綠界 ECPay AIO 金流（本地端 + 主動查詢驗證）

## User Story
身為會員，我想要在訂單頁以信用卡透過綠界付款，以便真實完成付款而不是按模擬按鈕。
身為開發者，因為專案僅在本機執行、綠界無法回呼（Server Notify），我需要由後端主動呼叫 `QueryTradeInfo/V5` 驗證付款結果。

## Spec

### 流程
```
訂單頁「前往綠界付款」
  → POST /api/orders/:id/ecpay/checkout   回傳 { action, params }（含 CheckMacValue）
  → 前端建立 <form method=POST> 送往綠界 AioCheckOut/V5
  → 消費者付款後按「返回商店」(ClientBackURL) → /orders/:id?payment=return
  → 前端自動 POST /api/orders/:id/ecpay/query
  → 後端呼叫 QueryTradeInfo/V5，驗 CheckMacValue + 金額 → pending → paid / failed
```

### API
- `POST /api/orders/:id/ecpay/checkout`（JWT，限本人 pending 訂單）→ `data: { action, params }`；每次呼叫重新產生 `merchant_trade_no`。
- `POST /api/orders/:id/ecpay/query`（JWT，限本人訂單）→ `data: { ...order, items, trade_status }`。
  - `TradeStatus=1` → `paid`；`10200095` → `failed`；`0` → 維持 `pending`。
  - `TradeAmt !== total_amount` → `400 PAYMENT_AMOUNT_MISMATCH`，不更新。
  - 綠界 403／逾時／CMV 不符 → `502 PAYMENT_QUERY_FAILED`。同訂單 5 秒冷卻。
- `GET /api/orders/:id` 新增 `payment_provider: 'ecpay' | 'mock'`。
- `PATCH /api/orders/:id/pay`：僅在 `ECPAY_MERCHANT_ID` 未設定（mock 模式）時可用，否則 `403 FORBIDDEN`。

### 資料表變更（orders）
新增 `merchant_trade_no`（UNIQUE index）、`ecpay_trade_no`、`payment_type`、`paid_at`；以 `PRAGMA table_info` 判斷後 `ALTER TABLE`。

### 相容性與風險
- 不影響購物車（訪客／會員）。
- `ChoosePayment=Credit`（信用卡一次付清）；ATM／超商屬離線付款，不適用主動查詢。
- `TotalAmount` 使用 `total_amount`（不含運費，維持既有行為）。
- ReturnURL 為佔位（綠界打不到 localhost，亦不實作）。
- 使用者付款後若未返回網站，訂單維持 pending，需手動「查詢付款結果」。

## Tasks
- [x] 後端：`src/services/ecpayService.js`（CMV、建立參數、QueryTradeInfo）
- [x] 後端：`src/database.js` 新增 orders 欄位
- [x] 後端：`orderRoutes.js` checkout / query / payment_provider / pay 限制 + OpenAPI
- [x] 前端：order-detail 頁綠界付款與查詢
- [x] 設定：`.env.example`
- [x] 測試：`tests/ecpay.test.js`（mock fetch），加入 `vitest.config.js`
- [x] 文件：FEATURES / ARCHITECTURE / DEVELOPMENT / TESTING / CHANGELOG，完成後移至 `plans/archive/`
