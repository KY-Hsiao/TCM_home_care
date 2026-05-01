import type { WebhookHandler } from "../types";

export function createNoopWebhookHandler(): WebhookHandler {
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
