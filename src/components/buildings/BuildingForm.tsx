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

function booleanToTriState(value: boolean | null | undefined): TriState {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

export type BuildingFormInitial = {
  id: number;
  teamId: number | null;
  name: string;
  address: string | null;
  buildingType: string;
  totalFloorAreaM2: number | null;
  floorCount: number | null;
  useApprovalDate: string | null;
  recurringInspectionMonth: number | null;
  fireSafetyGrade: string | null;
  notes: string | null;
  hasSprinkler: boolean | null;
  hasWaterSpray: boolean | null;
  hasSmokeControl: boolean | null;
  isMultiUseBusiness: boolean | null;
  isPerformanceDesign: boolean | null;
  isApartment: boolean | null;
  unitCount: number | null;
};

export default function BuildingForm({
  initial,
  teams,
}: {
  initial?: BuildingFormInitial;
  teams: { id: number; name: string }[];
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [form, setForm] = useState({
    teamId: initial?.teamId?.toString() ?? "",
    name: initial?.name ?? "",
    address: initial?.address ?? "",
    buildingType: initial?.buildingType ?? "",
    totalFloorAreaM2: initial?.totalFloorAreaM2?.toString() ?? "",
    floorCount: initial?.floorCount?.toString() ?? "",
    useApprovalDate: initial?.useApprovalDate ?? "",
    recurringInspectionMonth: initial?.recurringInspectionMonth?.toString() ?? "",
    fireSafetyGrade: initial?.fireSafetyGrade ?? "",
    notes: initial?.notes ?? "",
    hasSprinkler: booleanToTriState(initial?.hasSprinkler),
    hasWaterSpray: booleanToTriState(initial?.hasWaterSpray),
    hasSmokeControl: booleanToTriState(initial?.hasSmokeControl),
    isMultiUseBusiness: booleanToTriState(initial?.isMultiUseBusiness),
    isPerformanceDesign: booleanToTriState(initial?.isPerformanceDesign),
    isApartment: initial?.isApartment ?? false,
    unitCount: initial?.unitCount?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [addressResults, setAddressResults] = useState<
    { roadAddr: string; jibunAddr: string; zipNo: string }[] | null
  >(null);
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState<string | null>(null);

  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryMessage, setRegistryMessage] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleAddressSearch() {
    const keyword = form.address.trim() || form.name.trim();
    if (!keyword) {
      setAddressSearchError("건축물명이나 주소 일부를 먼저 입력해주세요.");
      return;
    }
    setAddressSearchError(null);
    setAddressSearchLoading(true);
    setAddressResults(null);
    try {
      const res = await fetch(`/api/address-search?q=${encodeURIComponent(keyword)}`);
      const data = await res.json();
      if (!res.ok) {
        setAddressSearchError(data.error ?? "주소 검색에 실패했습니다.");
        return;
      }
      if (data.results.length === 0) {
        setAddressSearchError("검색 결과가 없습니다.");
        return;
      }
      setAddressResults(data.results);
    } finally {
      setAddressSearchLoading(false);
    }
  }

  function selectAddress(roadAddr: string, jibunAddr: string) {
    update("address", roadAddr || jibunAddr);
    setAddressResults(null);
  }

  async function handleRegistryLookup() {
    if (!form.address.trim()) {
      setRegistryError("주소를 먼저 입력하거나 검색으로 채워주세요.");
      return;
    }
    setRegistryError(null);
    setRegistryMessage(null);
    setRegistryLoading(true);
    try {
      const res = await fetch("/api/buildings/registry-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: form.address }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegistryError(data.error ?? "건축물대장 조회에 실패했습니다.");
        return;
      }
      const filled: string[] = [];
      if (data.buildingType) {
        update("buildingType", data.buildingType);
        filled.push("주용도");
      }
      if (data.totalFloorAreaM2 != null) {
        update("totalFloorAreaM2", String(data.totalFloorAreaM2));
        filled.push("연면적");
      }
      if (data.floorCount != null) {
        update("floorCount", String(data.floorCount));
        filled.push("지상 층수");
      }
      if (data.useApprovalDate) {
        update("useApprovalDate", data.useApprovalDate);
        filled.push("사용승인일");
      }
      setRegistryMessage(
        filled.length > 0
          ? `건축물대장에서 ${filled.join(", ")}을(를) 채웠습니다.`
          : "건축물대장에서 채울 수 있는 정보를 찾지 못했습니다."
      );
    } finally {
      setRegistryLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch(isEdit ? `/api/buildings/${initial!.id}` : "/api/buildings", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: form.teamId ? Number(form.teamId) : undefined,
        name: form.name,
        address: form.address || undefined,
        buildingType: form.buildingType,
        totalFloorAreaM2: form.totalFloorAreaM2
          ? Number(form.totalFloorAreaM2)
          : undefined,
        floorCount: form.floorCount ? Number(form.floorCount) : undefined,
        useApprovalDate: form.useApprovalDate || undefined,
        recurringInspectionMonth: form.recurringInspectionMonth
          ? Number(form.recurringInspectionMonth)
          : undefined,
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
          : isEdit
            ? "건축물 수정에 실패했습니다"
            : "건축물 등록에 실패했습니다"
      );
      return;
    }

    router.push(isEdit ? `/buildings/${initial!.id}` : "/buildings");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-silver-300/70 bg-white p-6 shadow-sm"
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        담당 팀
        <select
          value={form.teamId}
          onChange={(e) => update("teamId", e.target.value)}
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
        >
          <option value="">미배정</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {teams.length === 0 && (
          <span className="text-[12px] font-normal text-silver-400">
            아직 만든 팀이 없습니다.{" "}
            <a href="/teams" className="text-accent-600 hover:underline">
              팀 관리
            </a>
            에서 먼저 만들 수 있습니다.
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        건축물명
        <input
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          required
        />
      </label>
      <div className="flex flex-col gap-1.5 text-[13px] font-medium text-graphite">
        대지위치 / 도로명주소
        <div className="flex gap-2">
          <input
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            placeholder="직접 입력하거나 검색으로 채울 수 있음"
            className="flex-1 rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          />
          <button
            type="button"
            onClick={handleAddressSearch}
            disabled={addressSearchLoading}
            className="shrink-0 rounded-lg border border-silver-300 bg-white px-3.5 py-2.5 text-[13px] font-medium text-graphite transition-all duration-150 hover:bg-silver-50 active:scale-[0.98] disabled:opacity-50"
          >
            {addressSearchLoading ? "검색 중..." : "주소 검색"}
          </button>
        </div>
        {addressSearchError && <p className="text-[12px] text-red-600">{addressSearchError}</p>}
        {addressResults && (
          <ul className="mt-1 flex max-h-52 flex-col gap-1 overflow-y-auto rounded-lg border border-silver-300 bg-white p-1.5 shadow-sm">
            {addressResults.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => selectAddress(r.roadAddr, r.jibunAddr)}
                  className="w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-silver-50"
                >
                  <span className="block text-graphite">{r.roadAddr || r.jibunAddr}</span>
                  {r.roadAddr && r.jibunAddr && (
                    <span className="block text-[11px] text-silver-500">{r.jibunAddr}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-silver-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-medium text-silver-500">
            주소가 있으면 건축물대장에서 주용도·연면적·층수·사용승인일을 한 번에 가져올 수 있습니다.
          </p>
          <button
            type="button"
            onClick={handleRegistryLookup}
            disabled={registryLoading}
            className="shrink-0 rounded-lg bg-ink px-3.5 py-2.5 text-[13px] font-medium text-white transition-all duration-150 hover:bg-black active:scale-[0.98] disabled:opacity-50"
          >
            {registryLoading ? "조회 중..." : "공공데이터 불러오기"}
          </button>
        </div>
        {registryError && <p className="text-[12px] text-red-600">{registryError}</p>}
        {registryMessage && <p className="text-[12px] text-accent-600">{registryMessage}</p>}
      </div>
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
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium text-graphite">
          사용승인일 (점검 주기 산정 기준)
          <input
            type="date"
            value={form.useApprovalDate}
            onChange={(e) => update("useApprovalDate", e.target.value)}
            className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium text-graphite">
          또는 반복 점검월 (1~12, 사용승인일 모를 때)
          <input
            type="number"
            min={1}
            max={12}
            value={form.recurringInspectionMonth}
            onChange={(e) => update("recurringInspectionMonth", e.target.value)}
            className="rounded-lg border border-silver-300 bg-silver-50 px-3.5 py-2.5 text-sm outline-none transition-all duration-150 focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10"
          />
        </label>
      </div>
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
        {loading ? "저장 중..." : isEdit ? "저장" : "등록하고 점검 일정 생성"}
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
