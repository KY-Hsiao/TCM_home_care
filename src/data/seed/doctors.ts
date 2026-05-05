import type { Doctor } from "../../domain/models";
import { stamp } from "./helpers";

export const doctorsSeed: Doctor[] = [
  {
    id: "doc-001",
    name: "蕭坤元醫師",
    license_number: "中醫字第A10231號",
    phone: "0912-110-001",
    specialty: "居家中醫內科",
    service_area: "台北市文山區、信義區",
    google_chat_user_id: "spaces/doctors/users/001",
    google_account_email: "doctor.lin@example.com",
    google_account_logged_in: true,
    google_location_share_url: "https://maps.google.com/?cid=doctor-share-001",
    google_location_share_enabled: true,
    available_service_slots: ["星期三上午", "星期四下午"],
    status: "active",
    ...stamp(-14)
  }
];
