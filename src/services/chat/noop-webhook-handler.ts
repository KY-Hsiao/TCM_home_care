import type { ServicesContextDeps, WebhookHandler } from "../types";

export function createNoopWebhookHandler(_deps: ServicesContextDeps): WebhookHandler {
  return {
    handleBinding() {
      return;
    },
    handleMessage() {
      return;
    },
    handlePostback() {
      return;
    },
    handleFamilyFormSubmit() {
      return;
    }
  };
}
