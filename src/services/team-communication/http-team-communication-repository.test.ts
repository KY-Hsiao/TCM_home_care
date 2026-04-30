import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpTeamCommunicationRepository } from "./http-team-communication-repository";

describe("httpTeamCommunicationRepository", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("會以查詢參數讀取對話內容", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] })
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = createHttpTeamCommunicationRepository();

    await repository.listConversation({
      doctorId: "doc-001",
      adminUserId: "admin-001",
      viewerRole: "doctor",
      viewerUserId: "doc-001"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/team-communications?doctorId=doc-001&adminUserId=admin-001&role=doctor&userId=doc-001",
      {
        cache: "no-store"
      }
    );
  });

  it("會禁用未讀數查詢快取", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = createHttpTeamCommunicationRepository();

    await repository.getUnreadCount({
      role: "doctor",
      userId: "doc-001",
      doctorId: "doc-001",
      adminUserId: "admin-001"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/team-communications/unread-count?role=doctor&userId=doc-001&doctorId=doc-001&adminUserId=admin-001",
      {
        cache: "no-store"
      }
    );
  });

  it("會用 PATCH 標記單筆已讀", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = createHttpTeamCommunicationRepository();

    await repository.markMessageRead("msg-001", "admin", "admin-001");

    expect(fetchMock).toHaveBeenCalledWith("/api/team-communications/msg-001/read", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        viewerRole: "admin",
        viewerUserId: "admin-001"
      })
    });
  });
});
