---
name: publish-web-action
description: 從 Codex 側執行目前專案的 Web 發布流程，將已提交版本推到 GitHub，並沿用既有設定同步更新 Vercel。
---

# Publish Web Action

## Use when

- 使用者明確要求「更新到線上」、「推 GitHub 並同步 Vercel」、「執行發布動作」。
- 需要從 Codex 側執行目前專案的既有發布命令。

## Required behavior

1. 先檢查目前工作樹是否有未提交修改。
2. 若有未提交修改，先明確告知使用者「發布只會包含已提交內容」。
3. 發布命令優先使用：

```powershell
npm run publish:web
```

4. 若 `VERCEL_DEPLOY_HOOK_URL` 未設定，需明確告知：
   - GitHub push 可以完成
   - 但無法從本機額外補打 Vercel deploy hook
5. 發布完成後回報：
   - 推送的 branch
   - 是否已成功 push GitHub
   - 是否有成功觸發 Vercel

## Notes

- 這個插件不會創建 Codex 桌面程式右上角的原生固定按鈕。
- 它提供的是「Codex 側可重用的發布動作入口」與一致流程。
- 若 Vercel 已和 GitHub `main` 自動同步，即使本機沒有 deploy hook，push 後線上仍可能自動更新。
