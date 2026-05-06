import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./upload.js";

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
  await handler({ method, body }, response);
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
});
