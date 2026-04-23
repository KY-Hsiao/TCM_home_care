import { compareAsc } from "date-fns";
import type { AppDb, ContactLog } from "../../../domain/models";
import type { ContactRepository } from "../../../domain/repository";

export function createContactRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): ContactRepository {
  return {
    createContactLog(log: ContactLog) {
      updateDb((db) => ({
        ...db,
        contact_logs: [log, ...db.contact_logs]
      }));
    },
    getContactLogsByScheduleId(scheduleId) {
      return [...getDb().contact_logs]
        .filter((log) => log.visit_schedule_id === scheduleId)
        .sort((left, right) =>
          compareAsc(new Date(right.contacted_at), new Date(left.contacted_at))
        );
    },
    getContactLogsByPatientId(patientId) {
      return [...getDb().contact_logs]
        .filter((log) => log.patient_id === patientId)
        .sort((left, right) =>
          compareAsc(new Date(right.contacted_at), new Date(left.contacted_at))
        );
    }
  };
}
