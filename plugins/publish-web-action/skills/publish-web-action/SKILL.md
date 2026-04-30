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

4. 發布流程會：
   - 推送目前 branch 到 GitHub
   - 等待 `deploy-vercel.yml` 的 `Deploy to Vercel` GitHub Actions run
   - 若本機也設定 `VERCEL_DEPLOY_HOOK_URL`，會額外直接觸發 Vercel deploy hook
5. 若 `VERCEL_DEPLOY_HOOK_URL` 未設定，需明確告知：
   - GitHub push 可以完成
   - GitHub Actions 若成功，代表線上 deploy hook 已被 workflow 呼叫
   - 但本機不能額外補打 Vercel deploy hook
6. 發布完成後回報：
   - 推送的 branch
   - 是否已成功 push GitHub
   - GitHub Actions `Deploy to Vercel` 是否成功
   - 是否有從本機額外觸發 Vercel deploy hook

## Notes

- 這個插件不會創建 Codex 桌面程式右上角的原生固定按鈕。
- 它提供的是「Codex 側可重用的發布動作入口」與一致流程。
- 若 Vercel 已和 GitHub `main` 自動同步，GitHub Actions 成功後會觸發 Vercel；Vercel 站台實際完成仍需等待 Vercel 平台建置完成。
