import "@testing-library/jest-dom/vitest";

const originalConsoleError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  const message = args.map((arg) => String(arg ?? "")).join(" ");
  const isKnownReactActDiagnostic =
    message.includes("inside a test was not wrapped in act") &&
    (message.includes("AdminSchedulesPage") ||
      message.includes("DoctorReturnRecordPage") ||
      message.includes("AppProviders"));

  if (isKnownReactActDiagnostic) {
    return;
  }

  originalConsoleError(...args);
};
