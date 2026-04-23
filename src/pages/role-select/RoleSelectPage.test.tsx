import { AppProviders } from "../../app/providers";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RoleSelectPage } from "./RoleSelectPage";

describe("RoleSelectPage", () => {
  it("會顯示醫師與行政兩個登入入口，且預設密碼提示為 0000", () => {
    render(
      <MemoryRouter>
        <AppProviders>
          <RoleSelectPage />
        </AppProviders>
      </MemoryRouter>
    );

    expect(screen.getByText("居家醫師")).toBeInTheDocument();
    expect(screen.getByText("行政管理")).toBeInTheDocument();
    expect(screen.getByText("共用行政帳號")).toBeInTheDocument();
    expect(screen.getByText("行政人員")).toBeInTheDocument();
    expect(screen.getAllByText(/預設密碼為 `0000`/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "登入並進入" }).length).toBe(2);
  });

  it("密碼錯誤時會顯示錯誤訊息", () => {
    render(
      <MemoryRouter>
        <AppProviders>
          <RoleSelectPage />
        </AppProviders>
      </MemoryRouter>
    );

    fireEvent.change(screen.getAllByLabelText("登入密碼")[0], {
      target: { value: "1111" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "登入並進入" })[0]);

    expect(screen.getByRole("status")).toHaveTextContent("密碼錯誤");
  });
});
