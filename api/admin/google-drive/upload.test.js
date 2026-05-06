import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./[action].js";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function callUpload(body, method = "POST") {
  const response = createResponse();
  await handler({ method, body, query: { action: "upload" } }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/admin/google-drive/upload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("使用環境變數上傳 HTML 到 Google Drive", async () => {
    vi.stubEnv("GOOGLE_DRIVE_ACCESS_TOKEN", "drive-token");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "file-id",
        name: "record.html",
        webViewLink: "https://drive.google.com/file/d/file-id/view"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callUpload({
      filename: "record.html",
      html: "<html><body>病歷</body></html>"
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      id: "file-id",
      webViewLink: "https://drive.google.com/file/d/file-id/view"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer drive-token"
        })
      })
    );
    expect(fetchMock.mock.calls[0][1].body).toContain('"parents":["folder-id"]');
    expect(fetchMock.mock.calls[0][1].body).toContain("<html><body>病歷</body></html>");
  });

  it("缺少 Drive 環境變數時不呼叫 Google API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callUpload({
      filename: "record.html",
      html: "<html></html>"
    });

    expect(result.statusCode).toBe(503);
    expect(result.body.reason).toBe("GOOGLE_DRIVE_ENV_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("有 refresh token 設定時會先換取新的 access token 再上傳", async () => {
    vi.stubEnv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fresh-drive-token" })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "file-id",
          name: "record.html",
          webViewLink: "https://drive.google.com/file/d/file-id/view"
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callUpload({
      filename: "record.html",
      html: "<html><body>病歷</body></html>"
    });

    expect(result.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-drive-token");
  });

  it("Drive 回傳驗證失敗時回傳可處理的中文錯誤", async () => {
    vi.stubEnv("GOOGLE_DRIVE_ACCESS_TOKEN", "expired-token");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          status: "UNAUTHENTICATED",
          message: "Request had invalid authentication credentials."
        }
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callUpload({
      filename: "record.html",
      html: "<html></html>"
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.reason).toBe("GOOGLE_DRIVE_AUTH_INVALID");
    expect(result.body.error).toContain("Google Drive 授權已失效");
  });
});
