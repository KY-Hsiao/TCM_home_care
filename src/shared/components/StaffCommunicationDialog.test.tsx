import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StaffCommunicationPanel } from "./StaffCommunicationDialog";

describe("StaffCommunicationPanel", () => {
  it("初次打開對話時會先同步一次已讀狀態", () => {
    const handleViewed = vi.fn();

    const { rerender } = render(
      <StaffCommunicationPanel
        title="團隊通訊｜行政人員"
        counterpartLabel="行政人員"
        counterpartPhone="0912-000-000"
        currentUserLabel="蕭坤元醫師"
        contextLabel="院內行政協調"
        doctorId="doc-001"
        adminUserId="admin-001"
        patientId={null}
        visitScheduleId={null}
        logs={[]}
        unreadConversationCount={0}
        onConversationViewed={handleViewed}
        onCreateLog={() => {}}
      />
    );

    expect(handleViewed).toHaveBeenCalledTimes(1);

    rerender(
      <StaffCommunicationPanel
        title="團隊通訊｜行政人員"
        counterpartLabel="行政人員"
        counterpartPhone="0912-000-000"
        currentUserLabel="蕭坤元醫師"
        contextLabel="院內行政協調"
        doctorId="doc-001"
        adminUserId="admin-001"
        patientId={null}
        visitScheduleId={null}
        logs={[]}
        unreadConversationCount={0}
        onConversationViewed={handleViewed}
        onCreateLog={() => {}}
      />
    );

    expect(handleViewed).toHaveBeenCalledTimes(1);
  });
});
