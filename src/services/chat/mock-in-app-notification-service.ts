import type { ChatServiceAdapter } from "../types";

export function createMockInAppNotificationServiceAdapter(): ChatServiceAdapter {
  return {
    sendNotification() {
      return undefined;
    },
    replyToEvent() {
      return undefined;
    },
    buildFamilyEntryUrl() {
      return "/admin/patients";
    },
    supports(feature) {
      return ["card_message", "button_actions"].includes(feature);
    }
  };
}
