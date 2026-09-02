import * as XLSX from "xlsx";

type FieldKey =
  | "name"
  | "address"
  | "buildingType"
  | "totalFloorAreaM2"
  | "floorCount"
  | "useApprovalDate"
  | "fireSafetyGrade"
  | "notes"
  | "unitCount"
  | "inspectionCategory";

// 회사마다 컬럼명이 제각각이므로, 필드마다 자주 쓰이는 여러 이름(조건)을 후보로 두고
// 첫 행(헤더)에서 매칭되는 걸 찾는다. 순서대로 시도하며 먼저 매칭되는 것을 사용한다.
const HEADER_CANDIDATES: Record<FieldKey, string[]> = {
  name: ["건축물명", "건물명", "건물이름", "시설명", "명칭", "건축물", "건물", "물건명", "물건"],
  address: ["주소", "소재지", "대지위치", "도로명주소", "지번주소", "위치", "건물주소"],
  buildingType: ["주용도", "용도", "건물용도", "용도구분", "건축물용도"],
  totalFloorAreaM2: [
    "연면적",
    "연면적(㎡)",
    "연면적(m2)",
    "면적",
    "건물면적",
    "총면적",
    "연면적/세대",
  ],
  floorCount: ["층수", "지상층수", "지상층", "층", "총층수"],
  useApprovalDate: [
    "사용승인일",
    "사용승인일자",
    "사용승인년월일",
    "승인일",
    "승인일자",
    "준공일",
    "준공일자",
    "사용승인",
  ],
  fireSafetyGrade: ["소방안전등급", "소방등급", "안전관리등급", "관리등급", "등급"],
  notes: ["비고", "메모", "특이사항", "참고", "비고사항"],
  unitCount: ["세대수", "세대", "세대(호)수", "호수", "총세대수"],
  // "종합"/"작동" 구분 - 있으면 종합점검 행의 사용승인월만 기준으로 삼고, 작동점검
  // 행은 같은 건물의 종합점검월+6개월로 계산한다(같은 건물이 종합/작동 두 행으로
  // 따로 있을 때 두 값을 각각 사용승인일처럼 취급해서 일정이 겹치는 걸 방지).
  inspectionCategory: ["구분", "점검구분", "점검종류", "종류"],
};

const FIELD_LABEL: Record<FieldKey, string> = {
  name: "건축물명",
  address: "주소",
  buildingType: "주용도",
  totalFloorAreaM2: "연면적",
  floorCount: "층수",
  useApprovalDate: "사용승인일",
  fireSafetyGrade: "소방안전등급",
  notes: "비고",
  unitCount: "세대수",
  inspectionCategory: "구분(종합/작동)",
};

// 일반 건축물대장형 시트: 사용승인일까지 필수
const GENERAL_REQUIRED_FIELDS: FieldKey[] = ["name", "address", "buildingType", "useApprovalDate"];
// "01월"~"12월" 처럼 월 이름의 시트: 사용승인일 컬럼이 없는 대신 시트명 자체가
// "매년 반복되는 점검월"을 의미하므로 사용승인일은 요구하지 않는다.
const MONTH_SHEET_REQUIRED_FIELDS: FieldKey[] = ["name", "address"];

const MONTH_SHEET_PATTERN = /^(\d{1,2})\s*월$/;

function detectSheetMonth(sheetName: string): number | null {
  const match = sheetName.trim().match(MONTH_SHEET_PATTERN);
  if (!match) return null;
  const month = Number(match[1]);
  return month >= 1 && month <= 12 ? month : null;
}

export type ParsedBuildingRow = {
  sheetName: string;
  rowNumber: number; // 해당 시트 안에서의 실제 행 번호 (헤더=1행 기준)
  name: string;
  // 주소 컬럼 값이 비어있으면 undefined - 나중에 "주소 채우기"에서 이름으로 검색해 채운다.
  address: string | undefined;
  buildingType: string;
  totalFloorAreaM2: number | undefined;
  floorCount: number | undefined;
  useApprovalDate: string | undefined;
  // 사용승인일을 모르고 "매년 이 달에 반복 점검"만 아는 시트("01월"~"12월")에서 옴
  recurringInspectionMonth: number | undefined;
  fireSafetyGrade: string | undefined;
  notes: string | undefined;
  unitCount: number | undefined;
  isApartment: boolean | undefined; // 세대수 컬럼에 값이 있으면 아파트로 간주
  // "구분" 컬럼에서 읽은 값 - 있으면 종합/작동 계산 분리에 쓰이고, 없으면(컬럼
  // 자체가 없거나 값을 못 알아보면) 기존 방식(이 행의 월을 그대로 사용승인월로) 유지.
  rowInspectionType: "comprehensive" | "operational" | undefined;
};

