import { compareAsc, isSameDay } from "date-fns";
import type {
  AdminUser,
  AppDb,
  CaregiverChatBinding,
  Doctor,
  Patient,
  SavedRoutePlan
} from "../../../domain/models";
import type {
  PatientBatchRemoveResult,
  PatientRemoveResult,
  PatientRepository,
  PatientUpsertResult
} from "../../../domain/repository";
import {
  buildGoogleMapsSearchUrl,
  normalizeLocationKeyword
} from "../../../shared/utils/location-keyword";
import { anonymizePatientName, maskPatientName } from "../../../shared/utils/patient-name";

const ACTIVE_VISIT_STATUSES = [
  "on_the_way",
  "tracking",
  "proximity_pending",
  "arrived",
  "in_treatment"
] as const;

function buildChatBinding(
  caregiverId: string,
  payload: {
    googleChatUserId: string;
    googleAccountEmail: string;
    googleAccountLoggedIn: boolean;
    displayName: string;
    isActive: boolean;
  }
): CaregiverChatBinding {
  const now = new Date().toISOString();
  return {
    id: `cb-${caregiverId}`,
    caregiver_id: caregiverId,
    google_chat_user_id: payload.googleChatUserId,
    google_account_email: payload.googleAccountEmail,
    google_account_logged_in: payload.googleAccountLoggedIn,
    display_name: payload.displayName,
    is_active: payload.isActive,
    bound_at: now,
    last_interaction_at: null,
    created_at: now,
    updated_at: now
  };
}

function defaultAddressArea(address: string): string {
  const match = address.match(/(台北市|新北市)([^0-9\s]+?區)/);
  return match ? `${match[1]}${match[2]}` : "未分類";
}

function createChartNumber(): string {
  return `AUTO-${Date.now().toString().slice(-6)}`;
}

function reindexRouteItems(routeItems: SavedRoutePlan["route_items"]) {
  let checkedOrder = 1;
  return routeItems.map((item) =>
    item.checked
      ? {
          ...item,
          route_order: checkedOrder++
        }
      : {
          ...item,
          route_order: null
        }
  );
}

function removePatientFromDb(
  db: AppDb,
  patientId: string
): { db: AppDb; result: PatientRemoveResult } {
  const patient = db.patients.find((item) => item.id === patientId);
  if (!patient) {
    return {
      db,
      result: {
        patientId,
        removed: false,
        removedScheduleCount: 0,
        blockedReason: "找不到指定個案"
      }
    };
  }

  const patientSchedules = db.visit_schedules.filter((schedule) => schedule.patient_id === patientId);
  const activeSchedules = patientSchedules.filter((schedule) =>
    ACTIVE_VISIT_STATUSES.includes(schedule.status as (typeof ACTIVE_VISIT_STATUSES)[number])
  );

  if (activeSchedules.length > 0) {
    return {
      db,
      result: {
        patientId,
        removed: false,
        removedScheduleCount: patientSchedules.length,
        blockedReason: "此個案仍有進行中的訪視流程"
      }
    };
  }

  const scheduleIds = new Set(patientSchedules.map((schedule) => schedule.id));
  const caregiverIds = new Set(
    db.caregivers
      .filter((caregiver) => caregiver.patient_id === patientId)
      .map((caregiver) => caregiver.id)
  );
  const nextSavedRoutePlans = db.saved_route_plans
    .map((routePlan) => {
      const nextRouteItems = reindexRouteItems(
        routePlan.route_items.filter((item) => item.patient_id !== patientId)
      );
      return {
        ...routePlan,
        route_items: nextRouteItems,
        schedule_ids: nextRouteItems
          .map((item) => item.schedule_id)
          .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
      };
    })
    .filter((routePlan) => routePlan.route_items.length > 0);

  return {
    db: {
      ...db,
      patients: db.patients.filter((item) => item.id !== patientId),
      caregivers: db.caregivers.filter((caregiver) => caregiver.patient_id !== patientId),
      caregiver_chat_bindings: db.caregiver_chat_bindings.filter(
        (binding) => !caregiverIds.has(binding.caregiver_id)
      ),
      visit_schedules: db.visit_schedules.filter((schedule) => schedule.patient_id !== patientId),
      saved_route_plans: nextSavedRoutePlans,
      visit_records: db.visit_records.filter(
        (record) => !scheduleIds.has(record.visit_schedule_id)
      ),
      contact_logs: db.contact_logs.filter((log) => log.patient_id !== patientId),
      notification_tasks: db.notification_tasks.filter((task) => task.patient_id !== patientId),
      reschedule_actions: db.reschedule_actions.filter(
        (action) => !scheduleIds.has(action.visit_schedule_id)
      ),
      reminders: db.reminders.filter(
        (reminder) =>
          !reminder.related_visit_schedule_id ||
          !scheduleIds.has(reminder.related_visit_schedule_id)
      ),
      notification_center_items: db.notification_center_items.filter(
        (item) =>
          item.linked_patient_id !== patientId &&
          (!item.linked_visit_schedule_id || !scheduleIds.has(item.linked_visit_schedule_id))
      ),
      doctor_location_logs: db.doctor_location_logs.filter(
        (log) => !log.linked_visit_schedule_id || !scheduleIds.has(log.linked_visit_schedule_id)
      )
    },
    result: {
      patientId,
      removed: true,
      removedScheduleCount: patientSchedules.length,
      blockedReason: null
    }
  };
}

