import type { AdminUser } from "../../domain/models";
import { stamp } from "./helpers";

export const adminUsersSeed: AdminUser[] = [
  {
    id: "admin-001",
    name: "吳佳芸",
    job_title: "居家醫療行政主任",
    email: "chiayun.wu@example.local",
    google_chat_user_id: "spaces/admin/users/001",
    google_account_email: "chiayun.wu@example.local",
    google_account_logged_in: true,
    phone: "02-2765-2101",
    ...stamp(-8)
  },
  {
    id: "admin-002",
    name: "許庭瑄",
    job_title: "排程協作專員",
    email: "tinghsuan.hsu@example.local",
    google_chat_user_id: "spaces/admin/users/002",
    google_account_email: "tinghsuan.hsu@example.local",
    google_account_logged_in: true,
    phone: "02-2765-2102",
    ...stamp(-7)
  }
];
