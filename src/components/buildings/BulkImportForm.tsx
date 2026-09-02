"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RowResult = {
  sheetName: string;
  rowNumber: number;
  success: boolean;
  name?: string;
  error?: string;
};

// 미리보기 응답의 행 하나 - 커밋 시 이 값 그대로(파일 재파싱 없이) 서버로 보낸다.
type EditableRow = {
  key: string;
  sheetName: string;
  rowNumber: number;
  name: string;
  address: string | undefined;
  buildingType: string;
  totalFloorAreaM2: number | undefined;
  floorCount: number | undefined;
  useApprovalDate: string | undefined;
  recurringInspectionMonth: number | undefined;
  fireSafetyGrade: string | undefined;
  notes: string | undefined;
  unitCount: number | undefined;
  isApartment: boolean | undefined;
  valid: boolean;
  // 주소/연면적/사용승인일이 전부 있어야 true. 없어도 저장은 되지만(나중에 정부
  // 데이터로 채울 수 있음), 조용히 "정상"으로 자동 선택되면 안 되므로 구분한다.
  complete: boolean;
  error?: string;
};

type MatchedColumn = {
  sheetName: string;
  field: string;
  label: string;
  matchedHeader: string;
};

type SkippedSheet = {
  sheetName: string;
  reason: string;
};