export type ParsedBuildingsWorkbook = {
  rows: ParsedBuildingRow[];
  // 어떤 우리 필드가 어느 시트의 어떤 실제 컬럼명에 매칭됐는지 (업로드 화면에 그대로 보여줌)
  matchedColumns: { sheetName: string; field: string; label: string; matchedHeader: string }[];
  // 건축물 데이터로 보이지만 필수 컬럼이 없어 통째로 건너뛴 시트
  skippedSheets: { sheetName: string; reason: string }[];
  // 건축물명이 비어있거나 "-"만 있어서 조용히 건너뛴 행 수 (구분용 빈 행 등)
  blankRowsSkipped: number;
  // 같은 건물의 종합/작동점검 행이 하나로 합쳐지면서 사라진(흡수된) 행 수
  mergedRowsCount: number;
};

export class ExcelParseError extends Error {}

export function parseBuildingsWorkbook(buffer: ArrayBuffer): ParsedBuildingsWorkbook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    throw new ExcelParseError("엑셀 파일을 읽을 수 없습니다. 파일 형식을 확인해주세요.");
  }

  if (workbook.SheetNames.length === 0) {
    throw new ExcelParseError("시트를 찾을 수 없습니다.");
  }

  const rows: ParsedBuildingRow[] = [];
  const matchedColumns: ParsedBuildingsWorkbook["matchedColumns"] = [];
  const skippedSheets: ParsedBuildingsWorkbook["skippedSheets"] = [];
  let blankRowsSkipped = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const headerRow = (
      XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? []
    ).map((h) => (h === undefined || h === null ? "" : String(h).trim()));

    if (headerRow.every((h) => h === "")) continue; // 빈 시트는 조용히 건너뜀

    const sheetMonth = detectSheetMonth(sheetName);
    const requiredFields = sheetMonth ? MONTH_SHEET_REQUIRED_FIELDS : GENERAL_REQUIRED_FIELDS;

    const { mapping, unmatchedRequired, matchedCount } = matchHeaders(headerRow, requiredFields);

    if (matchedCount === 0) continue; // 우리 필드와 전혀 무관한 시트(안내/커버 시트 등)는 건너뜀

    if (unmatchedRequired.length > 0) {
      const missingLabels = unmatchedRequired.map((f) => FIELD_LABEL[f]).join(", ");
      skippedSheets.push({ sheetName, reason: `필수 항목을 찾지 못함: ${missingLabels}` });
      continue;
    }

    // 헤더 문자열을 컬럼 위치(인덱스)로 매칭한 뒤에는, 값을 읽을 때도 반드시 같은
    // 인덱스 기반으로 읽어야 한다. 예전엔 매칭된 헤더 "문자열"을 object 모드
    // sheet_to_json의 키로 다시 사용했는데, 실제 셀 헤더에 앞뒤 공백이 섞여 있는 경우
    // (예: " 연면적/세대 ") 매칭 단계에서는 trim해서 정상 매칭되지만 값을 읽을 때는
    // trim되지 않은 원본 키로 조회하게 되어 항상 undefined가 나오는 버그가 있었다.
    // 인덱스는 이런 공백 문제와 무관하므로 행 전체를 배열로 읽어 인덱스로 접근한다.
    const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });
    const dataRows = allRows.slice(1); // 1행은 헤더

    const get = (row: unknown[], field: FieldKey) => {
      const index = mapping[field];
      return index === undefined ? undefined : row[index];
    };

    dataRows.forEach((row, idx) => {
      const name = toTrimmedString(get(row, "name"));
      if (!name) {
        // 건축물명이 없는 행(빈 행, 구분용 행, "-"만 있는 행 등)은 조용히 건너뜀
        blankRowsSkipped += 1;
        return;
      }

      const rawNotes = toTrimmedString(get(row, "notes")) || undefined;
      const rowInspectionType = normalizeInspectionCategory(get(row, "inspectionCategory"));

      // "세대수" 전용 컬럼이 있으면 그걸 우선 쓰고, 없으면 연면적 셀 안에
      // "20,053.26㎡/121세대"처럼 같이 적혀 있는 세대수를 뽑아낸다.
      const { area: parsedArea, units: parsedUnits } = parseAreaAndUnits(
        get(row, "totalFloorAreaM2")
      );
      const totalFloorAreaM2 = parsedArea;
      const unitCount = toOptionalNumber(get(row, "unitCount")) ?? parsedUnits;
      const isApartment = unitCount !== undefined ? true : undefined;

      if (sheetMonth) {
        // 사용승인일이 없으므로 연/일자를 지어내지 않고, 시트명이 뜻하는 반복
        // 점검월만 그대로 저장한다 (recurringInspectionMonth).
        const note = `[가져오기: 실제 사용승인일 정보 없음 - '${sheetName}' 시트 기준 매년 ${sheetMonth}월 반복 점검으로 등록]`;

        rows.push({
          sheetName,
          rowNumber: idx + 2,
          name,
          address: toTrimmedString(get(row, "address")) || undefined,
          buildingType: toTrimmedString(get(row, "buildingType")) || "미상",
          totalFloorAreaM2,
          floorCount: toOptionalNumber(get(row, "floorCount")),
          useApprovalDate: undefined,
          recurringInspectionMonth: sheetMonth,
          fireSafetyGrade: toTrimmedString(get(row, "fireSafetyGrade")) || undefined,
          notes: rawNotes ? `${rawNotes} ${note}` : note,
          unitCount,
          isApartment,
          rowInspectionType,
        });
      } else {
        rows.push({
          sheetName,
          rowNumber: idx + 2, // 1행은 헤더이므로 데이터는 2행부터
          name,
          address: toTrimmedString(get(row, "address")) || undefined,
          buildingType: toTrimmedString(get(row, "buildingType")),
          totalFloorAreaM2,
          floorCount: toOptionalNumber(get(row, "floorCount")),
          useApprovalDate: toDateString(get(row, "useApprovalDate")) || undefined,
          recurringInspectionMonth: undefined,
          fireSafetyGrade: toTrimmedString(get(row, "fireSafetyGrade")) || undefined,
          notes: rawNotes,
          unitCount,
          isApartment,
          rowInspectionType,
        });
      }
    });

    for (const [field, index] of Object.entries(mapping) as [FieldKey, number][]) {
      matchedColumns.push({
        sheetName,
        field,
        label: FIELD_LABEL[field],
        matchedHeader: headerRow[index],
      });
    }
    if (sheetMonth) {
      matchedColumns.push({
        sheetName,
        field: "recurringInspectionMonth",
        label: "반복 점검월",
        matchedHeader: `(시트명 '${sheetName}' 기준 - 매년 ${sheetMonth}월 반복)`,
      });
    }
  }

  if (rows.length === 0) {
    if (skippedSheets.length > 0) {
      const details = skippedSheets.map((s) => `${s.sheetName}(${s.reason})`).join(" / ");
      throw new ExcelParseError(`모든 시트에서 필수 항목을 찾지 못했습니다: ${details}`);
    }
    if (blankRowsSkipped > 0) {
      throw new ExcelParseError("건축물명이 채워진 행이 하나도 없습니다.");
    }
    throw new ExcelParseError("업로드한 파일에서 인식 가능한 데이터를 찾지 못했습니다.");
  }

  const { rows: mergedRows, mergedCount } = mergeComprehensiveOperationalPairs(rows);

  return { rows: mergedRows, matchedColumns, skippedSheets, blankRowsSkipped, mergedRowsCount: mergedCount };
}

