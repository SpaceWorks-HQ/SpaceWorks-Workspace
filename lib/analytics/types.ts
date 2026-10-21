export const SECTIONS = [
  "home",
  "finance",
  "funding",
  "people",
  "work",
  "operations",
  "marketing",
] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABELS: Record<Section, string> = {
  home: "Overview",
  finance: "Finance",
  funding: "Funding and impact",
  people: "People",
  work: "Projects and work",
  operations: "Operations and governance",
  marketing: "Marketing",
};
export type AnalyticsQuery = {
  section?: string;
  period?: string;
  from?: string;
  to?: string;
  currency?: string;
  fund?: string;
  centre?: string;
  team?: string;
  project?: string;
  programme?: string;
  threshold?: string;
  group?: string;
  page?: string;
  bucket?: string;
  cadence?: string;
  monthlyEmail?: boolean;
  emailTo?: string[];
};
export type Period = { from: string; to: string };
export type Unit = "count" | "money" | "percent" | "hours" | "days" | "minutes";
export type ChartKind =
  | "bar"
  | "stacked"
  | "line"
  | "donut"
  | "sparkline"
  | "funnel"
  | "calendar";
export type Point = {
  label: string;
  value: number;
  base: number;
  count: number;
  numerator?: number;
  previous?: number | null;
  lastYear?: number | null;
};
export type MetricResult = {
  id: string;
  title: string;
  description: string;
  unit: Unit;
  chart: ChartKind;
  snapshot: boolean;
  value: number | null;
  previous: number | null;
  lastYear: number | null;
  count: number;
  numerator: number;
  denominator: number;
  groups: Point[];
  trend: Point[];
  drill: string;
  csv: string;
};
export type Fact = {
  id: string;
  title: string;
  path: string;
  date: string;
  label: string;
  value: number;
  base: number;
};
export type PresetView = {
  id: string;
  name: string;
  section: string;
  query: AnalyticsQuery;
  shared: boolean;
  pinned: boolean;
  commentary: string;
  fileIds: string[];
  ownerId: string;
};
export type ForecastLine = {
  id: string;
  title: string;
  date: string;
  amountMinor: number;
  source: string;
  path: string;
  estimated: boolean;
};
export type ForecastBucket = {
  label: string;
  incomeMinor: number;
  expenseMinor: number;
  closingMinor: number;
  low: boolean;
};
export type ForecastResult = {
  incomplete: boolean;
  asOf: string;
  currency: string;
  openingMinor: number;
  openingKnown: boolean;
  thresholdMinor: number;
  weekly: ForecastBucket[];
  monthly: ForecastBucket[];
  lines: ForecastLine[];
  warnings: string[];
};
export type ResolvedQuery = AnalyticsQuery & {
  section: Section;
  period: string;
  monthlyEmail: boolean;
  emailTo: string[];
};
export type PickerOption = { id: string; name: string };
export type AnalyticsPickers = {
  funds: PickerOption[];
  centres: PickerOption[];
  teams: PickerOption[];
  projects: PickerOption[];
  programmes: PickerOption[];
  admins: PickerOption[];
};
export type AdjustmentView = {
  id: string;
  title: string;
  dueOn: string;
  amountMinor: number;
  currency: string;
  notes: string;
  files: { id: string; filename: string; contentType: string }[];
};
export type DashboardData = {
  q: ResolvedQuery;
  period: Period;
  metrics: MetricResult[];
  workspaceName: string;
  timezone: string;
  admin: boolean;
  viewerId: string;
  sections: Section[];
  presets: PresetView[];
  options: AnalyticsPickers;
};
export type DrillData = {
  title: string;
  description: string;
  unit: Unit;
  basisUnit: Unit;
  q: ResolvedQuery;
  period: Period;
  page: number;
  more: boolean;
  rows: Fact[];
};
export type PackData = {
  period: Period;
  forecast: ForecastResult | null;
  name: string;
  slug: string;
  kind: "management" | "board";
  preset: Pick<PresetView, "id" | "name" | "commentary" | "ownerId">;
  q: ResolvedQuery;
  metrics: MetricResult[];
  title: string;
  print: string;
  query: string;
};
