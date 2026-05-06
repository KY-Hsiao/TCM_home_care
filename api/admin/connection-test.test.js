import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./[resource].js";

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

async function callConnectionTest(query = {}, method = "GET") {
  const response = createResponse();
  await handler({ method, query: { ...query, resource: "connection-test" } }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/admin/connection-test", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("會用 OPENAI_API_KEY 測試 GPT 連線", async () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callConnectionTest({ service: "gpt" });

    expect(result.statusCode).toBe(200);
    expect(result.body.service).toBe("gpt");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer openai-key"
        })
      })
    );
  });

  it("缺少 OPENAI_API_KEY 時不呼叫 OpenAI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await callConnectionTest({ service: "gpt" });

    expect(result.statusCode).toBe(503);
    expect(result.body.reason).toBe("OPENAI_API_KEY_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("會測試 Google Drive 病歷資料夾可讀取", async () => {
    vi.stubEnv("GOOGLE_DRIVE_ACCESS_TOKEN", "drive-token");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: [] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callConnectionTest({ service: "google-drive" });

    expect(result.statusCode).toBe(200);
    expect(result.body.service).toBe("google-drive");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("https://www.googleapis.com/drive/v3/files");
    expect(new URL(url).searchParams.get("q")).toContain("'folder-id' in parents");
    expect(options.headers.Authorization).toBe("Bearer drive-token");
  });

  it("不支援的項目會回傳 400", async () => {
    const result = await callConnectionTest({ service: "line" });

    expect(result.statusCode).toBe(400);
    expect(result.body.reason).toBe("UNSUPPORTED_SERVICE");
  });
});
