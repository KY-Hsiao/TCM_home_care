import { addDays, addMinutes, compareAsc, formatISO, isSameDay, startOfDay } from "date-fns";
import type {
  AdminUser,
  AppDb,
  CaregiverChatBinding,
  Doctor,
  Patient,
  SavedRoutePlan,
  VisitSchedule
} from "../../../domain/models";
import type {
  PatientRemoveResult,
  PatientRepository,
  PatientUpsertResult
} from "../../../domain/repository";
import {
  buildGoogleMapsSearchUrl,
  normalizeLocationKeyword
} from "../../../shared/utils/location-keyword";

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

const AUTO_SLOT_PATIENT_LIMIT = 8;
const AUTO_SLOT_INTERVAL_MINUTES = 30;
const AUTO_VISIT_DURATION_MINUTES = 30;
const SLOT_PART_WINDOWS = {
  上午: { startHour: 9, startMinute: 0, endHour: 13, endMinute: 0 },
  下午: { startHour: 14, startMinute: 0, endHour: 18, endMinute: 0 }
} as const;
const WEEKDAY_TO_INDEX: Record<string, number> = {
  星期日: 0,
  星期天: 0,
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6
};

type ParsedServiceSlot = {
  normalizedLabel: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  dayOfWeek: number | null;
};

function parseServiceSlotSelections(slotText: string) {
  return slotText
    .split(/\r?\n|[|、,]/)
    .map((slot) => slot.trim())
    .filter(Boolean);
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

function parseServiceSlot(slotLabel: string): ParsedServiceSlot | null {
  const normalizedLabel = slotLabel.trim();
  const weeklyMatch = normalizedLabel.match(/^(星期[一二三四五六日天])(上午|下午)$/);
  if (weeklyMatch) {
    const weekday = weeklyMatch[1];
    const part = weeklyMatch[2] as keyof typeof SLOT_PART_WINDOWS;
    const window = SLOT_PART_WINDOWS[part];
    return {
      normalizedLabel,
      startHour: window.startHour,
      startMinute: window.startMinute,
      endHour: window.endHour,
      endMinute: window.endMinute,
      dayOfWeek: WEEKDAY_TO_INDEX[weekday] ?? null
    };
  }

  const match = slotLabel.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }
  return {
    normalizedLabel,
    startHour: Number(match[1]),
    startMinute: Number(match[2]),
    endHour: Number(match[3]),
    endMinute: Number(match[4]),
    dayOfWeek: null
  };
}

function parseServiceSlotList(slotText: string) {
  return [...new Set(parseServiceSlotSelections(slotText))]
    .map((slot) => parseServiceSlot(slot))
    .filter((slot): slot is ParsedServiceSlot => Boolean(slot))
    .sort((left, right) => {
      const leftDay = left.dayOfWeek ?? Number.MAX_SAFE_INTEGER;
      const rightDay = right.dayOfWeek ?? Number.MAX_SAFE_INTEGER;
      if (leftDay !== rightDay) {
        return leftDay - rightDay;
      }
      const leftStart = left.startHour * 60 + left.startMinute;
      const rightStart = right.startHour * 60 + right.startMinute;
      return leftStart - rightStart;
    });
}

function buildIsoAt(dayOffset: number, hour: number, minute: number): string {
  return formatISO(addMinutes(addDays(startOfDay(new Date()), dayOffset), hour * 60 + minute));
}

