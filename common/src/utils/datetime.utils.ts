import { DateTime } from "luxon";

export function formatDateTime(
  date = DateTime.now(),
  timezone = "Europe/Rome",
  locale = "it",
  localeString = DateTime.DATETIME_FULL
): string {
  return date
    .setZone("Europe/Rome")
    .setLocale("it")
    .toLocaleString(DateTime.DATETIME_FULL);
}

export function formatItalianDateTime(date = DateTime.now()): string {
  return formatDateTime();
}
