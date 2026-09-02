import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buildings } from "@/db/schema";
import { getSession } from "@/lib/session";
import { buildingSchema } from "@/lib/validators";
import { createBuildingsBatch, type BatchBuildingItem } from "@/lib/create-building";
import { ExcelParseError, parseBuildingsWorkbook } from "@/lib/excel-buildings";

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

// 미리보기(엑셀 업로드, multipart) - 실제로 저장하지 않고 행마다 유효성만 검사해서
// 전체 필드를 그대로 돌려준다. 사용자가 화면에서 오류 있는 행을 직접 수정한 뒤
// 커밋(JSON)으로 다시 보낸다.
async function handlePreview(req: NextRequest) {
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
  try {
    ({ rows, matchedColumns, skippedSheets, blankRowsSkipped } = parseBuildingsWorkbook(buffer));
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

  // 주소·연면적·사용승인일은 저장을 막지는 않지만(나중에 정부 데이터로 채울 수
  // 있으므로), 정보가 빠진 채로 조용히 "정상"으로 자동 등록되면 안 된다 - 사용자가
  // 직접 확인하고 체크해서 등록하도록 별도로 표시해준다.
  const previewRows = rows.map((row) => {
    const parsed = buildingSchema.safeParse(row);
    const complete =
      Boolean(row.address) &&
      Boolean(row.totalFloorAreaM2) &&
      Boolean(row.useApprovalDate || row.recurringInspectionMonth);
    return {
      ...row,
      key: `${row.sheetName}::${row.rowNumber}`,
      valid: parsed.success,
      complete,
      error: parsed.success
        ? undefined
        : (Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? "입력값을 확인해주세요."),
    };
  });

  return NextResponse.json({ rows: previewRows, matchedColumns, skippedSheets, blankRowsSkipped });
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
  return handlePreview(req);
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
