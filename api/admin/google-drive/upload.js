function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeFilename(value) {
  const filename = String(value ?? "").trim();
  return filename || "居家個案病例紀錄.html";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const accessToken = String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN ?? "").trim();
  const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  if (!isRequiredString(accessToken) || !isRequiredString(folderId)) {
    setJson(response, 503, {
      reason: "GOOGLE_DRIVE_ENV_MISSING",
      error: "尚未設定 GOOGLE_DRIVE_ACCESS_TOKEN 或 GOOGLE_DRIVE_FOLDER_ID，無法上傳到 Google Drive。"
    });
    return;
  }

  const filename = normalizeFilename(request.body?.filename);
  const html = String(request.body?.html ?? "");
  if (!isRequiredString(html)) {
    setJson(response, 400, {
      reason: "HTML_MISSING",
      error: "缺少要上傳的 HTML 內容。"
    });
    return;
  }

  const metadata = {
    name: filename,
    mimeType: "text/html",
    parents: [folderId]
  };
  const delimiter = "tcm_home_care_boundary";
  const body = [
    `--${delimiter}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${delimiter}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
    `--${delimiter}--`
  ].join("\r\n");

  try {
    const driveResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${delimiter}`
        },
        body
      }
    );
    const payload = await driveResponse.json().catch(() => ({}));
    if (!driveResponse.ok) {
      setJson(response, 502, {
        reason: payload.error?.status ?? `HTTP_${driveResponse.status}`,
        error: payload.error?.message ?? `Google Drive 上傳失敗：HTTP ${driveResponse.status}`
      });
      return;
    }

    setJson(response, 200, {
      ok: true,
      id: payload.id ?? null,
      name: payload.name ?? filename,
      webViewLink: payload.webViewLink ?? null
    });
  } catch (error) {
    setJson(response, 502, {
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : "呼叫 Google Drive API 失敗。"
    });
  }
}
