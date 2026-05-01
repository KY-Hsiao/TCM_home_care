# 中醫居家輔助系統 MVP

這個專案已轉為 `React + TypeScript + Vite + Tailwind CSS` 的 Web MVP，提供中醫居家服務的排程、追蹤、聯絡與回院病歷流程介面。

目前已包含：

- 居家醫師介面骨架
- 行政管理介面骨架
- 家屬 `Google Chat` 模組預留
- 共用資料模型、enum、時間規則
- local mock repository 與 SQLite-ready 結構
- 完整 seed data
- 通知模板 / 通知任務模組
- 地圖與定位模組預留
- `Vercel Frontend + api/ Serverless Functions + Neon` 的團隊通訊正式同步架構

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

## Vercel 正式部署

目前專案採用適合 Vercel 的結構：

- 前端：`React + Vite`
- Serverless API：根目錄 `api/`
- 正式共享資料庫：`Neon（可透過 Vercel Marketplace 整合）`

### 團隊通訊正式同步

團隊通訊在部署環境下，會自動從本機 `localStorage` 模式切到 `HTTP API` 模式：

- 正式 API：`/api/team-communications`
- 未讀數 API：`/api/team-communications/unread-count`
- 已讀 API：`/api/team-communications/:id/read`

目前這條正式共享資料流已先套用在 `團隊通訊`。  
排程、個案、定位、病歷等其他模組，若尚未另外改接正式 API，仍會維持既有 mock / `localStorage` 行為。

若要在本機強制模擬正式同步模式，可設定：

```powershell
$env:VITE_TEAM_COMM_SYNC_MODE = "http"
```

### Vercel 需要的設定

1. 在 Vercel 專案中加入 `Neon`
   並確認環境內有 `DATABASE_URL` 或 `POSTGRES_URL` 可供 serverless API 使用。

2. 確認 Vercel 專案已連到這個 GitHub repository。

3. 在 GitHub repository secrets 新增：

   - `VERCEL_DEPLOY_HOOK_URL`

   這個值請使用 Vercel 專案的 Deploy Hook URL。  
   加入後，本 repo 會提供兩種同步部署方式：

   - `push` 到 `main` 時，自動觸發 `.github/workflows/deploy-vercel.yml`
   - 在 GitHub Actions 頁面手動按 `Deploy to Vercel`

4. 若要啟用行政端頁面裡的 `更新到 GitHub / Vercel` 按鈕，請再設定：

   - `DEPLOY_SYNC_SHARED_SECRET`

   並視需求補齊以下其中一組：

   - GitHub workflow 觸發：
     - `GITHUB_DEPLOY_TOKEN`
     - `GITHUB_DEPLOY_OWNER`
     - `GITHUB_DEPLOY_REPO`
     - `GITHUB_DEPLOY_WORKFLOW_ID`（可省略，預設 `deploy-vercel.yml`）
     - `GITHUB_DEPLOY_BRANCH`（可省略，預設 `main`）
   - 或 Vercel direct deploy：
     - `VERCEL_DEPLOY_HOOK_URL`

### 行政端頁面內的線上更新按鈕

行政端 `角色設置` 頁現在已新增 `更新到 GitHub / Vercel` 區塊。  
這顆按鈕會由 serverless API 代為觸發部署流程，因此不會把部署 secret 暴露在前端。

要注意：

- 它只能重新部署 **已經在 GitHub 遠端上的版本**
- 不能把你本機尚未 `git push` 的程式碼直接送上線

### 本機一鍵推送 GitHub 並同步觸發 Vercel

若你希望在本機直接完成「推 GitHub + 觸發 Vercel」，可先設定環境變數：

```powershell
$env:VERCEL_DEPLOY_HOOK_URL = "你的 deploy hook URL"
```

然後執行：

```powershell
npm run publish:web
```

這個腳本會：

- 將目前 branch `git push` 到 GitHub
- 成功後立刻呼叫 Vercel deploy hook

預設只允許在 `main` 觸發這個流程，避免把非正式 branch 誤送到線上。  
若你確定要從其他 branch 觸發，可加上：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\publish_github_and_vercel.ps1 -AllowNonProductionBranch
```

若只想推 GitHub、不想觸發 Vercel，也可執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\publish_github_and_vercel.ps1 -SkipVercel
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
- `api`：Vercel Serverless Functions

## Legacy Python 骨架

原本的 Python 起始骨架已搬到 `legacy-python/`，其中：

- `legacy-python/app.py`：舊版 Tkinter 示範
- `legacy-python/launch_legacy_app.ps1`：舊版啟動腳本

根目錄的 Web 啟動以 `launch_app.ps1` 為主；若需要 Python 版啟動輔助腳本，請使用 `run_web_mvp.py`。為避免部署平台誤判成 Python 後端，根目錄不再保留 `app.py`。
