import BulkImportForm from "@/components/buildings/BulkImportForm";

export default function ImportBuildingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">엑셀로 일괄 등록</h1>
        <p className="mt-1 max-w-xl text-[13px] text-silver-500">
          가지고 계신 엑셀 파일을 그대로 업로드하세요. 컬럼명이 정확히
          같지 않아도(예: &ldquo;건물명&rdquo;, &ldquo;소재지&rdquo;, &ldquo;준공일&rdquo; 등) 자동으로
          인식합니다. 행마다 개별 처리되어 일부 행에 오류가 있어도 나머지는
          정상 등록됩니다.
        </p>
      </div>
      <BulkImportForm />
    </div>
  );
}
