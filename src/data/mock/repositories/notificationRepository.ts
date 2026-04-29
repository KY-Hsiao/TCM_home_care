import type { AppDb } from "../../../domain/models";
import type { NotificationRepository } from "../../../domain/repository";
import {
  buildNotificationCenterItemFromTask,
  upsertNotificationCenterItem
} from "./notificationCenter";

export function createNotificationRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): NotificationRepository {
  return {
    getTemplates() {
      return [...getDb().notification_templates];
    },
    getTasks(filters) {
      const tasks = [...getDb().notification_tasks];
      if (!filters?.status) {
        return tasks;
      }
      return tasks.filter((task) => task.status === filters.status);
    },
    getTasksByScheduleId(scheduleId) {
      return getDb().notification_tasks.filter(
        (task) => task.visit_schedule_id === scheduleId
      );
    },
    getTasksByRecipientRole(recipientRole) {
      return getDb().notification_tasks.filter(
        (task) => task.recipient_role === recipientRole
      );
    },
    updateTaskDraft(taskId, input) {
      updateDb((db) => {
        const now = new Date().toISOString();
        return {
          ...db,
          notification_tasks: db.notification_tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  preview_payload: input.previewPayload ?? task.preview_payload,
                  caregiver_id:
                    input.caregiverId !== undefined ? input.caregiverId : task.caregiver_id,
                  recipient_name: input.recipientName ?? task.recipient_name,
                  recipient_target: input.recipientTarget ?? task.recipient_target,
                  channel: input.channel ?? task.channel,
                  updated_at: now
                }
              : task
          )
        };
      });
    },
    updateTaskStatus(taskId, input) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextTasks = db.notification_tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: input.status,
                sent_at:
                  input.status === "sent" || input.status === "awaiting_reply"
                    ? task.sent_at ?? now
                    : task.sent_at,
                reply_excerpt:
                  input.replyExcerpt !== undefined ? input.replyExcerpt : task.reply_excerpt,
                reply_code:
                  input.replyCode !== undefined ? input.replyCode : task.reply_code,
                failure_reason:
                  input.failureReason !== undefined
                    ? input.failureReason
                    : input.status === "failed"
                      ? task.failure_reason ?? "模擬發送失敗"
                      : null,
                updated_at: now
              }
            : task
        );
        const updatedTask = nextTasks.find((task) => task.id === taskId);
        return {
          ...db,
          notification_tasks: nextTasks,
          notification_center_items: updatedTask
            ? upsertNotificationCenterItem(
                db,
                buildNotificationCenterItemFromTask(
                  {
                    ...db,
                    notification_tasks: nextTasks
                  },
                  updatedTask
                )
              )
            : db.notification_center_items
        };
      });
    },
    batchUpdateStatuses(taskIds, status) {
      updateDb((db) => {
        const ids = new Set(taskIds);
        const now = new Date().toISOString();
        const nextTasks = db.notification_tasks.map((task) =>
          ids.has(task.id)
            ? {
                ...task,
                status,
                sent_at:
                  status === "sent" || status === "awaiting_reply"
                    ? task.sent_at ?? now
                    : task.sent_at,
                updated_at: now
              }
            : task
        );
        return {
          ...db,
          notification_tasks: nextTasks,
          notification_center_items: nextTasks.reduce((items, task) => {
            if (!ids.has(task.id)) {
              return items;
            }
            return upsertNotificationCenterItem(
              {
                ...db,
                notification_center_items: items
              },
              buildNotificationCenterItemFromTask(
                {
                  ...db,
                  notification_tasks: nextTasks,
                  notification_center_items: items
                },
                task
              )
            );
          }, db.notification_center_items)
        };
      });
    },
    upsertTemplate(template) {
      updateDb((db) => {
        const index = db.notification_templates.findIndex((item) => item.id === template.id);
        const now = new Date().toISOString();
        if (index >= 0) {
          return {
            ...db,
            notification_templates: db.notification_templates.map((item, itemIndex) =>
              itemIndex === index ? { ...template, updated_at: now } : item
            )
          };
        }
        return {
          ...db,
          notification_templates: [
            { ...template, created_at: now, updated_at: now },
            ...db.notification_templates
          ]
        };
      });
    },
    createTask(task) {
      updateDb((db) => ({
        ...db,
        notification_tasks: [task, ...db.notification_tasks],
        notification_center_items: upsertNotificationCenterItem(
          db,
          buildNotificationCenterItemFromTask(db, task)
        )
      }));
    },
    getNotificationCenterItems(role, ownerId) {
      const items = [...getDb().notification_center_items]
        .filter((item) => {
          if (role === "admin") {
            return item.role === "admin" || (item.role === "doctor" && item.source_type === "manual_notice");
          }
          if (item.role !== role) {
            return false;
          }
          if (!ownerId || !item.owner_user_id) {
            return true;
          }
          return item.owner_user_id === ownerId;
        })
        .sort(
          (left, right) =>
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
        );

      return items;
    },
    createNotificationCenterItem(item) {
      updateDb((db) => ({
        ...db,
        notification_center_items: upsertNotificationCenterItem(db, item)
      }));
    },
    replyNotificationCenterItem(itemId, replyText, role) {
      updateDb((db) => {
        const now = new Date().toISOString();
        return {
          ...db,
          notification_center_items: db.notification_center_items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  reply_text: replyText.trim(),
                  reply_updated_at: now,
                  reply_updated_by_role: role,
                  status: "replied",
                  is_unread: role === "admin" ? item.is_unread : false,
                  updated_at: now
                }
              : item
          )
        };
      });
    },
    markNotificationCenterItemRead(itemId) {
      updateDb((db) => ({
        ...db,
        notification_center_items: db.notification_center_items.map((item) =>
          item.id === itemId ? { ...item, is_unread: false } : item
        )
      }));
    },
    updateNotificationCenterItemStatus(itemId, status) {
      updateDb((db) => {
        const now = new Date().toISOString();
        return {
          ...db,
          notification_center_items: db.notification_center_items.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  status,
                  is_unread: status === "pending",
                  updated_at: now
                }
              : item
          )
        };
      });
    }
  };
}
