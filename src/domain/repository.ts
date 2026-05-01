import type {
  AdminUser,
  Caregiver,
  CaregiverChatBinding,
  ContactLog,
  Doctor,
  DoctorLocationLog,
  LeaveRequest,
  NotificationCenterItem,
  NotificationTask,
  NotificationTemplate,
  Patient,
  Reminder,
  RescheduleAction,
  SavedRoutePlan,
  VisitRecord,
  VisitSchedule
} from "./models";
import type {
  ConfirmationSource,
  FamilyFollowUpStatus,
  NotificationStatus,
  RecipientRole,
  RouteItemStatus,
  UserRole,
  VisitFeedbackCode,
  VisitStatus
} from "./enums";

export type SessionState = {
  role: UserRole;
  activeDoctorId: string;
  activeAdminId: string;
  activeRoutePlanId: string | null;
  authenticatedDoctorId: string | null;
  authenticatedAdminId: string | null;
};

export type PatientUpsertResult = {
  patientId: string;
  chartNumber: string;
  scheduleId: string | null;
  scheduleSynced: boolean;
  skippedReason: string | null;
};

export type PatientRemoveResult = {
  patientId: string;
  removed: boolean;
  removedScheduleCount: number;
  blockedReason: string | null;
};

export type PatientProfile = {
  patient: Patient;
  caregivers: Caregiver[];
  chatBindings: CaregiverChatBinding[];
  recentSchedules: VisitSchedule[];
  contactLogs: ContactLog[];
  visitRecords: VisitRecord[];
  todaySchedule: VisitSchedule | undefined;
};

export type VisitDetail = {
  schedule: VisitSchedule;
  patient: Patient;
  doctor: Doctor;
  caregiver: Caregiver | undefined;
  record: VisitRecord | undefined;
  notifications: NotificationTask[];
};

export type RoutePlanningWindow = {
  date?: string;
  serviceTimeSlot?: "上午" | "下午";
};

export type DoctorDashboard = {
  doctor: Doctor;
  todaySchedules: VisitSchedule[];
  activeSchedules: VisitSchedule[];
  reminders: Reminder[];
  todayRecordCount: number;
  pendingFamilyNotifications: number;
};

export type AdminDashboard = {
  todayVisitTotal: number;
  draftRouteCount: number;
  executedVisitCount: number;
  trackingCount: number;
  pausedCount: number;
  urgentCount: number;
  previousMonth: {
    label: string;
    executedVisitCount: number;
    pausedCount: number;
    urgentCount: number;
  };
  unrecordedCount: number;
  rescheduleCount: number;
  pendingLeaveRequests: LeaveRequest[];
  pendingRescheduleActions: RescheduleAction[];
  draftRoutePlans: SavedRoutePlan[];
  exceptionSchedules: VisitSchedule[];
};

export interface PatientRepository {
  getPatients(): Patient[];
  getPatientById(id: string): Patient | undefined;
  getPatientProfile(id: string): PatientProfile | undefined;
  getPatientsByDoctorSlot(input: {
    doctorId: string;
    weekday: string;
    serviceTimeSlot: "上午" | "下午";
  }): Patient[];
  getDoctors(): Doctor[];
  getAdmins(): AdminUser[];
  upsertDoctor(doctor: Doctor): void;
  removeDoctor(doctorId: string): void;
  upsertAdmin(admin: AdminUser): void;
  removeAdmin(adminId: string): void;
  upsertPatient(patient: Patient): PatientUpsertResult;
  closePatient(patientId: string, reason?: string): {
    patientId: string;
    closed: boolean;
    removedRoutePlans: number;
    removedSchedules: number;
    message: string;
  };
  removePatient(patientId: string): PatientRemoveResult;
  updateCaregiver(
    caregiverId: string,
    patch: Partial<
      Pick<
        Caregiver,
        | "name"
        | "relationship"
        | "phone"
        | "is_primary"
        | "receives_notifications"
        | "preferred_contact_channel"
        | "notes"
      >
    >
  ): void;
  upsertCaregiverChatBinding(
    caregiverId: string,
    payload: {
      googleChatUserId: string;
      googleAccountEmail: string;
      googleAccountLoggedIn: boolean;
      displayName: string;
      isActive: boolean;
    }
  ): void;
  updateDoctorIntegration(
    doctorId: string,
    patch: Partial<
      Pick<
        Doctor,
        | "google_chat_user_id"
        | "google_account_email"
        | "google_account_logged_in"
        | "google_location_share_url"
        | "google_location_share_enabled"
      >
    >
  ): void;
}

export interface ContactRepository {
  createContactLog(log: ContactLog): void;
  getContactLogsByScheduleId(scheduleId: string): ContactLog[];
  getContactLogsByPatientId(patientId: string): ContactLog[];
}

