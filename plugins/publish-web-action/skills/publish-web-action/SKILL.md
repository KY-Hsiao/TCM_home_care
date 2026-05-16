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
2. 若使用者是透過 Codex 動作列的 `推送 GitHub` 或 `更新網頁` 執行，該動作會加上 `-CommitPendingChanges`，先自動建立一筆發布 commit。
   - Codex 動作列的 `更新網頁` 會加上 `-NoWaitForGitHubActions`，push 後直接結束，避免本機長時間等待 GitHub Actions 造成動作列看似當掉。
3. 若手動執行 `npm run publish:web` 且有未提交修改，先明確告知使用者「發布只會包含已提交內容」。
4. 發布腳本會停用 Git/GitHub CLI 的互動式提示；若 GitHub 認證失效，應要求使用者先在 Codex 外修正登入狀態，再重試發布。
   - `git push`、`gh` 查詢與 Vercel deploy hook 都有單步 timeout，避免網路或認證流程卡住時讓 Codex 看起來當掉。
   - GitHub Actions 等待期間會週期性輸出仍在等待的訊息；若超過等待上限，會以明確錯誤中止。
5. 發布命令優先使用短流程：

```powershell
npm run publish:web
```

   - 這個 npm script 會呼叫 `.codex/scripts/update_web.ps1`，只負責 commit/push，並讓 GitHub push workflow 在線上接續觸發 Vercel。

6. 若要讓命令列也先提交目前工作區修改，可改用：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\publish_github_and_vercel.ps1 -CommitPendingChanges
```

7. `-SkipVercel` 模式只會推送目前 branch 到 GitHub，push 成功後直接結束；不要等待 GitHub Actions，也不要觸發 Vercel。
8. 完整發布流程會：
   - 推送目前 branch 到 GitHub
   - 以低輸出輪詢等待 `deploy-vercel.yml` 的 `Deploy to Vercel` GitHub Actions run
   - 若 push 沒有產生新的 workflow run，會改用 `workflow_dispatch` 主動觸發一次
   - 若本機也設定 `VERCEL_DEPLOY_HOOK_URL`，會額外直接觸發 Vercel deploy hook
   - 若任一步驟逾時，會停止該外部程序並回報「網路或認證」檢查方向，而不是無限等待
   - 若加上 `-NoWaitForGitHubActions`，腳本會在 GitHub push 完成後結束；Vercel 由 GitHub push workflow 在線上接續觸發
9. 若 `VERCEL_DEPLOY_HOOK_URL` 未設定，需明確告知：
   - GitHub push 可以完成
   - GitHub Actions 若成功，代表線上 deploy hook 已被 workflow 呼叫
   - 但本機不能額外補打 Vercel deploy hook
10. 發布完成後回報：
   - 推送的 branch
   - 是否已成功 push GitHub
   - GitHub Actions `Deploy to Vercel` 是否成功
   - 是否有從本機額外觸發 Vercel deploy hook

## Notes

- 這個插件不會創建 Codex 桌面程式右上角的原生固定按鈕。
- 它提供的是「Codex 側可重用的發布動作入口」與一致流程。
- 若 Vercel 已和 GitHub `main` 自動同步，GitHub Actions 成功後會觸發 Vercel；Vercel 站台實際完成仍需等待 Vercel 平台建置完成。