export default function BulkImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewRows, setPreviewRows] = useState<EditableRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [matchedColumns, setMatchedColumns] = useState<MatchedColumn[] | null>(null);
  const [skippedSheets, setSkippedSheets] = useState<SkippedSheet[] | null>(null);
  const [blankRowsSkipped, setBlankRowsSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function resetOutputs() {
    setError(null);
    setResults(null);
    setPreviewRows(null);
    setExcluded(new Set());
    setMatchedColumns(null);
    setSkippedSheets(null);
    setBlankRowsSkipped(0);
  }

  async function handlePreview() {
    if (!file) return;
    setPreviewLoading(true);
    resetOutputs();

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/buildings/bulk", { method: "POST", body: formData });
    const data = await res.json();
    setPreviewLoading(false);

    if (!res.ok) {
      setError(data.error ?? "미리보기에 실패했습니다.");
      return;
    }
    const rows: EditableRow[] = data.rows;
    setPreviewRows(rows);
    // 정보가 부족한 행(주소/연면적/사용승인일 중 하나라도 없음)은 저장은 가능해도
    // 조용히 자동 등록되면 안 되므로 기본적으로 선택 해제 상태로 시작한다 -
    // 사용자가 맨 위에서 직접 확인하고 체크해야 등록 대상에 들어간다.
    setExcluded(new Set(rows.filter((r) => r.valid && !r.complete).map((r) => r.key)));
    setMatchedColumns(data.matchedColumns);
    setSkippedSheets(data.skippedSheets);
    setBlankRowsSkipped(data.blankRowsSkipped ?? 0);
  }

  async function handleCommit() {
    if (!previewRows) return;
    const itemsToSend = previewRows.filter((r) => r.valid && !excluded.has(r.key));
    if (itemsToSend.length === 0) return;

    setCommitting(true);
    setError(null);

    const res = await fetch("/api/buildings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: itemsToSend.map((r) => ({
          sheetName: r.sheetName,
          rowNumber: r.rowNumber,
          name: r.name,
          address: r.address,
          buildingType: r.buildingType,
          totalFloorAreaM2: r.totalFloorAreaM2,
          floorCount: r.floorCount,
          useApprovalDate: r.useApprovalDate,
          recurringInspectionMonth: r.recurringInspectionMonth,
          fireSafetyGrade: r.fireSafetyGrade,
          notes: r.notes,
          unitCount: r.unitCount,
          isApartment: r.isApartment,
        })),
      }),
    });
    const data = await res.json();
    setCommitting(false);

    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "등록에 실패했습니다.");
      return;
    }
    setResults(data.results);
    setPreviewRows(null);
    router.refresh();
  }

  function toggleRow(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll(validKeys: string[]) {
    const allExcluded = validKeys.every((k) => excluded.has(k));
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const k of validKeys) {
        if (allExcluded) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  const successCount = results?.filter((r) => r.success).length ?? 0;
  const failureCount = (results?.length ?? 0) - successCount;
  const sheetCount = new Set(results?.map((r) => r.sheetName)).size;
  const multiSheet = sheetCount > 1;

  const validPreviewRows = previewRows?.filter((r) => r.valid) ?? [];
  const invalidPreviewRows = previewRows?.filter((r) => !r.valid) ?? [];
  const incompletePreviewRows = validPreviewRows.filter((r) => !r.complete);
  const completePreviewRows = validPreviewRows.filter((r) => r.complete);
  const includedCount = validPreviewRows.filter((r) => !excluded.has(r.key)).length;
  const previewSheetCount = new Set(previewRows?.map((r) => r.sheetName)).size;
  const previewMultiSheet = previewSheetCount > 1;
  // 형식 오류 → 정보 부족 → 정상 순으로 위에서부터 확인하게 정렬한다.
  const sortedPreviewRows = previewRows
    ? [...invalidPreviewRows, ...incompletePreviewRows, ...completePreviewRows]
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-silver-300/70 bg-white p-6 shadow-sm">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            resetOutputs();
          }}
          className="text-[13px] text-graphite file:mr-3 file:rounded-lg file:border-0 file:bg-silver-100 file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-ink"
        />
        <button
          onClick={handlePreview}
          disabled={!file || previewLoading}
          className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          {previewLoading ? "불러오는 중..." : "미리보기"}
        </button>
        {error && <p className="max-w-xl text-[13px] text-red-600">{error}</p>}
        <a
          href="/api/buildings/bulk/template"
          className="text-[12px] text-silver-500 transition-colors duration-150 hover:text-accent-600"
        >
          컬럼명이 헷갈리면 예시 양식 다운로드
        </a>
        <p className="text-[11px] text-silver-400">
          여러 시트로 나뉜 파일도 시트별로 각각 인식해서 모두 처리합니다. 주소·연면적·
          사용승인일이 없어도 일단 등록되고, 나중에 &ldquo;주소 채우기&rdquo;·&ldquo;연면적
          채우기&rdquo;·건축물대장 대조에서 채울 수 있습니다. 미리보기에서 빼고 싶은
          행은 선택 해제한 뒤 등록하세요.
        </p>
      </div>

      {skippedSheets && skippedSheets.length > 0 && (
        <div className="rounded-2xl border border-[#fdeceb] bg-[#fdeceb]/40 p-5 text-[13px]">
          <p className="mb-1 font-medium text-[#d70015]">건너뛴 시트가 있어요</p>
          <ul className="flex flex-col gap-1 text-[#8a1f18]">
            {skippedSheets.map((s) => (
              <li key={s.sheetName}>
                {s.sheetName} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {matchedColumns && matchedColumns.length > 0 && (
        <div className="rounded-2xl border border-silver-300/70 bg-white p-5 shadow-sm">
          <p className="mb-2 text-[12px] font-medium text-silver-500">
            이렇게 인식했어요
          </p>
          <div className="flex flex-wrap gap-2">
            {matchedColumns.map((c) => (
              <span
                key={`${c.sheetName}-${c.field}`}
                className="rounded-full bg-accent-50 px-2.5 py-1 text-[12px] text-accent-600"
              >
                {previewMultiSheet && `${c.sheetName} · `}
                {c.label} ← &ldquo;{c.matchedHeader}&rdquo;
              </span>
            ))}
          </div>
        </div>
      )}

      {previewRows && (
        <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-silver-200 px-5 py-3 text-[13px] text-graphite">
            <span>
              총 {previewRows.length}건 중{" "}
              <span className="font-medium text-ink">{includedCount}건 선택됨</span>
              {invalidPreviewRows.length > 0 && (
                <span className="text-[#d70015]">
                  {" "}
                  · 형식 오류 {invalidPreviewRows.length}건은 등록에서 제외됨 (위쪽 참고)
                </span>
              )}
              {incompletePreviewRows.length > 0 && (
                <span className="text-[#b25e00]">
                  {" "}
                  · 정보 부족 {incompletePreviewRows.length}건은 기본적으로 선택 해제됨
                  (확인 후 체크하세요)
                </span>
              )}
              {blankRowsSkipped > 0 && (
                <span className="text-silver-500">
                  {" "}
                  · 건축물명이 비어있는 {blankRowsSkipped}개 행은 건너뜀
                </span>
              )}
            </span>
            <button
              onClick={handleCommit}
              disabled={committing || includedCount === 0}
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50"
            >
              {committing ? "등록 중..." : `선택한 ${includedCount}건 등록`}
            </button>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
                  <th className="w-10 px-5 py-2">
                    <input
                      type="checkbox"
                      checked={validPreviewRows.length > 0 && includedCount === validPreviewRows.length}
                      onChange={() => toggleAll(validPreviewRows.map((r) => r.key))}
                      aria-label="전체 선택"
                      className="h-4 w-4 accent-ink"
                    />
                  </th>
                  {previewMultiSheet && <th className="px-5 py-2 font-medium">시트</th>}
                  <th className="px-5 py-2 font-medium">행</th>
                  <th className="px-5 py-2 font-medium">건축물명</th>
                  <th className="px-5 py-2 font-medium">주소</th>
                  <th className="px-5 py-2 font-medium">주용도</th>
                  <th className="px-5 py-2 font-medium">연면적</th>
                  <th className="px-5 py-2 font-medium">사용승인일</th>
                  <th className="px-5 py-2 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {sortedPreviewRows!.map((r) => (
                  <tr
                    key={r.key}
                    className={`border-b border-silver-100 transition-colors duration-150 last:border-0 ${
                      !r.valid
                        ? "bg-[#fdeceb]/30"
                        : !r.complete
                          ? "bg-[#fff4e5]/50 hover:bg-[#fff4e5]/80"
                          : "hover:bg-silver-50"
                    }`}
                  >
                    <td className="px-5 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={r.valid && !excluded.has(r.key)}
                        onChange={() => r.valid && toggleRow(r.key)}
                        disabled={!r.valid}
                        aria-label={`${r.name || r.rowNumber}행 선택`}
                        className="mt-1.5 h-4 w-4 accent-ink"
                      />
                    </td>
                    {previewMultiSheet && (
                      <td className="px-5 py-2 align-top text-graphite">{r.sheetName}</td>
                    )}
                    <td className="px-5 py-2 align-top text-graphite">{r.rowNumber}</td>
                    <td className="px-5 py-2 align-top">{r.name || "-"}</td>
                    <td className="max-w-[200px] truncate px-5 py-2 align-top text-graphite" title={r.address}>
                      {r.address || "-"}
                    </td>
                    <td className="px-5 py-2 align-top text-graphite">{r.buildingType || "-"}</td>
                    <td className="px-5 py-2 align-top text-graphite">
                      {r.totalFloorAreaM2 ? `${r.totalFloorAreaM2}㎡` : "-"}
                    </td>
                    <td className="px-5 py-2 align-top text-graphite">
                      {r.useApprovalDate || (r.recurringInspectionMonth ? `매년 ${r.recurringInspectionMonth}월` : "-")}
                    </td>
                    <td className="px-5 py-2 align-top">
                      {!r.valid ? (
                        <span className="text-[12px] text-[#d70015]">{r.error}</span>
                      ) : !r.complete ? (
                        <span className="text-[12px] text-[#b25e00]">
                          정보 부족 (확인 필요)
                        </span>
                      ) : (
                        <span className="text-[12px] text-silver-400">정상</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results && (
        <div className="overflow-hidden rounded-2xl border border-silver-300/70 bg-white shadow-sm">
          <p className="border-b border-silver-200 px-5 py-3 text-[13px] text-graphite">
            총 {results.length}건 중{" "}
            <span className="font-medium text-[#1d7a34]">{successCount}건 성공</span>
            {failureCount > 0 && (
              <span className="text-[#d70015]"> · {failureCount}건 실패</span>
            )}
          </p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-silver-200 text-left text-[12px] text-silver-500">
                {multiSheet && <th className="px-5 py-2 font-medium">시트</th>}
                <th className="px-5 py-2 font-medium">행</th>
                <th className="px-5 py-2 font-medium">건축물명</th>
                <th className="px-5 py-2 font-medium">결과</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={`${r.sheetName}-${r.rowNumber}`}
                  className="border-b border-silver-100 transition-colors duration-150 last:border-0 hover:bg-silver-50"
                >
                  {multiSheet && (
                    <td className="px-5 py-2 text-graphite">{r.sheetName}</td>
                  )}
                  <td className="px-5 py-2 text-graphite">{r.rowNumber}</td>
                  <td className="px-5 py-2">{r.name || "-"}</td>
                  <td className="px-5 py-2">
                    {r.success ? (
                      <span className="rounded-full bg-[#e8f8ec] px-2 py-0.5 text-[11px] font-medium text-[#1d7a34]">
                        성공
                      </span>
                    ) : (
                      <span className="text-[12px] text-[#d70015]">{r.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