export interface VisitRepository {
  getDoctorDashboard(doctorId: string): DoctorDashboard;
  getSchedules(filters?: {
    doctorId?: string;
    patientId?: string;
    statuses?: VisitStatus[];
    dateFrom?: string;
    dateTo?: string;
    area?: string;
  }): VisitSchedule[];
  getScheduleDetail(id: string): VisitDetail | undefined;
  getVisitRecordByScheduleId(visitScheduleId: string): VisitRecord | undefined;
  getSavedRoutePlans(filters?: {
    doctorId?: string;
    routeDate?: string;
    serviceTimeSlot?: "上午" | "下午";
    executionStatus?: "draft" | "executing" | "archived";
  }): SavedRoutePlan[];
  getSavedRoutePlanById(routePlanId: string): SavedRoutePlan | undefined;
  getActiveRoutePlan(doctorId: string): SavedRoutePlan | undefined;
  getDoctorRouteSchedules(doctorId: string, routePlanId?: string | null): VisitSchedule[];
  getSuggestedRoute(doctorId: string, options?: RoutePlanningWindow): VisitSchedule[];
  getShortestTravelRoute(doctorId: string, options?: RoutePlanningWindow): VisitSchedule[];
  upsertSchedule(schedule: VisitSchedule): void;
  upsertSavedRoutePlan(routePlan: SavedRoutePlan): void;
  deleteSavedRoutePlan(routePlanId: string): void;
  executeRoutePlan(routePlanId: string): SavedRoutePlan | undefined;
  upsertSavedRoutePlanAndExecute(routePlan: SavedRoutePlan): SavedRoutePlan | undefined;
  resetRoutePlanProgress(routePlanId: string): SavedRoutePlan | undefined;
  syncRouteItemStatus(routePlanId: string, patientId: string, status: RouteItemStatus): void;
  upsertVisitRecord(record: VisitRecord): void;
  startVisitTravel(visitScheduleId: string, departureTime?: string): VisitRecord | undefined;
  updateRouteOrder(visitScheduleId: string, routeOrder: number): void;
  confirmArrival(
    visitScheduleId: string,
    confirmedBy: ConfirmationSource,
    recordedAt?: string
  ): VisitRecord | undefined;
  confirmDeparture(
    visitScheduleId: string,
    confirmedBy: ConfirmationSource,
    recordedAt?: string
  ): VisitRecord | undefined;
  recordVisitFeedback(
    visitScheduleId: string,
    feedbackCode: VisitFeedbackCode,
    recordedAt?: string
  ): VisitRecord | undefined;
  updateFamilyFollowUpStatus(
    visitScheduleId: string,
    status: FamilyFollowUpStatus,
    sentAt?: string | null
  ): VisitRecord | undefined;
  rescheduleVisit(input: {
    visitScheduleId: string;
    requestedByRole: UserRole;
    newStartAt: string;
    newEndAt: string;
    reason: string;
    changeSummary: string;
  }): void;
  coverVisit(input: {
    visitScheduleId: string;
    requestedByRole: UserRole;
    newDoctorId: string;
    reason: string;
    changeSummary: string;
  }): void;
  cancelVisit(visitScheduleId: string, reason: string, changeSummary: string): void;
  pauseVisit(visitScheduleId: string, reason: string, changeSummary: string): void;
  getReminders(role: UserRole, ownerId?: string): Reminder[];
  createReminder(reminder: Reminder): void;
  appendDoctorLocationLog(log: DoctorLocationLog): void;
  getDoctorLocationLogs(doctorId: string): DoctorLocationLog[];
}

export interface NotificationRepository {
  getTemplates(): NotificationTemplate[];
  getTasks(filters?: { status?: NotificationStatus }): NotificationTask[];
  getTasksByScheduleId(scheduleId: string): NotificationTask[];
  getTasksByRecipientRole(recipientRole: RecipientRole): NotificationTask[];
  updateTaskDraft(
    taskId: string,
    input: {
      previewPayload?: Record<string, string>;
      caregiverId?: string | null;
      recipientName?: string;
      recipientTarget?: string;
      channel?: NotificationTask["channel"];
    }
  ): void;
  updateTaskStatus(
    taskId: string,
    input: {
      status: NotificationStatus;
      replyExcerpt?: string | null;
      replyCode?: string | null;
      failureReason?: string | null;
    }
  ): void;
  batchUpdateStatuses(taskIds: string[], status: NotificationStatus): void;
  upsertTemplate(template: NotificationTemplate): void;
  createTask(task: NotificationTask): void;
  getNotificationCenterItems(role: UserRole, ownerId?: string): NotificationCenterItem[];
  createNotificationCenterItem(item: NotificationCenterItem): void;
  replyNotificationCenterItem(
    itemId: string,
    replyText: string,
    role: UserRole,
    userId?: string
  ): void;
  markNotificationCenterItemRead(itemId: string): void;
  updateNotificationCenterItemStatus(itemId: string, status: string): void;
  deleteNotificationCenterItem(itemId: string): void;
  deleteNotificationCenterItems(itemIds: string[]): void;
}

export interface StaffingRepository {
  getAdminDashboard(): AdminDashboard;
  getLeaveRequests(): LeaveRequest[];
  getRescheduleActions(): RescheduleAction[];
  createLeaveRequest(input: {
    doctorId: string;
    startDate: string;
    endDate: string;
    reason: string;
    handoffNote: string;
    status?: LeaveRequest["status"];
  }): void;
  updateLeaveRequestStatus(
    leaveRequestId: string,
    status: LeaveRequest["status"],
    options?: { rejectionReason?: string | null }
  ): void;
  deleteLeaveRequest(leaveRequestId: string): void;
  getImpactedSchedules(doctorId: string, startDate: string, endDate: string): VisitSchedule[];
}

export type AppRepositories = {
  patientRepository: PatientRepository;
  contactRepository: ContactRepository;
  visitRepository: VisitRepository;
  notificationRepository: NotificationRepository;
  staffingRepository: StaffingRepository;
};
