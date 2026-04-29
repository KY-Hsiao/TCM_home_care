# 中醫居家醫療輔助系統 MVP

這個專案已轉為 `React + TypeScript + Vite + Tailwind CSS` 的 Web MVP，提供中醫居家醫療的排程、追蹤、聯絡與回院病歷流程介面。

目前已包含：

- 居家醫師介面骨架
- 行政管理介面骨架
- 家屬 `Google Chat` 模組預留
- 共用資料模型、enum、時間規則
- local mock repository 與 SQLite-ready 結構
- 完整 seed data
- 通知模板 / 通知任務模組
- 地圖與定位模組預留

## 技術棧

- React 19
- TypeScript
- Vite
- Tailwind CSS
- React Router
- React Hook Form
- Zod
- TanStack Table
- date-fns

## 啟動方式

1. 執行專案 setup

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\.codex\scripts\setup.ps1
   ```

   這個 setup 會完成三件事：

   - 建立 `.venv`
   - 將前端依賴固定準備在 `C:\codex-deps\tcm-home-care`，供雲端同步路徑下的驗證副本共用

2. 如需直接在目前資料夾補齊前端套件，也可以另外執行：

   ```powershell
   npm install
   ```

3. 啟動開發模式

   ```powershell
   npm run dev
   ```

   如果你是從 VS Code / Codex 的「執行應用程式」或工作列按鈕啟動，現在預設也會走 Web MVP，而不是舊的 Python/Tkinter 示範。
   若專案位於 `G:` 之類的雲端同步磁碟，`launch_app.ps1` 會自動同步到 `C:\codex-deps\tcm-home-care-verify` 後再啟動，避免 `node_modules` 寫入失敗。
   若 `5173` 已被其他 Vite 程序占用，啟動器會自動改用下一個可用 port，避免直接啟動失敗。

4. 進行型別檢查

   ```powershell
   npm run typecheck
   ```

5. 執行測試

   ```powershell
   npm run test
   ```

6. 建置正式版

   ```powershell
   npm run build
   ```

## 路徑注意事項

若專案放在雲端同步資料夾或含特殊路徑限制的磁碟下，根目錄直接執行 `npm install` 可能會因 `node_modules` 大量寫檔而失敗。現在預設建議先跑 `.codex\scripts\setup.ps1`，它會把共用依賴固定準備在 `C:\codex-deps\tcm-home-care`，並讓 `launch_app.ps1` 把驗證副本同步到 `C:\codex-deps\tcm-home-care-verify` 後再啟動。

## 權限與持續允許建議

若你在 Codex / VS Code 內希望減少批准視窗，建議把下列高頻命令設為持續允許：

- `powershell -ExecutionPolicy Bypass -File .\launch_app.ps1`
- `Start-Process 'http://127.0.0.1:5173/'`
- `Start-Process chrome.exe '--new-window http://127.0.0.1:5173/'`
- `npm install`
- `py -3.13 -m venv .venv`
- 與 `C:\codex-deps\tcm-home-care`、`C:\codex-deps\tcm-home-care-verify` 有關的既有同步與啟動流程

下列項目則建議保留人工確認：

- `git push -u origin HEAD` 與其他 push 類命令
- `gh auth login`、`gh auth logout`
- 變更 git remote
- 破壞性 git / shell 操作，例如 `reset --hard`、大量刪除、清到未知路徑的 cache

## 主要頁面

- `/`：角色選擇
- `/demo-overview`：系統總覽與 seed 資料摘要
- `/doctor/*`：醫師端
- `/admin/*`：行政端
- `/chat/family/*`：家屬 Google Chat 入口預留
- `/maps/*`：地圖與定位預留

## 資料層說明

- `src/domain`：資料模型、enum、rules、repository contract
- `src/data/seed`：完整假資料
- `src/data/mock`：local mock repository 與瀏覽器儲存

## Legacy Python 骨架

原本的 Python 起始骨架已搬到 `legacy-python/`，其中：

- `legacy-python/app.py`：舊版 Tkinter 示範
- `legacy-python/launch_legacy_app.ps1`：舊版啟動腳本

根目錄的 Web 啟動以 `launch_app.ps1` 為主；若需要 Python 版啟動輔助腳本，請使用 `run_web_mvp.py`。為避免部署平台誤判成 Python 後端，根目錄不再保留 `app.py`。