// "구분" 컬럼값을 종합/작동으로 정규화한다. 컬럼이 없거나 못 알아보는 값이면
// undefined - 이 경우 해당 행은 기존 방식(행의 월을 그대로 사용승인월로) 그대로 둔다.
function normalizeInspectionCategory(value: unknown): "comprehensive" | "operational" | undefined {
  const text = toTrimmedString(value);
  if (!text) return undefined;
  if (text.includes("종합")) return "comprehensive";
  if (text.includes("작동")) return "operational";
  return undefined;
}

// 같은 건물(이름+주소 동일)이 "종합"/"작동" 구분 값을 가진 행으로 파일에 따로
// 나오면 건물 1개로 합친다. 종합점검 행의 사용승인월(또는 반복 점검월)만 기준으로
// 삼고, 작동점검 행의 월은 버린다 - 작동점검 일정은 종합점검월+6개월로 자동
// 계산되므로(inspection-rules.ts) 작동 행 자체의 월을 사용승인월처럼 쓰면 같은
// 건물에 종합/작동이 겹쳐 잡히는 버그가 생긴다. 구분 컬럼이 없는 행(rowInspectionType
// undefined)은 손대지 않고 그대로 둔다.
function mergeComprehensiveOperationalPairs(
  rows: ParsedBuildingRow[]
): { rows: ParsedBuildingRow[]; mergedCount: number } {
  const groups = new Map<string, ParsedBuildingRow[]>();
  const untouched: ParsedBuildingRow[] = [];

  for (const row of rows) {
    if (!row.rowInspectionType || !row.address) {
      untouched.push(row);
      continue;
    }
    const key = `${row.name.trim()}::${row.address.trim()}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: ParsedBuildingRow[] = [...untouched];
  let mergedCount = 0;

  for (const list of groups.values()) {
    const comprehensive = list.find((r) => r.rowInspectionType === "comprehensive");
    const operationalRows = list.filter((r) => r.rowInspectionType === "operational");

    if (comprehensive) {
      // 작동 행에만 있는 값(연면적 등)이 있으면 종합 행의 빈 필드를 보충한다.
      for (const op of operationalRows) {
        comprehensive.totalFloorAreaM2 ??= op.totalFloorAreaM2;
        comprehensive.floorCount ??= op.floorCount;
        comprehensive.fireSafetyGrade ??= op.fireSafetyGrade;
        comprehensive.unitCount ??= op.unitCount;
        comprehensive.isApartment ??= op.isApartment;
      }
      if (operationalRows.length > 0) {
        const note = `[가져오기: 같은 이름·주소의 작동점검 행(${operationalRows
          .map((r) => `${r.sheetName} ${r.rowNumber}행`)
          .join(", ")})과 병합됨]`;
        comprehensive.notes = comprehensive.notes ? `${comprehensive.notes} ${note}` : note;
        mergedCount += operationalRows.length;
      }
      result.push(comprehensive);
    } else if (operationalRows.length > 0) {
      // 종합점검 행이 없어서 종합점검월을 알 수 없다 - 작동 행의 월을 사용승인월처럼
      // 쓰면 안 되므로 대표 행 하나만 남기고 월 정보는 비운다(나중에 수정 페이지나
      // 건축물대장 대조에서 채우도록).
      const [first, ...rest] = operationalRows;
      const note =
        "[가져오기: 작동점검 행만 있고 같은 건물의 종합점검 행을 찾지 못해 점검 일정 없이 등록됨 - 종합점검월(사용승인일)을 나중에 채워주세요]";
      result.push({
        ...first,
        useApprovalDate: undefined,
        recurringInspectionMonth: undefined,
        notes: first.notes ? `${first.notes} ${note}` : note,
      });
      mergedCount += rest.length;
    }
  }

  return { rows: result, mergedCount };
}

function matchHeaders(headerRow: string[], requiredFields: FieldKey[]) {
  // 정규화된 헤더 텍스트 -> 컬럼 인덱스. 같은 정규화 결과가 여러 번 나오면
  // 첫 번째(가장 왼쪽) 컬럼을 사용한다.
  const normalizedToIndex = new Map<string, number>();
  headerRow.forEach((h, index) => {
    if (!h) return;
    const normalized = normalizeHeader(h);
    if (!normalizedToIndex.has(normalized)) normalizedToIndex.set(normalized, index);
  });

  const mapping: Partial<Record<FieldKey, number>> = {};
  for (const [field, candidates] of Object.entries(HEADER_CANDIDATES) as [
    FieldKey,
    string[],
  ][]) {
    for (const candidate of candidates) {
      const index = normalizedToIndex.get(normalizeHeader(candidate));
      if (index !== undefined) {
        mapping[field] = index;
        break;
      }
    }
  }

  const matchedCount = Object.keys(mapping).length;
  const unmatchedRequired = requiredFields.filter((f) => mapping[f] === undefined);
  return { mapping, unmatchedRequired, matchedCount };
}

// 공백/괄호/단위 표기 차이를 흡수해서 비교 ("연면적(㎡)" ~ "연면적" 등). 괄호는
// 문자만 지우는 게 아니라 그 안의 설명 텍스트까지 통째로 제거한다 - 안 그러면
// "구분(종합/작동)"처럼 괄호 안에 부연설명이 붙은 실제 헤더가 후보("구분")와
// 정확히 일치하지 않아 컬럼을 못 찾는 버그가 있었다(조용히 무시되어 사용자가
// 알아채기 어려움).
function normalizeHeader(h: string): string {
  return h
    .replace(/[(（][^()（）]*[)）]/g, "")
    .replace(/\s+/g, "")
    .replace(/[[\]㎡m2]/gi, "")
    .toLowerCase();
}

// 대시류 문자만 있는 값("-", "‐", "–", "—")은 실무에서 "해당 없음"을 표시할 때
// 흔히 쓰는 관례라, 실제로는 빈 값과 같은 의미로 취급한다.
const BLANK_PLACEHOLDER_PATTERN = /^[-‐–—]+$/;

function toTrimmedString(value: unknown): string {
  if (value === undefined || value === null) return "";
  const trimmed = String(value).trim();
  return BLANK_PLACEHOLDER_PATTERN.test(trimmed) ? "" : trimmed;
}

// "2,137.33㎡" 처럼 단위가 붙어 있어도 맨 앞의 숫자 토큰만 뽑아서 파싱한다.
function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : undefined;

  const match = String(value).match(/[\d,]+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

// 연면적 컬럼에 "20,053.26㎡/121세대"처럼 세대수까지 같이 적혀 있는 실무 파일이
// 있어서, 맨 앞 숫자는 면적으로, "N세대" 패턴은 세대수로 따로 뽑아낸다.
// 연면적은 0 이하 값이 나오면(오타 등) 그냥 "모름"으로 취급한다 - 등록을 막지
// 않고 나중에 "연면적 채우기"에서 정부 데이터로 채우게 한다.
function parseAreaAndUnits(value: unknown): { area: number | undefined; units: number | undefined } {
  if (typeof value === "number") {
    return {
      area: Number.isFinite(value) && value > 0 ? Math.round(value) : undefined,
      units: undefined,
    };
  }
  if (value === undefined || value === null || value === "") {
    return { area: undefined, units: undefined };
  }

  const str = String(value);
  const areaMatch = str.match(/[\d,]+(?:\.\d+)?/);
  const area = areaMatch ? Number(areaMatch[0].replace(/,/g, "")) : NaN;

  const unitsMatch = str.match(/([\d,]+)\s*세대/);
  const units = unitsMatch ? Number(unitsMatch[1].replace(/,/g, "")) : NaN;

  return {
    area: Number.isFinite(area) && area > 0 ? Math.round(area) : undefined,
    units: Number.isFinite(units) ? Math.round(units) : undefined,
  };
}

// 엑셀은 날짜를 JS Date(cellDates 옵션 사용 시), 일련번호(숫자), 또는 문자열로 줄 수 있다.
// 파싱에 실패하면 빈 문자열을 돌려준다 - 사용승인일도 이제 optional이라, 등록을
// 막는 대신 "모름"으로 두고 나중에 정부 데이터로 채울 수 있게 한다.
function toDateString(value: unknown): string {
  if (value instanceof Date) return formatUtcDate(value);

  if (typeof value === "number") {
    // 엑셀 날짜 일련번호: 1899-12-30 기준 일수
    const utcMs = Math.round((value - 25569) * 86400 * 1000);
    return formatUtcDate(new Date(utcMs));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatUtcDate(parsed);
    return ""; // 파싱 실패 - "모름"으로 취급
  }

  return "";
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
