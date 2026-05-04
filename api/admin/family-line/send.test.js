import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./send.js";

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

async function callSend(body) {
  const response = createResponse();
  await handler({ method: "POST", body }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/admin/family-line/send", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("使用 LINE multicast 群發並去除重複 userId", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "line-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ""
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callSend({
      subject: "群發測試",
      content: "請注意訪視異動",
      recipients: [
        { caregiverId: "cg-001", patientId: "pat-001", doctorId: "doc-001", lineUserId: "U111" },
        { caregiverId: "cg-002", patientId: "pat-002", lineUserId: "U222" },
        { caregiverId: "cg-003", patientId: "pat-003", lineUserId: "U111" }
      ]
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.sentCount).toBe(2);
    expect(result.body.failedCount).toBe(0);
    expect(result.body.results[0]).toEqual(
      expect.objectContaining({
        doctorId: "doc-001",
        lineUserId: "U111"
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/multicast",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          to: ["U111", "U222"],
          messages: [{ type: "text", text: "群發測試\n\n請注意訪視異動" }]
        })
      })
    );
  });

  it("LINE multicast 失敗時回傳逐筆失敗原因", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "line-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "{\"message\":\"Authentication failed\"}"
      })
    );

    const result = await callSend({
      subject: "群發測試",
      content: "請注意訪視異動",
      recipients: [{ caregiverId: "cg-001", patientId: "pat-001", lineUserId: "U111" }]
    });

    expect(result.statusCode).toBe(502);
    expect(result.body.sentCount).toBe(0);
    expect(result.body.failedCount).toBe(1);
    expect(result.body.results[0]).toEqual(
      expect.objectContaining({
        lineUserId: "U111",
        ok: false,
        status: 401,
        error: "{\"message\":\"Authentication failed\"}"
      })
    );
  });

  it("未設定環境變數時可使用前端送入的 LINE token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ""
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callSend({
      lineChannelAccessToken: "browser-line-token",
      subject: "群發測試",
      content: "請注意訪視異動",
      recipients: [{ caregiverId: "cg-001", patientId: "pat-001", lineUserId: "U111" }]
    });

    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/multicast",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer browser-line-token"
        })
      })
    );
  });
});
