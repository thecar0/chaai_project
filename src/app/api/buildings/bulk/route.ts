import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import { buildingSchema } from "@/lib/validators";
import { createBuildingsBatch, type BatchBuildingItem } from "@/lib/create-building";
import { ExcelParseError, parseBuildingsWorkbook, type ParsedBuildingRow } from "@/lib/excel-buildings";
import { isLikelyTopTierBuilding } from "@/lib/capacity";
import { lookupAddressForRegistry } from "@/lib/gov-api/juso";
import { fetchBuildingRegistry } from "@/lib/gov-api/building-registry";

// 여러 행을 한 번의 INSERT로 묶어서 처리하기 때문에(createBuildingsBatch),
// 이 한도는 DB 성능이 아니라 "잘못 올라온 초대형 파일" 방지용 안전장치에 가깝다.
const MAX_ROWS = 5000;

type RowResult = {
  sheetName: string;
  rowNumber: number;
  success: boolean;
  name?: string;
  error?: string;
};

// 건물명+주소가 둘 다 같으면 같은 건물로 본다. 주소가 없는 행은 비교할 수
// 없으니(빈 주소끼리는 서로 다른 건물일 수 있음) 중복 검사에서 제외한다.
function duplicateKey(name: string, address: string): string {
  return `${name.trim()}::${address.trim()}`;
}

async function getExistingDuplicateKeys(userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ name: buildings.name, address: buildings.address })
    .from(buildings)
    .where(eq(buildings.userId, userId));

  const keys = new Set<string>();
  for (const r of rows) {
    if (r.address) keys.add(duplicateKey(r.name, r.address));
  }
  return keys;
}

// 특급대상물(추정)은 연 2회(반기별) 종합점검이라 정확한 사용승인일이 특히
// 중요하다 - 엑셀 값을 그대로 믿지 않고, 건축물대장에서 실제 사용승인일을
// 조회해서 덮어쓴다. 조회에 실패해도(주소 불명, API 오류, 대장 없음 등) 가져오기
// 자체는 막지 않고 원래 값을 그대로 둔다 - 어디까지나 정확도를 높이는 보정이지
// 필수 검증 단계는 아니다. 정부 API(juso.go.kr/data.go.kr)가 순간적으로
// 불안정할 때가 있어(관찰됨: 동일 요청이 직후 재시도 시 성공), 실패 시 한 번만
// 재시도한다.
async function lookupTopTierApprovalDateOnce(row: ParsedBuildingRow): Promise<string | null> {
  const registryParams = await lookupAddressForRegistry(row.address!);
  if (!registryParams) return null;
  const registry = await fetchBuildingRegistry(registryParams);
  return registry?.useApprovalDate ?? null;
}

async function lookupTopTierApprovalDate(row: ParsedBuildingRow): Promise<string | null> {
  if (!row.address) return null;
  if (!isLikelyTopTierBuilding(row)) return null;
  try {
    return await lookupTopTierApprovalDateOnce(row);
  } catch {
    try {
      return await lookupTopTierApprovalDateOnce(row);
    } catch {
      return null;
    }
  }
}

// 미리보기(엑셀 업로드, multipart) - 실제로 저장하지 않고 행마다 유효성만 검사해서
// 전체 필드를 그대로 돌려준다. 사용자가 화면에서 오류 있는 행을 직접 수정한 뒤
// 커밋(JSON)으로 다시 보낸다.
async function handlePreview(req: NextRequest, userId: number) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "엑셀 파일을 첨부해주세요." }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  let matchedColumns;
  let rows;
  let skippedSheets;
  let blankRowsSkipped;
  let mergedRowsCount;
  try {
    ({ rows, matchedColumns, skippedSheets, blankRowsSkipped, mergedRowsCount } =
      parseBuildingsWorkbook(buffer));
  } catch (err) {
    const message = err instanceof ExcelParseError ? err.message : "엑셀 파일을 읽을 수 없습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `한 번에 최대 ${MAX_ROWS}건까지 업로드할 수 있습니다.` },
      { status: 400 }
    );
  }

  const existingKeys = await getExistingDuplicateKeys(userId);
  const seenInFile = new Set<string>();

  // 특급대상물로 추정되는 행들은 병렬로 건축물대장을 조회해서 실제 사용승인일을 확보한다.
  const topTierDates = await Promise.all(
    rows.map(async (row) => ({
      key: `${row.sheetName}::${row.rowNumber}`,
      date: await lookupTopTierApprovalDate(row),
    }))
  );
  const topTierDateMap = new Map(
    topTierDates.filter((r) => r.date != null).map((r) => [r.key, r.date as string])
  );

  // 주소·연면적·사용승인일은 저장을 막지는 않지만(나중에 정부 데이터로 채울 수
  // 있으므로), 정보가 빠진 채로 조용히 "정상"으로 자동 등록되면 안 된다 - 사용자가
  // 직접 확인하고 체크해서 등록하도록 어떤 정보가 없는지 구체적으로 표시해준다.
  const previewRows = rows.map((rawRow) => {
    const topTierDate = topTierDateMap.get(`${rawRow.sheetName}::${rawRow.rowNumber}`);
    // 특급대상물 추정 + 건축물대장 조회 성공 시, 엑셀 값 대신 정부 데이터의
    // 사용승인일을 신뢰한다 (반복 점검월만 있던 경우도 정확한 날짜로 대체됨).
    const row: ParsedBuildingRow = topTierDate
      ? {
          ...rawRow,
          useApprovalDate: topTierDate,
          recurringInspectionMonth: undefined,
          notes: rawRow.notes
            ? `${rawRow.notes} [특급대상물 추정 - 건축물대장에서 사용승인일 확인: ${topTierDate}]`
            : `[특급대상물 추정 - 건축물대장에서 사용승인일 확인: ${topTierDate}]`,
        }
      : rawRow;

    const parsed = buildingSchema.safeParse(row);

    const missingFields: string[] = [];
    if (!row.address) missingFields.push("주소");
    if (!row.totalFloorAreaM2) missingFields.push("연면적");
    if (!row.useApprovalDate && !row.recurringInspectionMonth) missingFields.push("사용승인일");

    // 건물명+주소가 이미 저장된 건물, 또는 같은 파일 안의 앞선 행과 겹치면 중복으로
    // 막는다 (주소가 있는 행만 비교 대상).
    let duplicateError: string | undefined;
    if (row.address) {
      const key = duplicateKey(row.name, row.address);
      if (existingKeys.has(key)) {
        duplicateError = "이미 등록된 건물과 이름·주소가 동일합니다 (중복)";
      } else if (seenInFile.has(key)) {
        duplicateError = "파일 안에 이름·주소가 같은 행이 이미 있습니다 (중복)";
      } else {
        seenInFile.add(key);
      }
    }

    const schemaError = parsed.success
      ? undefined
      : (Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? "입력값을 확인해주세요.");

    return {
      ...row,
      key: `${row.sheetName}::${row.rowNumber}`,
      valid: parsed.success && !duplicateError,
      complete: missingFields.length === 0,
      missingFields,
      error: schemaError ?? duplicateError,
    };
  });

  return NextResponse.json({
    rows: previewRows,
    matchedColumns,
    skippedSheets,
    blankRowsSkipped,
    mergedRowsCount,
  });
}

