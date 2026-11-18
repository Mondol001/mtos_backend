import fs from 'fs';
import path from 'path';
import type { KhatianPreview, KhatianRecord, SurveyType } from '../src/types.ts';
import {
  buildKhatianVerificationCode,
  enToBnDigits,
  findMatchedDagsInRecord,
  getPreviewRecord,
  makeSafeDocId,
  normalizeQuery,
  searchKhatianRecords,
} from '../src/utils/landRecords.ts';

interface CSRawItem {
  khatianNo: string;
  owners: string[];
  ownersRaw?: string;
  fatherOrHusband: string;
  dags: string[];
  landAcres: string;
  page: number;
}

interface SARawItem {
  dag: string;
  khatians: string[];
  page: number;
}

export const BUILTIN_DEFAULT_MOUJA_ID = 'sthal-nawhata-74';

export const BUILTIN_MAP_FILES: Record<
  string,
  { filePath: string; title: string; surveyType: string; sheetNo: string }
> = {
  'map-sthal-nawhata-cs-1': {
    filePath: path.resolve(
      process.cwd(),
      'src/assets/images/mouja_map_cs_sheet_1794998630795.jpg'
    ),
    title: 'মৌজা স্থল নওহাটা — সিএস (CS) মৌজা ম্যাপ (সিট ১)',
    surveyType: 'CS',
    sheetNo: 'সিট নং ১',
  },
  'map-sthal-nawhata-sa-1': {
    filePath: path.resolve(
      process.cwd(),
      'src/assets/images/mouja_map_sa_sheet_1794998631071.jpg'
    ),
    title: 'মৌজা স্থল নওহাটা — এসএ (SA) মৌজা ম্যাপ (সিট ১)',
    surveyType: 'SA',
    sheetNo: 'সিট নং ১',
  },
};

function loadCSRecords(): KhatianRecord[] {
  const rawPath = path.resolve(process.cwd(), 'src/data/sthal_nawhata_cs.json');
  if (!fs.existsSync(rawPath)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(rawPath, 'utf-8')) as CSRawItem[];
    return list.map((item, idx) => ({
      id: `builtin-cs-${makeSafeDocId(item.khatianNo)}-${idx}`,
      moujaId: BUILTIN_DEFAULT_MOUJA_ID,
      surveyType: 'CS',
      khatianNo: item.khatianNo,
      owners: item.owners.length > 0 ? item.owners : ['তথ্য সংরক্ষিত'],
      fatherOrHusband: item.fatherOrHusband || '—',
      dags: item.dags.length > 0 ? item.dags : ['—'],
      landAcres: item.landAcres || '০.০০০০',
      page: item.page,
      isBuiltIn: true,
    }));
  } catch {
    return [];
  }
}

function loadSARecords(): KhatianRecord[] {
  const rawPath = path.resolve(process.cwd(), 'src/data/sthal_nawhata_sa.json');
  if (!fs.existsSync(rawPath)) return [];
  try {
    const rawData = JSON.parse(fs.readFileSync(rawPath, 'utf-8')) as any[];
    return rawData.map((item, idx) => {
      if (item.khatianNo) {
        return {
          id: `builtin-sa-${makeSafeDocId(String(item.khatianNo))}-${idx}`,
          moujaId: BUILTIN_DEFAULT_MOUJA_ID,
          surveyType: 'SA',
          khatianNo: String(item.khatianNo),
          owners: Array.isArray(item.owners) && item.owners.length > 0 ? item.owners : [item.ownersRaw || 'তথ্য সংরক্ষিত'],
          fatherOrHusband: item.fatherOrHusband || '—',
          dags: Array.isArray(item.dags) && item.dags.length > 0 ? item.dags : ['—'],
          landAcres: item.landAcres || '০.০০০০',
          page: item.page || 1,
          isBuiltIn: true,
        };
      }
      return {
        id: `builtin-sa-${makeSafeDocId(String(item.dag))}-${idx}`,
        moujaId: BUILTIN_DEFAULT_MOUJA_ID,
        surveyType: 'SA',
        khatianNo: String(item.khatianNo || item.dag),
        owners: [`স্থল নওহাটা মৌজা · এসএ খতিয়ান`],
        fatherOrHusband: '—',
        dags: item.dags || [String(item.dag)],
        landAcres: '০.০০০০',
        page: item.page || 1,
        isBuiltIn: true,
      };
    });
  } catch (err) {
    console.error('Error loading SA records:', err);
    return [];
  }
}

