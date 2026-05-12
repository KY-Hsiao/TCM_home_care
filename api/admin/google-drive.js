import {
  formatGoogleDriveApiError,
  resolveGoogleDriveAccessToken
} from "../_lib/google-drive-auth.js";

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

function resolveQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeDriveQueryValue(value) {
  return value.replace(/'/g, "\\'");
}

function resolveRecordFolderIds(defaultFolderId) {
  const raw = String(
    process.env.GOOGLE_DRIVE_RECORDS_FOLDER_ID ??
      process.env.GOOGLE_DRIVE_OLD_RECORDS_FOLDER_ID ??
      defaultFolderId ??
      ""
  );
  return raw
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFolderQuery(folderIds) {
  const parentQuery = folderIds
    .map((folderId) => `'${escapeDriveQueryValue(folderId)}' in parents`)
    .join(" or ");
  return `(${parentQuery}) and trashed = false and mimeType = 'text/html'`;
}

async function fetchDriveJson(url, accessToken) {
  const driveResponse = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await driveResponse.json().catch(() => ({}));
  return { driveResponse, payload };
}

async function resolveDriveAuth(response, missingFolderMessage) {
  const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  if (!isRequiredString(folderId)) {
    setJson(response, 503, {
      reason: "GOOGLE_DRIVE_ENV_MISSING",
      error: missingFolderMessage
    });
    return null;
  }

  const auth = await resolveGoogleDriveAccessToken();
  if (!auth.ok) {
    setJson(response, auth.statusCode, {
      reason: auth.reason,
      error: auth.error
    });
    return null;
  }

  return { folderId, accessToken: auth.accessToken };
}

async function handleUpload(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const driveAuth = await resolveDriveAuth(
    response,
    "尚未設定 GOOGLE_DRIVE_FOLDER_ID，無法上傳到 Google Drive。"
  );
  if (!driveAuth) {
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
    parents: [driveAuth.folderId]
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
          Authorization: `Bearer ${driveAuth.accessToken}`,
          "Content-Type": `multipart/related; boundary=${delimiter}`
        },
        body
      }
    );
    const payload = await driveResponse.json().catch(() => ({}));
    if (!driveResponse.ok) {
      setJson(
        response,
        driveResponse.status === 401 ? 401 : 502,
        formatGoogleDriveApiError(
          payload,
          `Google Drive 上傳失敗：HTTP ${driveResponse.status}`,
          driveResponse.status
        )
      );
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

async function handleRecords(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const driveAuth = await resolveDriveAuth(
    response,
    "尚未設定 GOOGLE_DRIVE_FOLDER_ID，無法讀取 Google Drive 病歷檔。"
  );
  if (!driveAuth) {
    return;
  }

  const recordFolderIds = resolveRecordFolderIds(driveAuth.folderId);
  if (!recordFolderIds.length) {
    setJson(response, 503, {
      reason: "GOOGLE_DRIVE_RECORDS_FOLDER_MISSING",
      error: "尚未設定舊病歷資料夾。請設定 GOOGLE_DRIVE_RECORDS_FOLDER_ID、GOOGLE_DRIVE_OLD_RECORDS_FOLDER_ID 或 GOOGLE_DRIVE_FOLDER_ID。"
    });
    return;
  }

  const fileId = String(resolveQueryValue(request.query?.fileId) ?? "").trim();

  try {
    if (!fileId) {
      const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
      listUrl.searchParams.set("q", buildFolderQuery(recordFolderIds));
      listUrl.searchParams.set("fields", "files(id,name,modifiedTime,webViewLink,size,parents),nextPageToken");
      listUrl.searchParams.set("orderBy", "modifiedTime desc");
      listUrl.searchParams.set("pageSize", "100");

      const { driveResponse, payload } = await fetchDriveJson(listUrl.toString(), driveAuth.accessToken);
      if (!driveResponse.ok) {
        setJson(
          response,
          driveResponse.status === 401 ? 401 : 502,
          formatGoogleDriveApiError(
            payload,
            `Google Drive 檔案清單讀取失敗：HTTP ${driveResponse.status}`,
            driveResponse.status
          )
        );
        return;
      }

      setJson(response, 200, {
        ok: true,
        folderIds: recordFolderIds,
        files: Array.isArray(payload.files) ? payload.files : []
      });
      return;
    }

    const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    metadataUrl.searchParams.set("fields", "id,name,mimeType,parents,modifiedTime,webViewLink");
    const { driveResponse: metadataResponse, payload: metadata } = await fetchDriveJson(
      metadataUrl.toString(),
      driveAuth.accessToken
    );
    if (!metadataResponse.ok) {
      setJson(
        response,
        metadataResponse.status === 401 ? 401 : 502,
        formatGoogleDriveApiError(
          metadata,
          `Google Drive 檔案資訊讀取失敗：HTTP ${metadataResponse.status}`,
          metadataResponse.status
        )
      );
      return;
    }
    if (
      !Array.isArray(metadata.parents) ||
      !metadata.parents.some((parentId) => recordFolderIds.includes(parentId))
    ) {
      setJson(response, 404, {
        reason: "DRIVE_FILE_NOT_IN_RECORDS_FOLDER",
        error: "指定的 Google Drive 檔案不在設定的病歷資料夾中。"
      });
      return;
    }

    const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    mediaUrl.searchParams.set("alt", "media");
    const contentResponse = await fetch(mediaUrl.toString(), {
      headers: {
        Authorization: `Bearer ${driveAuth.accessToken}`
      }
    });
    const html = await contentResponse.text().catch(() => "");
    if (!contentResponse.ok) {
      setJson(
        response,
        contentResponse.status === 401 ? 401 : 502,
        formatGoogleDriveApiError(
          {},
          `Google Drive 病歷檔下載失敗：HTTP ${contentResponse.status}`,
          contentResponse.status
        )
      );
      return;
    }

    setJson(response, 200, {
      ok: true,
      file: {
        id: metadata.id ?? fileId,
        name: metadata.name ?? "",
        modifiedTime: metadata.modifiedTime ?? null,
        webViewLink: metadata.webViewLink ?? null
      },
      html
    });
  } catch (error) {
    setJson(response, 502, {
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : "呼叫 Google Drive API 失敗。"
    });
  }
}

export default async function handler(request, response) {
  const action = String(resolveQueryValue(request.query?.action) ?? "").trim();
  if (action === "upload") {
    await handleUpload(request, response);
    return;
  }
  if (action === "records") {
    await handleRecords(request, response);
    return;
  }

  setJson(response, 404, {
    reason: "GOOGLE_DRIVE_ACTION_NOT_FOUND",
    error: "找不到指定的 Google Drive API。"
  });
}
