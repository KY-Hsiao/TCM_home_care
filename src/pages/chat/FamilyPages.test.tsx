import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { FamilyHomePage } from "./FamilyPages";

describe("FamilyHomePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("會顯示家屬互動頁停用說明", () => {
    render(
      <MemoryRouter initialEntries={["/chat/family/home?patientId=pat-003&scheduleId=vs-003&taskId=nt-002"]}>
        <AppProviders>
          <FamilyHomePage />
        </AppProviders>
      </MemoryRouter>
    );

    expect(screen.getByText("家屬互動頁已停用")).toBeInTheDocument();
    expect(
      screen.getByText("目前已先停用所有會傳訊息給家屬的功能，因此家屬互動頁、表單與外部回寫流程暫不開放。")
    ).toBeInTheDocument();
    expect(screen.queryByText("Google Chat 家屬入口")).not.toBeInTheDocument();
  });
});
