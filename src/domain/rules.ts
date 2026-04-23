import { addMinutes, differenceInMinutes } from "date-fns";
import type { VisitRecord } from "./models";

type VisitRecordRuleInput = Omit<
  VisitRecord,
  | "stay_duration_minutes"
  | "treatment_start_time"
  | "treatment_end_time"
  | "treatment_duration_minutes"
  | "treatment_duration_manually_adjusted"
  | "inspection_tags"
  | "inspection_other"
  | "listening_tags"
  | "listening_other"
  | "inquiry_tags"
  | "inquiry_other"
  | "palpation_tags"
  | "palpation_other"
  | "medical_history_note"
  | "generated_record_text"
> & {
  treatment_duration_minutes?: number | null;
  treatment_duration_manually_adjusted?: boolean;
  inspection_tags?: string[];
  inspection_other?: string;
  listening_tags?: string[];
  listening_other?: string;
  inquiry_tags?: string[];
  inquiry_other?: string;
  palpation_tags?: string[];
  palpation_other?: string;
  medical_history_note?: string;
  generated_record_text?: string;
};

export function applyVisitRecordRules(
  input: VisitRecordRuleInput,
  estimatedTreatmentMinutes = 30
): VisitRecord {
  const isAdjusted =
    Boolean(input.treatment_duration_manually_adjusted) ||
    (input.treatment_duration_minutes ?? estimatedTreatmentMinutes) !==
      estimatedTreatmentMinutes;
  const treatmentDuration = input.arrival_time
    ? input.treatment_duration_minutes ?? estimatedTreatmentMinutes
    : null;
  const treatmentStart = input.arrival_time;
  const treatmentEnd =
    input.arrival_time && treatmentDuration !== null
      ? addMinutes(new Date(input.arrival_time), treatmentDuration).toISOString()
      : null;
  const stayDuration =
    input.arrival_time && input.departure_from_patient_home_time
      ? differenceInMinutes(
          new Date(input.departure_from_patient_home_time),
          new Date(input.arrival_time)
        )
      : null;

  return {
    ...input,
    inspection_tags: input.inspection_tags ?? [],
    inspection_other: input.inspection_other ?? "",
    listening_tags: input.listening_tags ?? [],
    listening_other: input.listening_other ?? "",
    inquiry_tags: input.inquiry_tags ?? [],
    inquiry_other: input.inquiry_other ?? "",
    palpation_tags: input.palpation_tags ?? [],
    palpation_other: input.palpation_other ?? "",
    medical_history_note: input.medical_history_note ?? "",
    generated_record_text: input.generated_record_text ?? "",
    treatment_start_time: treatmentStart,
    treatment_end_time: treatmentEnd,
    treatment_duration_minutes: treatmentDuration,
    treatment_duration_manually_adjusted: isAdjusted,
    stay_duration_minutes: stayDuration
  };
}
