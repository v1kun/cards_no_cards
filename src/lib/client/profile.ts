"use client";

import { apiFetch } from "./api";

export type TranslationLanguage = "en" | "ru";

export type Profile = {
  id: string;
  preferredLocale: string;
  translationLanguage: TranslationLanguage;
  timezone: string | null;
};

export function getProfile(): Promise<Profile> {
  return apiFetch<{ profile: Profile }>("/api/v1/me").then((r) => r.profile);
}

export function updateProfile(
  changes: Partial<Pick<Profile, "translationLanguage" | "timezone">>,
): Promise<Profile> {
  return apiFetch<{ profile: Profile }>("/api/v1/me", {
    method: "PATCH",
    body: JSON.stringify(changes),
  }).then((r) => r.profile);
}
