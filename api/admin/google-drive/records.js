import {
  formatGoogleDriveApiError,
  resolveGoogleDriveAccessToken
} from "./auth.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function buildFolderQuery(folderId) {
  return `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType = 'text/html'`;
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

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  if (!isRequiredString(folderId)) {
    setJson(response, 503, {
      reason: "GOOGLE_DRIVE_ENV_MISSING",
      error: "尚未設定 GOOGLE_DRIVE_FOLDER_ID，無法讀取 Google Drive 病歷檔。"
    });
    return;
  }

  const auth = await resolveGoogleDriveAccessToken();
  if (!auth.ok) {
    setJson(response, auth.statusCode, {
      reason: auth.reason,
      error: auth.error
    });
    return;
  }

  const fileId = String(resolveQueryValue(request.query?.fileId) ?? "").trim();

  try {
    if (!fileId) {
      const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
      listUrl.searchParams.set("q", buildFolderQuery(folderId));
      listUrl.searchParams.set("fields", "files(id,name,modifiedTime,webViewLink,size),nextPageToken");
      listUrl.searchParams.set("orderBy", "modifiedTime desc");
      listUrl.searchParams.set("pageSize", "100");

      const { driveResponse, payload } = await fetchDriveJson(listUrl.toString(), auth.accessToken);
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
        files: Array.isArray(payload.files) ? payload.files : []
      });
      return;
    }

    const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    metadataUrl.searchParams.set("fields", "id,name,mimeType,parents,modifiedTime,webViewLink");
    const { driveResponse: metadataResponse, payload: metadata } = await fetchDriveJson(
      metadataUrl.toString(),
      auth.accessToken
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
    if (!Array.isArray(metadata.parents) || !metadata.parents.includes(folderId)) {
      setJson(response, 404, {
        reason: "DRIVE_FILE_NOT_IN_FOLDER",
        error: "指定的 Google Drive 檔案不在設定的病歷資料夾中。"
      });
      return;
    }

    const mediaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    mediaUrl.searchParams.set("alt", "media");
    const contentResponse = await fetch(mediaUrl.toString(), {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`
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
