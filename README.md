# TCM Home Care

這是一個新的 Python 專案起始骨架，已包含下列內容：

- 本地 `.venv` 開發環境
- 可直接啟動的桌面介面
- 一個本地可按的「執行動作」按鈕
- GitHub Actions 的手動執行按鈕

## 本地啟動

1. 建立虛擬環境

   ```powershell
   py -3.13 -m venv .venv
   ```

2. 安裝需求

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. 啟動程式

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\launch_app.ps1
   ```

## GitHub Actions 手動執行

推送到 GitHub 後，在 `Actions` 頁面選擇 `Manual Run` 工作流程，就會看到手動執行按鈕。按下後會執行：

```powershell
python app.py --cli --message "GitHub Actions 手動執行完成" --repeat-count 1
```

執行結果會輸出到：

- 本地預設：系統暫存資料夾中的 `TCM_home_care/latest_run.txt`
- GitHub Actions：`artifacts/latest_run.txt`
- GitHub Actions artifact `latest-run`

## 連接 GitHub

若本機尚未登入 GitHub CLI，先執行：

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

目前這個工作區已完成：

- `git init -b main`
- `git remote add origin https://github.com/KY-Hsiao/TCM_home_care.git`
- 初始 commit `Initial project setup`

完成登入後，可以直接建立 GitHub 倉庫並推送：

```powershell
gh repo create TCM_home_care --public --source . --remote origin --push
```

如果你已經先在 GitHub 網站手動建立同名倉庫，則改用：

```powershell
git push -u origin main
```
