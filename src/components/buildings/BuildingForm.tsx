"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 설비 유무는 "모름"과 "없음"을 구분해야 해서(모르면 감액하지 않음) 3단계로 받는다.
type TriState = "" | "true" | "false";

function triStateToBoolean(value: TriState): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export default function BuildingForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    address: "",
    buildingType: "",
    totalFloorAreaM2: "",
    floorCount: "",
    useApprovalDate: "",
    fireSafetyGrade: "",
    notes: "",
    hasSprinkler: "" as TriState,
    hasWaterSpray: "" as TriState,
    hasSmokeControl: "" as TriState,
    isMultiUseBusiness: "" as TriState,
    isPerformanceDesign: "" as TriState,
    isApartment: false,
    unitCount: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/buildings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        address: form.address,
        buildingType: form.buildingType,
        totalFloorAreaM2: form.totalFloorAreaM2
          ? Number(form.totalFloorAreaM2)
          : undefined,
        floorCount: form.floorCount ? Number(form.floorCount) : undefined,
        useApprovalDate: form.useApprovalDate,
        fireSafetyGrade: form.fireSafetyGrade || undefined,
        notes: form.notes || undefined,
        hasSprinkler: triStateToBoolean(form.hasSprinkler),
        hasWaterSpray: triStateToBoolean(form.hasWaterSpray),
        hasSmokeControl: triStateToBoolean(form.hasSmokeControl),
        isMultiUseBusiness: triStateToBoolean(form.isMultiUseBusiness),
        isPerformanceDesign: triStateToBoolean(form.isPerformanceDesign),
        isApartment: form.isApartment || undefined,
        unitCount: form.unitCount ? Number(form.unitCount) : undefined,
      }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(
        typeof data.error === "string"
          ? data.error
          : "건축물 등록에 실패했습니다"
      );
      return;
    }

    router.push("/buildings");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-silver-300/70 bg-white p-6 shadow-sm"
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        건축물명
        <input
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        대지위치 / 도로명주소
        <input
          value={form.address}
          onChange={(e) => update("address", e.target.value)}
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        주용도
        <input
          value={form.buildingType}
          onChange={(e) => update("buildingType", e.target.value)}
          placeholder="예: 근린생활시설, 공동주택"
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          required
        />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium text-graphite">
          연면적(㎡)
          <input
            type="number"
            value={form.totalFloorAreaM2}
            onChange={(e) => update("totalFloorAreaM2", e.target.value)}
            className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium text-graphite">
          지상 층수
          <input
            type="number"
            value={form.floorCount}
            onChange={(e) => update("floorCount", e.target.value)}
            className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        사용승인일 (점검 주기 산정 기준)
        <input
          type="date"
          value={form.useApprovalDate}
          onChange={(e) => update("useApprovalDate", e.target.value)}
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        소방안전관리대상물 등급 (선택)
        <input
          value={form.fireSafetyGrade}
          onChange={(e) => update("fireSafetyGrade", e.target.value)}
          placeholder="예: 1급, 2급"
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
        />
      </label>

      <div className="flex flex-col gap-3 rounded-xl bg-silver-50 p-4">
        <p className="text-[12px] font-medium text-silver-500">
          점검인력 배치 계산용 정보 (선택 — 모르면 비워두세요, 불리하게 추정하지 않습니다)
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <TriStateField
            label="스프링클러"
            value={form.hasSprinkler}
            onChange={(v) => update("hasSprinkler", v)}
          />
          <TriStateField
            label="물분무등소화설비"
            value={form.hasWaterSpray}
            onChange={(v) => update("hasWaterSpray", v)}
          />
          <TriStateField
            label="제연설비"
            value={form.hasSmokeControl}
            onChange={(v) => update("hasSmokeControl", v)}
          />
          <TriStateField
            label="다중이용업 포함"
            value={form.isMultiUseBusiness}
            onChange={(v) => update("isMultiUseBusiness", v)}
          />
          <TriStateField
            label="성능위주설계 대상"
            value={form.isPerformanceDesign}
            onChange={(v) => update("isPerformanceDesign", v)}
          />
        </div>

        <label className="flex items-center gap-2 text-[13px] font-medium text-graphite">
          <input
            type="checkbox"
            checked={form.isApartment}
            onChange={(e) => update("isApartment", e.target.checked)}
            className="h-4 w-4 accent-ink"
          />
          아파트 (세대수 기준으로 계산)
        </label>
        {form.isApartment && (
          <label className="flex max-w-[160px] flex-col gap-1.5 text-[13px] font-medium text-graphite">
            세대수
            <input
              type="number"
              value={form.unitCount}
              onChange={(e) => update("unitCount", e.target.value)}
              className="rounded-lg border border-silver-300 bg-white px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
            />
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        비고
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
        />
      </label>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {loading ? "등록 중..." : "등록하고 점검 일정 생성"}
      </button>
    </form>
  );
}

function TriStateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriState;
  onChange: (value: TriState) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-graphite">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TriState)}
        className="rounded-lg border border-silver-300 bg-white px-2.5 py-2 text-[13px] outline-none transition-all duration-150 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/10"
      >
        <option value="">모름</option>
        <option value="true">있음</option>
        <option value="false">없음</option>
      </select>
    </label>
  );
}
