import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import type {
  NotificationTask,
  Patient,
  VisitRecord,
  VisitSchedule
} from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { channelLabel, formatDateTime } from "../../shared/utils/format";

const adminActionButtonClass =
  "inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest disabled:cursor-not-allowed disabled:opacity-50";

type ScheduleColumnOptions = {
  getPatientPath: (patientId: string) => string;
  getCoverDoctorId: (schedule: VisitSchedule) => string | undefined;
  onReschedule: (schedule: VisitSchedule) => void;
  onCover: (schedule: VisitSchedule, newDoctorId: string) => void;
  onCancel: (schedule: VisitSchedule) => void;
};

type NotificationColumnOptions = {
  onMarkSent: (task: NotificationTask) => void;
  onMarkAwaitingReply: (task: NotificationTask) => void;
  onClose: (task: NotificationTask) => void;
};

export function getPatientColumns(): ColumnDef<Patient, unknown>[] {
  return [
    {
      accessorKey: "chart_number",
      header: "病歷號"
    },
    {
      accessorKey: "name",
      header: "個案",
      cell: ({ row, getValue }) => (
        <Link to={`/admin/patients/${row.original.id}`} className="font-semibold text-brand-forest">
          {String(getValue())}
        </Link>
      )
    },
    {
      accessorKey: "primary_diagnosis",
      header: "主要狀況"
    },
    {
      accessorKey: "status",
      header: "狀態",
      cell: ({ getValue }) => <Badge value={String(getValue())} compact />
    }
  ];
}

export function getScheduleColumns({
  getPatientPath,
  getCoverDoctorId,
  onReschedule,
  onCover,
  onCancel
}: ScheduleColumnOptions): ColumnDef<VisitSchedule, unknown>[] {
  return [
    {
      accessorKey: "scheduled_start_at",
      header: "預定時間",
      cell: ({ getValue }) => formatDateTime(String(getValue()))
    },
    {
      accessorKey: "patient_id",
      header: "個案 ID"
    },
    {
      accessorKey: "assigned_doctor_id",
      header: "醫師"
    },
    {
      accessorKey: "status",
      header: "狀態",
      cell: ({ getValue }) => <Badge value={String(getValue())} compact />
    },
    {
      id: "actions",
      header: "動作",
      cell: ({ row }) => {
        const schedule = row.original;
        const isLocked = ["completed", "cancelled"].includes(schedule.status);
        const coverDoctorId = getCoverDoctorId(schedule);

        return (
          <div className="flex flex-wrap gap-2">
            <Link to={getPatientPath(schedule.patient_id)} className={adminActionButtonClass}>
              查看個案
            </Link>
            <button
              type="button"
              onClick={() => onReschedule(schedule)}
              disabled={isLocked}
              className={adminActionButtonClass}
            >
              模擬改期
            </button>
            <button
              type="button"
              onClick={() => coverDoctorId && onCover(schedule, coverDoctorId)}
              disabled={isLocked || !coverDoctorId}
              className={adminActionButtonClass}
            >
              模擬改派
            </button>
            <button
              type="button"
              onClick={() => onCancel(schedule)}
              disabled={isLocked}
              className={adminActionButtonClass}
            >
              模擬取消
            </button>
          </div>
        );
      }
    }
  ];
}

export function getNotificationColumns({
  onMarkSent,
  onMarkAwaitingReply,
  onClose
}: NotificationColumnOptions): ColumnDef<NotificationTask, unknown>[] {
  return [
    {
      accessorKey: "recipient_name",
      header: "對象"
    },
    {
      accessorKey: "channel",
      header: "管道",
      cell: ({ getValue }) => channelLabel(getValue() as NotificationTask["channel"])
    },
    {
      accessorKey: "scheduled_send_at",
      header: "預定送出",
      cell: ({ getValue }) => formatDateTime(String(getValue()))
    },
    {
      accessorKey: "status",
      header: "狀態",
      cell: ({ getValue }) => <Badge value={String(getValue())} compact />
    },
    {
      id: "actions",
      header: "動作",
      cell: ({ row }) => {
        const task = row.original;

        return (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onMarkSent(task)}
              disabled={task.status === "sent"}
              className={adminActionButtonClass}
            >
              標記已送出
            </button>
            <button
              type="button"
              onClick={() => onMarkAwaitingReply(task)}
              disabled={task.status === "awaiting_reply"}
              className={adminActionButtonClass}
            >
              標記待回覆
            </button>
            <button
              type="button"
              onClick={() => onClose(task)}
              disabled={task.status === "closed"}
              className={adminActionButtonClass}
            >
              結案
            </button>
          </div>
        );
      }
    }
  ];
}

export function getVisitRecordColumns(): ColumnDef<VisitRecord, unknown>[] {
  return [
    {
      accessorKey: "visit_schedule_id",
      header: "排程 ID"
    },
    {
      accessorKey: "departure_time",
      header: "出發時間",
      cell: ({ getValue }) => formatDateTime((getValue() as string | null) ?? null)
    },
    {
      accessorKey: "arrival_time",
      header: "抵達時間",
      cell: ({ getValue }) => formatDateTime((getValue() as string | null) ?? null)
    },
    {
      accessorKey: "treatment_duration_minutes",
      header: "治療分鐘",
      cell: ({ getValue }) => (getValue() as number | null) ?? "-"
    }
  ];
}
