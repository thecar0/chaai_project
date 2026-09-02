import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";

const HEADERS = ["건축물명", "주소", "주용도", "연면적", "층수", "사용승인일", "소방안전등급", "비고"];
const EXAMPLE_ROW = [
  "예시빌딩",
  "서울특별시 강남구 테헤란로 152",
  "업무시설",
  15000,
  20,
  "2020-05-15",
  "1급",
  "",
];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, EXAMPLE_ROW]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "건축물목록");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="buildings_template.xlsx"',
    },
  });
}
