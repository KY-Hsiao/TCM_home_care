import { useContext } from "react";
import { AppContext, type AppContextValue } from "./app-context";

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext 必須在 AppProviders 內使用。");
  }
  return context;
}