const commitRequestSchema = z.object({
  items: z
    .array(
      z
        .object({
          sheetName: z.string().min(1),
          rowNumber: z.number().int(),
        })
        .catchall(z.unknown())
    )
    .min(1, "등록할 행을 선택해주세요")
    .max(MAX_ROWS, `한 번에 최대 ${MAX_ROWS}건까지 등록할 수 있습니다.`),
});

// 커밋(JSON) - 미리보기 화면에서 사용자가 확인(필요시 직접 수정)한 행 데이터를
// 그대로 받아 다시 검증한 뒤 저장한다. 파일을 다시 파싱하지 않으므로 화면에서
// 고친 값이 그대로 반영된다.
async function handleCommit(req: NextRequest, userId: number) {
  const body = await req.json();
  const parsedBody = commitRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }

  const existingKeys = await getExistingDuplicateKeys(userId);
  const seenInBatch = new Set<string>();

  const results: RowResult[] = [];
  const validItems: BatchBuildingItem[] = [];

  for (const item of parsedBody.data.items) {
    const { sheetName, rowNumber, ...buildingData } = item;
    const parsed = buildingSchema.safeParse(buildingData);
    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
      results.push({
        sheetName,
        rowNumber,
        success: false,
        name: typeof buildingData.name === "string" ? buildingData.name : undefined,
        error: firstError ?? "입력값을 확인해주세요.",
      });
      continue;
    }

    // 미리보기 이후 DB가 바뀌었거나 같은 건을 다시 보냈을 수 있으니 커밋 시점에도
    // 한 번 더 중복을 확인한다 (건너뛰지 않고 여기서 최종적으로 막음).
    if (parsed.data.address) {
      const key = duplicateKey(parsed.data.name, parsed.data.address);
      if (existingKeys.has(key) || seenInBatch.has(key)) {
        results.push({
          sheetName,
          rowNumber,
          success: false,
          name: parsed.data.name,
          error: "이미 등록된 건물과 이름·주소가 동일합니다 (중복)",
        });
        continue;
      }
      seenInBatch.add(key);
    }

    validItems.push({ data: parsed.data, rowNumber, sheetName });
  }

  const batchResults = await createBuildingsBatch(userId, validItems);
  results.push(...batchResults);

  results.sort((a, b) =>
    a.sheetName === b.sheetName ? a.rowNumber - b.rowNumber : a.sheetName.localeCompare(b.sheetName)
  );

  const successCount = results.filter((r) => r.success).length;
  return NextResponse.json({
    results,
    successCount,
    failureCount: results.length - successCount,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return handleCommit(req, session.userId);
  }
  return handlePreview(req, session.userId);
}

const bulkDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "삭제할 건축물을 선택해주세요"),
});

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // 본인 소유 건축물만 삭제 대상에 포함 (다른 사용자의 id를 섞어 보내도 무시됨)
  const deleted = await db
    .delete(buildings)
    .where(and(inArray(buildings.id, parsed.data.ids), eq(buildings.userId, session.userId)))
    .returning({ id: buildings.id });

  return NextResponse.json({ deletedCount: deleted.length });
}
