import type { Unit, ChartKind, Section } from "../types";
export type Definition = {
  id: string;
  section: Section;
  title: string;
  description: string;
  unit: Unit;
  basisUnit?: Unit;
  chart: ChartKind;
  mode: "sum" | "rate" | "average";
  snapshot?: boolean;
  gate?: "admin" | "finance" | "payroll";
  table: string;
  join?: string;
  date: string;
  eligibilityDate?: string;
  titleSql: string;
  path: string;
  label?: string;
  value?: string;
  base?: string;
  where?: string;
  dimensions?: Partial<
    Record<"fund" | "centre" | "team" | "project" | "programme", string>
  >;
  permission?:
    | "task"
    | "project"
    | "help"
    | "safety"
    | "volunteer"
    | "attendance"
    | "meeting"
    | "content"
    | "social"
    | "service"
    | "safeguarding";
  dateOnly?: boolean;
  person?: string;
};
