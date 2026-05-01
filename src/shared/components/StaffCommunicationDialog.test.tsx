import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StaffCommunicationPanel } from "./StaffCommunicationDialog";

describe("StaffCommunicationPanel", () => {
  it("初次打開對話時會先同步一次已讀狀態", () => {
    const handleViewed = vi.fn();

    const { rerender } = render(
      <StaffCommunicationPanel
        counterpartLabel="行政人員"
        currentUserLabel="蕭坤元醫師"
        contextLabel="院內行政協調"
        doctorId="doc-001"
        adminUserId="admin-001"
        logs={[]}
        unreadConversationCount={0}
        onConversationViewed={handleViewed}
        onCreateLog={() => {}}
      />
    );

    expect(handleViewed).toHaveBeenCalledTimes(1);

    rerender(
      <StaffCommunicationPanel
        counterpartLabel="行政人員"
        currentUserLabel="蕭坤元醫師"
        contextLabel="院內行政協調"
        doctorId="doc-001"
        adminUserId="admin-001"
        logs={[]}
        unreadConversationCount={0}
        onConversationViewed={handleViewed}
        onCreateLog={() => {}}
      />
    );

    expect(handleViewed).toHaveBeenCalledTimes(1);
  });
});
