import type { StaffUser } from "./auth";
import { cleanText } from "./stringUtils";
import { callSettingsApi } from "./settingsApi";
import { assertCanManageSettings } from "./settingsShared";

export type CountryKey =
  | "Korea"
  | "Mongolia"
  | "Japan"
  | "Vietnam"
  | "Thailand";

export type CountryTimezone = {
  label: string;
  timezone: string;
};

export const COUNTRY_TIMEZONES: Record<CountryKey, CountryTimezone> = {
  Korea: { label: "대한민국", timezone: "Asia/Seoul" },
  Mongolia: { label: "몽골", timezone: "Asia/Ulaanbaatar" },
  Japan: { label: "일본", timezone: "Asia/Tokyo" },
  Vietnam: { label: "베트남", timezone: "Asia/Ho_Chi_Minh" },
  Thailand: { label: "태국", timezone: "Asia/Bangkok" },
};

export type GeneralSettings = {
  id: "general";
  appCountry: CountryKey;
  appCountryLabel: string;
  appTimezone: string;
  updatedAt?: unknown;
  updatedBy?: string;
  updatedByUid?: string;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  id: "general",
  appCountry: "Korea",
  appCountryLabel: COUNTRY_TIMEZONES.Korea.label,
  appTimezone: COUNTRY_TIMEZONES.Korea.timezone,
};

function normalizeCountryKey(value: unknown): CountryKey {
  const raw = String(value || "").trim() as CountryKey;
  return Object.prototype.hasOwnProperty.call(COUNTRY_TIMEZONES, raw)
    ? raw
    : "Korea";
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  const result = await callSettingsApi("get_general_settings");
  const data = result.data as Partial<GeneralSettings> | null;
  if (!data) return DEFAULT_GENERAL_SETTINGS;
  const appCountry = normalizeCountryKey(data.appCountry);
  const country = COUNTRY_TIMEZONES[appCountry] || COUNTRY_TIMEZONES.Korea;
  return {
    id: "general",
    appCountry,
    appCountryLabel: country.label,
    appTimezone: cleanText(data.appTimezone) || country.timezone,
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy || "",
    updatedByUid: data.updatedByUid || "",
  };
}

export async function saveGeneralSettings(
  appCountry: CountryKey,
  staff: StaffUser
) {
  assertCanManageSettings(staff);

  const normalizedCountry = normalizeCountryKey(appCountry);
  const country = COUNTRY_TIMEZONES[normalizedCountry] || COUNTRY_TIMEZONES.Korea;

  const nextSettings = {
    id: "general",
    appCountry: normalizedCountry,
    appCountryLabel: country.label,
    appTimezone: country.timezone,
  };

  await callSettingsApi("save_general_settings", {
    settings: nextSettings,
    updatedBy: staff.displayName || staff.email || "",
  });

  return nextSettings as GeneralSettings;
}