export function createPatientRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): PatientRepository {
  return {
    getPatients() {
      return [...getDb().patients].sort((left, right) =>
        left.chart_number.localeCompare(right.chart_number, "zh-Hant")
      );
    },
    getPatientById(id) {
      return getDb().patients.find((patient) => patient.id === id);
    },
    getPatientProfile(id) {
      const db = getDb();
      const patient = db.patients.find((item) => item.id === id);
      if (!patient) {
        return undefined;
      }

      const caregivers = db.caregivers.filter((caregiver) => caregiver.patient_id === id);
      const caregiverIds = caregivers.map((caregiver) => caregiver.id);
      const allSchedules = db.visit_schedules
        .filter((schedule) => schedule.patient_id === id)
        .sort((left, right) =>
          compareAsc(new Date(right.scheduled_start_at), new Date(left.scheduled_start_at))
        );

      return {
        patient,
        caregivers,
        chatBindings: db.caregiver_chat_bindings.filter((binding) =>
          caregiverIds.includes(binding.caregiver_id)
        ),
        recentSchedules: allSchedules.slice(0, 6),
        visitRecords: db.visit_records
          .filter((record) =>
            allSchedules.some((schedule) => schedule.id === record.visit_schedule_id)
          )
          .sort((left, right) =>
            compareAsc(new Date(right.updated_at), new Date(left.updated_at))
          ),
        contactLogs: db.contact_logs
          .filter((log) => log.patient_id === id)
          .sort((left, right) =>
            compareAsc(new Date(right.contacted_at), new Date(left.contacted_at))
          )
          .slice(0, 12),
        todaySchedule: allSchedules.find((schedule) =>
          isSameDay(new Date(schedule.scheduled_start_at), new Date())
        )
      };
    },
    getPatientsByDoctorSlot({ doctorId, weekday, serviceTimeSlot }) {
      const targetSlot = `${weekday}${serviceTimeSlot}`;
      return [...getDb().patients]
        .filter(
          (patient) =>
            patient.status === "active" &&
            patient.preferred_doctor_id === doctorId &&
            patient.preferred_service_slot === targetSlot
        )
        .sort((left, right) => left.chart_number.localeCompare(right.chart_number, "zh-Hant"));
    },
    getDoctors() {
      return [...getDb().doctors];
    },
    getAdmins() {
      return [...getDb().admin_users];
    },
    upsertDoctor(doctor: Doctor) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextDoctors = [...db.doctors];
        const index = nextDoctors.findIndex((item) => item.id === doctor.id);
        const normalizedDoctor = {
          ...doctor,
          google_account_logged_in: doctor.google_account_logged_in ?? false,
          available_service_slots: doctor.available_service_slots ?? [],
          updated_at: now
        };

        if (index >= 0) {
          nextDoctors[index] = normalizedDoctor;
        } else {
          nextDoctors.unshift({
            ...normalizedDoctor,
            created_at: normalizedDoctor.created_at || now
          });
        }

        return {
          ...db,
          doctors: nextDoctors
        };
      });
    },
    removeDoctor(doctorId: string) {
      updateDb((db) => {
        const removedScheduleIds = new Set(
          db.visit_schedules
            .filter((schedule) => schedule.assigned_doctor_id === doctorId)
            .map((schedule) => schedule.id)
        );
        const removedLeaveRequestIds = new Set(
          db.leave_requests
            .filter((leaveRequest) => leaveRequest.doctor_id === doctorId)
            .map((leaveRequest) => leaveRequest.id)
        );

        return {
          ...db,
          doctors: db.doctors.filter((doctor) => doctor.id !== doctorId),
          visit_schedules: db.visit_schedules.filter(
            (schedule) => schedule.assigned_doctor_id !== doctorId
          ),
          saved_route_plans: db.saved_route_plans.filter(
            (routePlan) =>
              routePlan.doctor_id !== doctorId &&
              !routePlan.schedule_ids.some((scheduleId) => removedScheduleIds.has(scheduleId))
          ),
          visit_records: db.visit_records.filter(
            (record) => !removedScheduleIds.has(record.visit_schedule_id)
          ),
          contact_logs: db.contact_logs.filter(
            (log) =>
              log.doctor_id !== doctorId &&
              (!log.visit_schedule_id || !removedScheduleIds.has(log.visit_schedule_id))
          ),
          notification_tasks: db.notification_tasks.filter(
            (task) => !task.visit_schedule_id || !removedScheduleIds.has(task.visit_schedule_id)
          ),
          leave_requests: db.leave_requests.filter((leaveRequest) => leaveRequest.doctor_id !== doctorId),
          reschedule_actions: db.reschedule_actions.filter(
            (action) =>
              !removedScheduleIds.has(action.visit_schedule_id) &&
              action.new_doctor_id !== doctorId
          ),
          reminders: db.reminders.filter(
            (reminder) =>
              !reminder.related_visit_schedule_id ||
              !removedScheduleIds.has(reminder.related_visit_schedule_id)
          ),
          notification_center_items: db.notification_center_items.filter(
            (item) =>
              item.linked_doctor_id !== doctorId &&
              (!item.linked_visit_schedule_id || !removedScheduleIds.has(item.linked_visit_schedule_id)) &&
              (!item.linked_leave_request_id || !removedLeaveRequestIds.has(item.linked_leave_request_id))
          ),
          doctor_location_logs: db.doctor_location_logs.filter(
            (log) =>
              log.doctor_id !== doctorId &&
              (!log.linked_visit_schedule_id || !removedScheduleIds.has(log.linked_visit_schedule_id))
          )
        };
      });
    },
    upsertAdmin(admin: AdminUser) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextAdmins = [...db.admin_users];
        const index = nextAdmins.findIndex((item) => item.id === admin.id);
        const normalizedAdmin = {
          ...admin,
          google_chat_user_id: admin.google_chat_user_id ?? "",
          google_account_email: admin.google_account_email ?? admin.email ?? "",
          google_account_logged_in: admin.google_account_logged_in ?? false,
          updated_at: now
        };

        if (index >= 0) {
          nextAdmins[index] = normalizedAdmin;
        } else {
          nextAdmins.unshift({
            ...normalizedAdmin,
            created_at: normalizedAdmin.created_at || now
          });
        }

        return {
          ...db,
          admin_users: nextAdmins
        };
      });
    },
    removeAdmin(adminId: string) {
      updateDb((db) => ({
        ...db,
        admin_users: db.admin_users.filter((admin) => admin.id !== adminId)
      }));
    },
    upsertPatient(patient: Patient) {
      let result: PatientUpsertResult = {
        patientId: patient.id,
        chartNumber: patient.chart_number,
        scheduleId: null,
        scheduleSynced: false,
        skippedReason: null
      };
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextPatients = [...db.patients];
        const index = nextPatients.findIndex((item) => item.id === patient.id);
        const doctor = db.doctors.find((item) => item.id === patient.preferred_doctor_id);
        const normalizedChartNumber = patient.chart_number || createChartNumber();
        const normalizedSlot =
          patient.preferred_service_slot ||
          doctor?.available_service_slots[0] ||
          "";
        const normalizedPatient = {
          ...patient,
          name: anonymizePatientName(patient.name),
          chart_number: normalizedChartNumber,
          service_needs: patient.service_needs ?? [],
          preferred_service_slot: normalizedSlot,
          location_keyword: normalizeLocationKeyword(patient.location_keyword),
          google_maps_link: buildGoogleMapsSearchUrl(
            patient.location_keyword,
            patient.home_address
          ),
          home_address: patient.home_address,
          address: patient.home_address,
          updated_at: now
        };

        if (index >= 0) {
          nextPatients[index] = normalizedPatient;
        } else {
          nextPatients.unshift({
            ...normalizedPatient,
            created_at: normalizedPatient.created_at || now
          });
        }

        const nextSchedules = db.visit_schedules.map((schedule) =>
          schedule.patient_id === patient.id &&
          !["completed", "cancelled"].includes(schedule.status)
            ? {
                ...schedule,
                assigned_doctor_id: normalizedPatient.preferred_doctor_id,
                address_snapshot: normalizedPatient.address,
                location_keyword_snapshot: normalizedPatient.location_keyword,
                home_latitude_snapshot: normalizedPatient.home_latitude,
                home_longitude_snapshot: normalizedPatient.home_longitude,
                google_maps_link: normalizedPatient.google_maps_link,
                area: defaultAddressArea(normalizedPatient.address),
                service_time_slot: normalizedPatient.preferred_service_slot,
                reminder_tags: [...normalizedPatient.reminder_tags, ...normalizedPatient.service_needs],
                status: normalizedPatient.status === "active" ? schedule.status : "cancelled",
                updated_at: now
              }
            : schedule
        );

        result = {
          patientId: normalizedPatient.id,
          chartNumber: normalizedPatient.chart_number,
          scheduleId:
            nextSchedules.find(
              (schedule) =>
                schedule.patient_id === normalizedPatient.id &&
                !["completed", "cancelled"].includes(schedule.status)
            )?.id ?? null,
          scheduleSynced: false,
          skippedReason:
            normalizedPatient.status !== "active"
              ? "個案非服務中，未納入排程"
              : doctor
                ? "請到排程管理頁建立或實行路線"
                : "找不到負責醫師"
        };

        return {
          ...db,
          patients: nextPatients,
          visit_schedules: nextSchedules
        };
      });
      return result;
    },
    closePatient(patientId, reason = "管理端結案") {
      let closeResult = {
        patientId,
        closed: false,
        removedRoutePlans: 0,
        removedSchedules: 0,
        message: "找不到指定個案。"
      };

      updateDb((db) => {
        const patient = db.patients.find((item) => item.id === patientId);
        if (!patient) {
          return db;
        }

        const now = new Date().toISOString();
        let removedRoutePlans = 0;
        let removedSchedules = 0;

        const nextSavedRoutePlans = db.saved_route_plans
          .map((routePlan) => {
            const nextRouteItems = reindexRouteItems(
              routePlan.route_items.filter((item) => item.patient_id !== patientId)
            );
            if (nextRouteItems.length !== routePlan.route_items.length) {
              removedRoutePlans += 1;
            }
            return {
              ...routePlan,
              route_items: nextRouteItems,
              schedule_ids: routePlan.schedule_ids.filter((scheduleId) =>
                nextRouteItems.some((item) => item.schedule_id === scheduleId)
              ),
              updated_at: nextRouteItems.length !== routePlan.route_items.length ? now : routePlan.updated_at
            };
          })
          .filter((routePlan) => routePlan.route_items.length > 0);

        const routeOrderByScheduleId = new Map(
          nextSavedRoutePlans.flatMap((routePlan) =>
            routePlan.route_items
              .filter((item) => item.schedule_id)
              .map((item) => [item.schedule_id as string, item.route_order] as const)
          )
        );

        const nextSchedules = db.visit_schedules.map((schedule) => {
          if (
            schedule.patient_id !== patientId ||
            ["completed", "cancelled"].includes(schedule.status)
          ) {
            return schedule;
          }
          removedSchedules += 1;
          return {
            ...schedule,
            status: "cancelled" as const,
            note: `${schedule.note}｜結案：${reason}`,
            updated_at: now
          };
        }).map((schedule) =>
          routeOrderByScheduleId.has(schedule.id)
            ? {
                ...schedule,
                route_order: routeOrderByScheduleId.get(schedule.id) ?? schedule.route_order,
                updated_at: now
              }
            : schedule
        );

        closeResult = {
          patientId,
          closed: true,
          removedRoutePlans,
          removedSchedules,
          message: `已結案 ${maskPatientName(patient.name)}，並移除原排定時段與相關路線。`
        };

        return {
          ...db,
          patients: db.patients.map((item) =>
            item.id === patientId
              ? {
                  ...item,
                  status: "closed",
                  preferred_service_slot: "",
                  updated_at: now
                }
              : item
          ),
          saved_route_plans: nextSavedRoutePlans,
          visit_schedules: nextSchedules
        };
      });

      return closeResult;
    },
    removePatient(patientId) {
      let result: PatientRemoveResult = {
        patientId,
        removed: false,
        removedScheduleCount: 0,
        blockedReason: null
      };

      updateDb((db) => {
        const removal = removePatientFromDb(db, patientId);
        result = removal.result;
        return removal.db;
      });

      return result;
    },
    removePatients(patientIds) {
      const results: PatientRemoveResult[] = [];

      updateDb((db) => {
        let nextDb = db;
        patientIds.forEach((patientId) => {
          const removal = removePatientFromDb(nextDb, patientId);
          nextDb = removal.db;
          results.push(removal.result);
        });
        return nextDb;
      });

      return results.reduce<PatientBatchRemoveResult>(
        (summary, result) => ({
          results: summary.results,
          removedCount: summary.removedCount + (result.removed ? 1 : 0),
          blockedCount: summary.blockedCount + (result.removed ? 0 : 1),
          removedScheduleCount: summary.removedScheduleCount + (result.removed ? result.removedScheduleCount : 0)
        }),
        {
          results,
          removedCount: 0,
          blockedCount: 0,
          removedScheduleCount: 0
        }
      );
    },
    updateCaregiver(caregiverId, patch) {
      updateDb((db) => {
        const caregiver = db.caregivers.find((item) => item.id === caregiverId);
        if (!caregiver) {
          return db;
        }

        const now = new Date().toISOString();
        return {
          ...db,
          caregivers: db.caregivers.map((item) => {
            if (item.patient_id !== caregiver.patient_id) {
              return item;
            }
            if (item.id === caregiverId) {
              return { ...item, ...patch, updated_at: now };
            }
            if (patch.is_primary) {
              return { ...item, is_primary: false, updated_at: now };
            }
            return item;
          })
        };
      });
    },
    upsertCaregiverChatBinding(caregiverId, payload) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextBindings = [...db.caregiver_chat_bindings];
        const index = nextBindings.findIndex((item) => item.caregiver_id === caregiverId);
        if (index >= 0) {
          nextBindings[index] = {
            ...nextBindings[index],
            google_chat_user_id: payload.googleChatUserId,
            google_account_email: payload.googleAccountEmail,
            google_account_logged_in: payload.googleAccountLoggedIn,
            display_name: payload.displayName,
            is_active: payload.isActive,
            updated_at: now
          };
        } else {
          nextBindings.unshift(buildChatBinding(caregiverId, payload));
        }

        return {
          ...db,
          caregiver_chat_bindings: nextBindings
        };
      });
    },
    updateDoctorIntegration(doctorId, patch) {
      updateDb((db) => {
        const now = new Date().toISOString();
        return {
          ...db,
          doctors: db.doctors.map((doctor) =>
            doctor.id === doctorId ? { ...doctor, ...patch, updated_at: now } : doctor
          )
        };
      });
    }
  };
}