const CS_RECORDS = loadCSRecords();
const SA_RECORDS = loadSARecords();
const ALL_BUILTIN_RECORDS: KhatianRecord[] = [...CS_RECORDS, ...SA_RECORDS];

const BY_SURVEY_COUNTS: Record<string, Record<string, number>> = {
  [BUILTIN_DEFAULT_MOUJA_ID]: {
    CS: CS_RECORDS.length,
    SA: SA_RECORDS.length,
  },
};

export function getBuiltInTotalCount(): number {
  return ALL_BUILTIN_RECORDS.length;
}

export function getBuiltInSurveyCounts(moujaId: string): Record<string, number> {
  return BY_SURVEY_COUNTS[moujaId] || {};
}

export function searchBuiltInPreviews(params: {
  moujaId: string;
  surveyType: SurveyType;
  query: string;
  searchField?: 'all' | 'dag' | 'khatian' | 'owner';
  limit?: number;
}): KhatianPreview[] {
  const { moujaId, surveyType, query, searchField = 'all', limit = 50 } = params;
  const matched = searchKhatianRecords(ALL_BUILTIN_RECORDS, {
    moujaId,
    surveyType,
    query,
    searchField,
    limit,
  });

  return matched.map((rec) => {
    const matchedDags = findMatchedDagsInRecord(rec.dags, query, searchField);
    return getPreviewRecord(rec, matchedDags);
  });
}

export function getBuiltInKhatianDetail(
  moujaId: string,
  surveyType: string,
  khatianNo: string
): KhatianRecord | null {
  const normTarget = normalizeQuery(khatianNo);
  const found = ALL_BUILTIN_RECORDS.find(
    (rec) =>
      rec.moujaId === moujaId &&
      rec.surveyType.toUpperCase() === surveyType.toUpperCase() &&
      normalizeQuery(rec.khatianNo) === normTarget
  );
  return found || null;
}

export function verifyBuiltInKhatianMeta(
  moujaId: string,
  surveyType: string,
  khatianNo: string
): {
  valid: boolean;
  verificationCode: string;
  khatianNo?: string;
  surveyType?: string;
  ownerCount?: number;
  dagCount?: number;
  page?: number;
} {
  const rec = getBuiltInKhatianDetail(moujaId, surveyType, khatianNo);
  const verificationCode = buildKhatianVerificationCode(
    moujaId,
    surveyType,
    khatianNo
  );
  if (!rec) {
    return { valid: false, verificationCode };
  }
  return {
    valid: true,
    verificationCode,
    khatianNo: rec.khatianNo,
    surveyType: rec.surveyType,
    ownerCount: rec.owners.length,
    dagCount: rec.dags.length,
    page: rec.page,
  };
}

export function buildWatermarkedMapPreviewSvg(mapId: string): string {
  const meta = BUILTIN_MAP_FILES[mapId];
  const title = meta?.title || 'মৌজা ম্যাপ প্রিভিউ';
  const survey = meta?.surveyType || 'CS/SA';
  const sheet = meta?.sheetNo || 'সিট ১';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#cbd5e1" stroke-width="1"/>
    </pattern>
    <pattern id="plot" width="120" height="90" patternUnits="userSpaceOnUse">
      <path d="M0 30 L50 10 L120 45 L85 90 L15 80 Z" fill="#e2e8f0" fill-opacity="0.45" stroke="#94a3b8" stroke-width="1.2"/>
    </pattern>
  </defs>
  <rect width="800" height="600" fill="#f8fafc"/>
  <rect width="800" height="600" fill="url(#grid)"/>
  <rect width="800" height="600" fill="url(#plot)"/>
  <g transform="rotate(-24 400 300)" opacity="0.22">
    <text x="400" y="210" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="bold" fill="#0f172a">MONDOL TELECOM PROTECTED MAP</text>
    <text x="400" y="310" text-anchor="middle" font-family="sans-serif" font-size="28" font-weight="bold" fill="#047857">${enToBnDigits(survey)} · ${sheet}</text>
    <text x="400" y="400" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="bold" fill="#0f172a">আনলকের পর পূর্ণাঙ্গ ম্যাপ দেখা যাবে</text>
  </g>
  <rect x="18" y="18" width="764" height="564" rx="14" fill="none" stroke="#94a3b8" stroke-dasharray="8 6" stroke-width="2"/>
  <text x="400" y="54" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="600" fill="#334155">${title}</text>
</svg>`;
}
