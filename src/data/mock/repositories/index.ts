import type { AppDb } from "../../../domain/models";
import type { AppRepositories } from "../../../domain/repository";
import { createContactRepository } from "./contactRepository";
import { createNotificationRepository } from "./notificationRepository";
import { createPatientRepository } from "./patientRepository";
import { createStaffingRepository } from "./staffingRepository";
import { createVisitRepository } from "./visitRepository";

export function createRepositories(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): AppRepositories {
  return {
    patientRepository: createPatientRepository(getDb, updateDb),
    contactRepository: createContactRepository(getDb, updateDb),
    visitRepository: createVisitRepository(getDb, updateDb),
    notificationRepository: createNotificationRepository(getDb, updateDb),
    staffingRepository: createStaffingRepository(getDb, updateDb)
  };
}
