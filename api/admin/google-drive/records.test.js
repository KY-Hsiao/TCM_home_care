import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./records.js";

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

async function callRecords(query = {}, method = "GET") {
  const response = createResponse();
  await handler({ method, query }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/admin/google-drive/records", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("使用環境變數列出 Google Drive HTML 病歷檔", async () => {
    vi.stubEnv("GOOGLE_DRIVE_ACCESS_TOKEN", "drive-token");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        files: [
          {
            id: "file-1",
            name: "20260507_王醫師_上午_居家個案病例紀錄.html",
            modifiedTime: "2026-05-07T08:00:00.000Z",
            webViewLink: "https://drive.google.com/file/d/file-1/view"
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callRecords();

    expect(result.statusCode).toBe(200);
    expect(result.body.files).toHaveLength(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("https://www.googleapis.com/drive/v3/files");
    expect(new URL(url).searchParams.get("q")).toContain("'folder-id' in parents");
    expect(options.headers.Authorization).toBe("Bearer drive-token");
  });

  it("缺少 Drive 環境變數時不呼叫 Google API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callRecords();

    expect(result.statusCode).toBe(503);
    expect(result.body.reason).toBe("GOOGLE_DRIVE_ENV_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("只允許讀取設定資料夾內的指定 HTML 內容", async () => {
    vi.stubEnv("GOOGLE_DRIVE_ACCESS_TOKEN", "drive-token");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "file-1",
          name: "record.html",
          mimeType: "text/html",
          parents: ["folder-id"],
          modifiedTime: "2026-05-07T08:00:00.000Z",
          webViewLink: "https://drive.google.com/file/d/file-1/view"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "<html><body>病歷</body></html>"
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callRecords({ fileId: "file-1" });

    expect(result.statusCode).toBe(200);
    expect(result.body.file.name).toBe("record.html");
    expect(result.body.html).toContain("病歷");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
