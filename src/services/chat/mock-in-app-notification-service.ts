import type {
  ChatNotificationEvent,
  ChatServiceAdapter,
  ServicesContextDeps,
  WebhookReplyInput
} from "../types";

export function createMockInAppNotificationServiceAdapter(
  _deps: ServicesContextDeps
): ChatServiceAdapter {
  return {
    sendNotification(_event: ChatNotificationEvent) {
      return undefined;
    },
    replyToEvent(_input: WebhookReplyInput) {
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
