export type TripSiteTheme = {
  accent: string;
  accentDark: string;
  surface: string;
  background: string;
  heroClassName: string;
};

export type TripSiteConfig = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  startDate: string;
  endDate: string;
  dateLabel: string;
  locationLabel: string;
  theme: TripSiteTheme;
};

export const tripSiteConfigs: Record<string, TripSiteConfig> = {
  [shikokuSaburoSite.slug]: shikokuSaburoSite,
};

export function getTripSiteConfig(slug: string): TripSiteConfig | null {
  return tripSiteConfigs[slug] ?? null;
}
import { shikokuSaburoSite } from "@/sites/shikoku-saburo-bbq-2026/site";
