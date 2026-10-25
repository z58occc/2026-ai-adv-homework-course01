# CLAUDE.md

## 專案概述
花漾生活 Flower Life — Node.js + Express 4 + better-sqlite3（SQLite）+ EJS 外殼 / Vue 3（CDN）+ Tailwind CSS 4 的花卉電商 Demo；JWT 認證、訪客/會員雙模式購物車、模擬付款、管理員後台；測試為 Vitest + supertest。

## 常用指令
```bash
npm install            # 安裝依賴
cp .env.example .env   # 首次：至少設定 JWT_SECRET
npm start              # css:build + node server.js（預設 http://localhost:3001）
npm run dev:server     # 只啟動 server（需先有 public/css/output.css）
npm run dev:css        # Tailwind watch
npm run css:build      # 建置 public/css/output.css
npm run openapi        # 產生 openapi.json
npm test               # vitest run（6 檔 32 測試）
```

## 關鍵規則
- 後端一律 CommonJS；DB 為 better-sqlite3 **同步 API**，SQL 用 `?` 參數化，多表寫入包 `db.transaction`。
- 所有 `/api/*` 回應必須是 `{ data, error, message }`（成功 `error: null`，失敗 `data: null` + 錯誤碼字串 + 繁體中文 message）；請求 body 用 camelCase、回應欄位用 snake_case。
- 購物車使用雙模式認證（JWT 或 `X-Session-Id`），**登入不會合併訪客購物車**；`req.user.role` 取自 JWT，不重查 DB；後台頁面權限只在前端檢查，真正保護在 `/api/admin/*`。
- 付款是模擬的（`PATCH /api/orders/:id/pay`），`ECPAY_*`/`BASE_URL` 尚未使用；庫存於「建單」時扣除；訂單 `total_amount` 不含運費。
- 測試與開發共用同一個 `database.sqlite`，測試檔須依 `vitest.config.js` 的 `sequence.files` 順序且不可平行；新增測試檔要加入該清單。
- 功能開發使用 docs/plans/ 記錄計畫；完成後移至 docs/plans/archive/（命名 `YYYY-MM-DD-<feature-name>.md`，結構 User Story → Spec → Tasks），並更新 FEATURES.md 與 CHANGELOG.md。

## 詳細文件
- ./docs/README.md — 項目介紹與快速開始
- ./docs/ARCHITECTURE.md — 架構、目錄結構、資料流
- ./docs/DEVELOPMENT.md — 開發規範、命名規則
- ./docs/FEATURES.md — 功能列表與完成狀態
- ./docs/TESTING.md — 測試規範與指南
- ./docs/CHANGELOG.md — 更新日誌

@docs/README.md
@docs/ARCHITECTURE.md
@docs/DEVELOPMENT.md
@docs/FEATURES.md
@docs/TESTING.md
@docs/CHANGELOG.md