function buildAutoSchedule(
  db: AppDb,
  patient: Patient,
  caregiverId: string,
  serviceSlotLabel: string,
  dayOffset: number,
  position: number
): VisitSchedule | null {
  const parsedSlot = parseServiceSlot(serviceSlotLabel);
  if (!parsedSlot) {
    return null;
  }

  const startMinutes =
    parsedSlot.startHour * 60 + parsedSlot.startMinute + position * AUTO_SLOT_INTERVAL_MINUTES;
  const endMinutes = startMinutes + AUTO_VISIT_DURATION_MINUTES;
  const startHour = Math.floor(startMinutes / 60);
  const startMinute = startMinutes % 60;
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  const scheduledStart = buildIsoAt(dayOffset, startHour, startMinute);
  const scheduledEnd = buildIsoAt(dayOffset, endHour, endMinute);
  const routeGroupId = `${patient.preferred_doctor_id}-${scheduledStart.slice(0, 10)}`;
  const routeOrder =
    db.visit_schedules.filter(
      (schedule) =>
        schedule.assigned_doctor_id === patient.preferred_doctor_id &&
        schedule.scheduled_start_at.slice(0, 10) === scheduledStart.slice(0, 10)
    ).length + 1;

  return {
    id: `vs-auto-${patient.id}`,
    patient_id: patient.id,
    assigned_doctor_id: patient.preferred_doctor_id,
    primary_caregiver_id: caregiverId,
    scheduled_start_at: scheduledStart,
    scheduled_end_at: scheduledEnd,
    estimated_treatment_minutes: AUTO_VISIT_DURATION_MINUTES,
    address_snapshot: patient.home_address,
    location_keyword_snapshot: patient.location_keyword,
    home_latitude_snapshot: patient.home_latitude,
    home_longitude_snapshot: patient.home_longitude,
    arrival_radius_meters: 100,
    geofence_status:
      patient.home_latitude === null || patient.home_longitude === null ? "coordinate_missing" : "idle",
    google_maps_link: buildGoogleMapsSearchUrl(patient.location_keyword, patient.home_address),
    area: defaultAddressArea(patient.home_address),
    service_time_slot: parsedSlot.normalizedLabel,
    route_order: routeOrder,
    route_group_id: routeGroupId,
    tracking_mode: "hybrid",
    tracking_started_at: null,
    tracking_stopped_at: null,
    arrival_confirmed_by: null,
    departure_confirmed_by: null,
    last_feedback_code: null,
    reminder_tags: [...patient.reminder_tags, ...patient.service_needs],
    status: patient.status === "active" ? "scheduled" : "cancelled",
    visit_type:
      patient.service_needs.length > 0
        ? `${patient.service_needs.join(" / ")} / ${patient.primary_diagnosis}`
        : patient.primary_diagnosis,
    note: "由個案管理自動排入",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function findSchedulePlacement(
  db: AppDb,
  patient: Patient,
  serviceSlotLabel: string,
  existingScheduleId?: string
): { dayOffset: number; position: number } | null {
  const parsedSlot = parseServiceSlot(serviceSlotLabel);
  if (!parsedSlot) {
    return null;
  }

  const now = new Date();
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const candidateDate = addDays(startOfDay(now), dayOffset);
    if (
      parsedSlot.dayOfWeek !== null &&
      candidateDate.getDay() !== parsedSlot.dayOfWeek
    ) {
      continue;
    }

    const sameSlotSchedules = db.visit_schedules.filter((schedule) => {
      if (schedule.assigned_doctor_id !== patient.preferred_doctor_id) {
        return false;
      }
      if (schedule.service_time_slot !== parsedSlot.normalizedLabel) {
        return false;
      }
      if (schedule.id === existingScheduleId) {
        return false;
      }
      if (schedule.status === "cancelled") {
        return false;
      }
      return isSameDay(new Date(schedule.scheduled_start_at), candidateDate);
    });

    if (
      dayOffset === 0 &&
      now.getHours() * 60 + now.getMinutes() > parsedSlot.endHour * 60 + parsedSlot.endMinute
    ) {
      continue;
    }

    if (sameSlotSchedules.length < AUTO_SLOT_PATIENT_LIMIT) {
      return {
        dayOffset,
        position: sameSlotSchedules.length
      };
    }
  }

  return null;
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
            patient.status !== "closed" &&
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
      updateDb((db) => ({
        ...db,
        doctors: db.doctors.filter((doctor) => doctor.id !== doctorId)
      }));
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

        let nextSchedules = db.visit_schedules.map((schedule) =>
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
          message: `已結案 ${patient.name}，並移除原排定時段與相關路線。`
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
        const patient = db.patients.find((item) => item.id === patientId);
        if (!patient) {
          result = {
            patientId,
            removed: false,
            removedScheduleCount: 0,
            blockedReason: "找不到指定個案"
          };
          return db;
        }

        const patientSchedules = db.visit_schedules.filter((schedule) => schedule.patient_id === patientId);
        const activeSchedules = patientSchedules.filter((schedule) =>
          ACTIVE_VISIT_STATUSES.includes(schedule.status as (typeof ACTIVE_VISIT_STATUSES)[number])
        );

        if (activeSchedules.length > 0) {
          result = {
            patientId,
            removed: false,
            removedScheduleCount: patientSchedules.length,
            blockedReason: "此個案仍有進行中的訪視流程"
          };
          return db;
        }

        const scheduleIds = new Set(patientSchedules.map((schedule) => schedule.id));
        const caregiverIds = new Set(
          db.caregivers
            .filter((caregiver) => caregiver.patient_id === patientId)
            .map((caregiver) => caregiver.id)
        );

        result = {
          patientId,
          removed: true,
          removedScheduleCount: patientSchedules.length,
          blockedReason: null
        };

        return {
          ...db,
          patients: db.patients.filter((item) => item.id !== patientId),
          caregivers: db.caregivers.filter((caregiver) => caregiver.patient_id !== patientId),
          caregiver_chat_bindings: db.caregiver_chat_bindings.filter(
            (binding) => !caregiverIds.has(binding.caregiver_id)
          ),
          visit_schedules: db.visit_schedules.filter((schedule) => schedule.patient_id !== patientId),
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
          doctor_location_logs: db.doctor_location_logs.filter(
            (log) =>
              !log.linked_visit_schedule_id || !scheduleIds.has(log.linked_visit_schedule_id)
          )
        };
      });

      return result;
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
