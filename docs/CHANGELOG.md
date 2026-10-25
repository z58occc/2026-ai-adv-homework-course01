# CHANGELOG

格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/)。新增條目時置於 `[Unreleased]` 下，發佈/完成計畫時移到具日期的區段，並同步更新 [FEATURES.md](./FEATURES.md)。

## [Unreleased]

（目前無待發佈項目。已知待辦見 FEATURES.md §9。）

## [2026-10-25] — 文件建立

### Added
- 建立 `CLAUDE.md` 與 `docs/` 文件集：README、ARCHITECTURE、DEVELOPMENT、FEATURES、TESTING、CHANGELOG。
- 建立 `docs/plans/` 與 `docs/plans/archive/`（含 `.gitkeep`）作為計畫與歸檔目錄。
- 文件中記錄程式碼審閱發現的已知問題（FEATURES.md §9）：訪客購物車不合併、運費與訂單金額不一致、商品在購物車中無法刪除（500）、`apiFetch` 401 處理、模擬付款限制等。

## [1.0.0] — 初始版本（commit `004e507 init`）

### Added
- **認證**：註冊、登入、取得個人資料；JWT（HS256，7 天）；bcrypt 密碼雜湊；seed 管理員帳號。
- **商品**：公開商品列表（分頁）與詳情；8 筆花卉 seed 商品。
- **購物車**：訪客（`X-Session-Id`）與會員（JWT）雙模式；加入累加、改數量、刪除；庫存檢查。
- **訂單**：由購物車建單（transaction：建單 + 明細快照 + 扣庫存 + 清購物車）；我的訂單列表/詳情；模擬付款（success / fail）。
- **後台**：商品列表/新增/部分更新/刪除（含 pending 訂單保護）；訂單列表（狀態篩選、分頁）與詳情。
- **前端**：EJS layout + Vue 3 頁面（首頁、商品詳情、購物車、結帳、登入/註冊、訂單列表/詳情、後台商品/訂單）；Tailwind 4 主題色票。
- **基礎設施**：全域錯誤處理、統一 `{ data, error, message }` 回應、CORS、OpenAPI 產生腳本、Vitest + supertest 測試（6 檔 32 測試）。
