function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

async function triggerGitHubWorkflow() {
  const token = process.env.GITHUB_DEPLOY_TOKEN;
  const owner = process.env.GITHUB_DEPLOY_OWNER;
  const repo = process.env.GITHUB_DEPLOY_REPO;
  const workflowId = process.env.GITHUB_DEPLOY_WORKFLOW_ID || "deploy-vercel.yml";
  const ref = process.env.GITHUB_DEPLOY_BRANCH || "main";

  if (!token || !owner || !repo) {
    return {
      triggered: false
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub workflow 觸發失敗：${response.status} ${detail}`);
  }

  return {
    triggered: true,
    message: `已觸發 GitHub workflow：${workflowId}（${ref}）`
  };
}

async function triggerVercelHook() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    return {
      triggered: false
    };
  }

  const response = await fetch(hookUrl, {
    method: "POST"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vercel deploy hook 觸發失敗：${response.status} ${detail}`);
  }

  return {
    triggered: true,
    message: "已直接觸發 Vercel 部署。"
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const configuredSecret = process.env.DEPLOY_SYNC_SHARED_SECRET;
  if (!configuredSecret) {
    setJson(response, 503, {
      error: "尚未設定 DEPLOY_SYNC_SHARED_SECRET，無法啟用線上更新按鈕。"
    });
    return;
  }

  const suppliedSecret = request.body?.secret;
  if (typeof suppliedSecret !== "string" || suppliedSecret !== configuredSecret) {
    setJson(response, 401, {
      error: "部署密碼不正確。"
    });
    return;
  }

  try {
    const githubResult = await triggerGitHubWorkflow();
    if (githubResult.triggered) {
      setJson(response, 200, {
        ok: true,
        mode: "github_workflow",
        message: `${githubResult.message}，後續將由 workflow 接續觸發 Vercel。`
      });
      return;
    }

    const vercelResult = await triggerVercelHook();
    if (vercelResult.triggered) {
      setJson(response, 200, {
        ok: true,
        mode: "vercel_hook",
        message: vercelResult.message
      });
      return;
    }

    setJson(response, 503, {
      error: "尚未設定 GitHub workflow 或 Vercel deploy hook，無法同步更新線上版本。"
    });
  } catch (error) {
    setJson(response, 502, {
      error: error instanceof Error ? error.message : "線上更新失敗。"
    });
  }
}
