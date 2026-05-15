/**
 * KPI table: Spanish | English | Total, per month + per quarter.
 * Rows: Leads In | Referred Out | Signed | % Ref/Leads | % Signed/Ref | % Signed/Leads
 */
import type { KpiBlock } from "../types";
import { monthsThisYear, quartersThisYear, type Range } from "../dateRanges";
import { authAbogado, authPplt } from "../ghl/client";
import { contactsInRange } from "../ghl/contacts";
import {
  classifyOpportunities,
  countByStageEntry,
  streamOpportunities,
} from "../ghl/opportunities";
import { pct } from "./helpers";

interface Triple {
  leads: number;
  referred: number;
  signed: number;
}

async function tripleForRange(
  range: Range,
  bucket: "spanish" | "english"
): Promise<Triple> {
  const auth = bucket === "spanish" ? authAbogado() : authPplt();
  const [contacts, opps] = await Promise.all([
    contactsInRange(auth, range.start, range.end),
    streamOpportunities(auth),
  ]);
  const classified = classifyOpportunities(auth, opps);
  const refMap = countByStageEntry(
    classified,
    range.start,
    range.end,
    (o) =>
      o.stageClass === "referred_out" ||
      o.pipelinePurpose === "co_counsel_tracking" ||
      o.pipelinePurpose === "referral_broker",
    () => 1
  );
  const signedMap = countByStageEntry(
    classified,
    range.start,
    range.end,
    (o) => o.stageClass === "signed",
    () => 1
  );
  return {
    leads: contacts.length,
    referred: refMap.get(1) ?? 0,
    signed: signedMap.get(1) ?? 0,
  };
}

function buildBlock(title: string, spanish: Triple, english: Triple): KpiBlock {
  const totalLeads = spanish.leads + english.leads;
  const totalRef = spanish.referred + english.referred;
  const totalSigned = spanish.signed + english.signed;
  const fmt = (n: number) => n.toLocaleString();
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;
  return {
    title,
    rows: [
      { label: "Leads In (Online)", spanish: fmt(spanish.leads), english: fmt(english.leads), total: fmt(totalLeads) },
      { label: "Referred Out", spanish: fmt(spanish.referred), english: fmt(english.referred), total: fmt(totalRef) },
      { label: "Signed", spanish: fmt(spanish.signed), english: fmt(english.signed), total: fmt(totalSigned) },
      {
        label: "% Referred Out vs Leads In",
        spanish: fmtPct(pct(spanish.referred, spanish.leads)),
        english: fmtPct(pct(english.referred, english.leads)),
        total: fmtPct(pct(totalRef, totalLeads)),
      },
      {
        label: "% Signed vs Referred Out",
        spanish: fmtPct(pct(spanish.signed, spanish.referred)),
        english: fmtPct(pct(english.signed, english.referred)),
        total: fmtPct(pct(totalSigned, totalRef)),
      },
      {
        label: "% Signed vs Leads In",
        spanish: fmtPct(pct(spanish.signed, spanish.leads)),
        english: fmtPct(pct(english.signed, english.leads)),
        total: fmtPct(pct(totalSigned, totalLeads)),
      },
    ],
  };
}

export async function kpiTable(now = new Date()): Promise<{
  months: KpiBlock[];
  quarters: KpiBlock[];
}> {
  const months = monthsThisYear(now);
  const quarters = quartersThisYear(now);

  const monthBlocks = await Promise.all(
    months.map(async (m) => {
      const [es, en] = await Promise.all([
        tripleForRange(m, "spanish"),
        tripleForRange(m, "english"),
      ]);
      return buildBlock(m.label, es, en);
    })
  );

  const quarterBlocks = await Promise.all(
    quarters.map(async (q) => {
      const [es, en] = await Promise.all([
        tripleForRange(q, "spanish"),
        tripleForRange(q, "english"),
      ]);
      return buildBlock(q.label, es, en);
    })
  );

  return { months: monthBlocks, quarters: quarterBlocks };
}
