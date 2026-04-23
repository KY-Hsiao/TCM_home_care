# Legacy Python 骨架

此資料夾保留原始 Python / Tkinter 起始骨架。

目前內容：

- `app.py`：舊版 Tkinter 示範入口
- `launch_legacy_app.ps1`：舊版 PowerShell 啟動腳本

Web MVP 已成為主要入口；根目錄的 `app.py` 與 `launch_app.ps1` 現在都會啟動 React + Vite 版本，避免誤跑到舊版畫面。
