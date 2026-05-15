/**
 * Load mapping.json from disk and provide cached, typed access.
 * Mapping is read once per server process and re-used across requests.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  LocationKey,
  Mapping,
  MappingLocation,
  MappingPipeline,
} from "./types";

let cached: Mapping | null = null;

export function getMapping(): Mapping {
  if (cached) return cached;
  // mapping.json lives at the repo root (alongside package.json), copied from
  // the discovery script. The dashboard reads it but never writes it.
  const p = path.join(process.cwd(), "mapping.json");
  const raw = fs.readFileSync(p, "utf-8");
  cached = JSON.parse(raw) as Mapping;
  return cached;
}

export function getLocation(key: LocationKey): MappingLocation {
  return getMapping().locations[key];
}

export function pipelinesIncludedInMetrics(
  loc: MappingLocation
): MappingPipeline[] {
  return loc.pipelines.filter((p) => p.include_in_metrics);
}

export function activePracticePipelines(
  loc: MappingLocation
): MappingPipeline[] {
  return loc.pipelines.filter((p) => p.purpose === "active_practice");
}

export function coCounselPipelines(loc: MappingLocation): MappingPipeline[] {
  return loc.pipelines.filter(
    (p) =>
      p.purpose === "co_counsel_tracking" || p.purpose === "referral_broker"
  );
}

/** Stage id → {pipeline name, stage name, class, practice area, co-counsel firm}. */
export function buildStageIndex(loc: MappingLocation) {
  const idx = new Map<
    string,
    {
      pipelineId: string;
      pipelineName: string;
      pipelinePurpose: MappingPipeline["purpose"];
      practiceArea: MappingPipeline["practice_area"];
      coCounselFirm: MappingPipeline["co_counsel_firm"];
      stageName: string;
      stageClass: MappingPipeline["stages"][number]["class"];
      includeInMetrics: boolean;
    }
  >();
  for (const p of loc.pipelines) {
    for (const s of p.stages) {
      idx.set(s.id, {
        pipelineId: p.id,
        pipelineName: p.name,
        pipelinePurpose: p.purpose,
        practiceArea: p.practice_area,
        coCounselFirm: p.co_counsel_firm,
        stageName: s.name,
        stageClass: s.class,
        includeInMetrics: p.include_in_metrics,
      });
    }
  }
  return idx;
}

/** All tag IDs whose class === "referred_out". */
export function referredOutTagIds(loc: MappingLocation): Set<string> {
  return new Set(
    loc.tags.filter((t) => t.class === "referred_out").map((t) => t.id)
  );
}

export function intakeUsers(loc: MappingLocation) {
  return loc.intake_users;
}

const PRACTICE_AREA_LABELS: Record<string, string> = {
  auto: "Auto",
  dog_bite: "Dog Bite",
  workers_comp: "Workers' Comp",
  mass_tort_hair_relaxer: "Mass Tort: Hair Relaxer",
  mass_tort_upf: "Mass Tort: Ultra Processed Foods",
  disability: "Disability",
  slip_and_fall: "Slip & Fall",
  medical_malpractice: "Medical Malpractice",
  wrongful_death: "Wrongful Death",
  nursing_home: "Nursing Home",
  general_pi: "Personal Injury (general)",
  other_in_house: "Other (in-house)",
  other: "Other",
};

export function practiceAreaLabel(key: string | null | undefined): string {
  if (!key) return "Other";
  return PRACTICE_AREA_LABELS[key] ?? key;
}

const STAGE_CLASS_LABELS: Record<string, string> = {
  lead: "Lead",
  active: "Active",
  signed: "Signed",
  referred_out: "Referred Out",
  withdrawn: "Withdrawn",
  closed_lost: "Closed / Lost",
};

export function stageClassLabel(c: string): string {
  return STAGE_CLASS_LABELS[c] ?? c;
}
