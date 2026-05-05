import { describe, expect, it } from "vitest";
import type { AppDb } from "../domain/models";

import {
  APP_DB_SYNC_METADATA_STORAGE_KEY,
  persistAppDbSyncMetadata,
  resolveAppDbLatestTimestamp
} from "./app-db-sync";

function createMinimalDb(updatedAt: string): AppDb {
  return {
    patients: [
      {
        id: "pat-001",
        chart_number: "",
        name: "測試個案",
        service_needs: [],
        preferred_service_slot: "",
        gender: "女",
        date_of_birth: "1950-01-01",
        phone: "",
        address: "高雄市旗山區",
        home_address: "高雄市旗山區",
        location_keyword: "同住址",
        home_latitude: null,
        home_longitude: null,
        geocoding_status: "pending",
        google_maps_link: "",
        patient_tag: "",
        primary_diagnosis: "",
        preferred_doctor_id: "doc-001",
        important_medical_history: "",
        precautions: "",
        medication_summary: "",
        last_visit_summary: "",
        next_follow_up_focus: "",
        reminder_tags: [],
        status: "active",
        notes: "",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: updatedAt
      }
    ],
    caregivers: [],
    caregiver_chat_bindings: [],
    doctors: [],
    admin_users: [],
    visit_schedules: [],
    saved_route_plans: [],
    visit_records: [],
    contact_logs: [],
    notification_templates: [],
    notification_tasks: [],
    leave_requests: [],
    reschedule_actions: [],
    reminders: [],
    notification_center_items: [],
    doctor_location_logs: []
  };
}

describe("app db sync", () => {
  it("可從資料快照算出最新更新時間", () => {
    const db = createMinimalDb("2026-05-05T10:30:00.000Z");

    expect(resolveAppDbLatestTimestamp(db)).toBe(Date.parse("2026-05-05T10:30:00.000Z"));
  });

  it("會保存同步來源標記供介面判斷線上資料庫狀態", () => {
    persistAppDbSyncMetadata({
      version: 1,
      source: "server",
      syncedAt: "2026-05-05T10:30:00.000Z",
      serverSnapshotUpdatedAt: "2026-05-05T10:29:00.000Z"
    });

    expect(JSON.parse(window.localStorage.getItem(APP_DB_SYNC_METADATA_STORAGE_KEY) ?? "{}")).toEqual({
      version: 1,
      source: "server",
      syncedAt: "2026-05-05T10:30:00.000Z",
      serverSnapshotUpdatedAt: "2026-05-05T10:29:00.000Z"
    });
  });
});
