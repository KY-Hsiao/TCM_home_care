import type { CommunicationSettings } from "../../domain/models";
import { stamp } from "./helpers";

export const communicationSettingsSeed: CommunicationSettings = {
  doctor_contact_line_url: "",
  ...stamp(-1)
};
