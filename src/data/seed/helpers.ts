import { addDays, addHours, addMinutes, formatISO, startOfDay } from "date-fns";
import { buildGoogleMapsSearchUrl } from "../../shared/utils/location-keyword";

const baseDay = startOfDay(new Date());

export function at(dayOffset: number, hour: number, minute = 0): string {
  return formatISO(addMinutes(addHours(addDays(baseDay, dayOffset), hour), minute));
}

export function after(isoTime: string, minutes: number): string {
  return formatISO(addMinutes(new Date(isoTime), minutes));
}

export function mapsLink(address: string, locationKeyword = "同住址"): string {
  return buildGoogleMapsSearchUrl(locationKeyword, address);
}

export function stamp(dayOffset = 0): { created_at: string; updated_at: string } {
  return {
    created_at: at(dayOffset, 8, 0),
    updated_at: at(dayOffset, 9, 0)
  };
}
