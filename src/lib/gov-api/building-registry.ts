import type { RegistryLookupParams } from "./juso";

// 국토교통부 건축HUB 건축물대장정보 서비스(BldRgstHubService) - 표제부 조회.
// https://www.data.go.kr 에서 "건축HUB_건축물대장정보 서비스" 검색 후 활용신청하면 키 발급.
// (구 서비스명 BldRgstService_v2로는 "해당 오픈API 서비스가 없거나 폐기됨" 에러가 남 -
//  data.go.kr 활용신청 상세 페이지의 End Point로 실제 확인 후 교체함)
const REGISTRY_ENDPOINT =
  "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";

export type BuildingRegistryRecord = {
  buildingName: string | null;
  mainPurpose: string | null; // 주용도
  totalFloorAreaM2: number | null; // 연면적
  groundFloorCount: number | null; // 지상층수
  useApprovalDate: string | null; // YYYY-MM-DD
};

export class BuildingRegistryApiError extends Error {}

/**
 * 법정동코드/지번으로 건축물대장 표제부를 조회한다.
 * 집합건물 등 같은 필지에 여러 동이 있으면 여러 건이 반환될 수 있는데,
 * 초기 버전에서는 첫 번째 건만 사용한다 (동 선택 UI는 추후 개선 지점).
 */
export async function fetchBuildingRegistry(
  params: RegistryLookupParams
): Promise<BuildingRegistryRecord | null> {
  const apiKey = process.env.BUILDING_REGISTRY_API_KEY;
  if (!apiKey) {
    throw new BuildingRegistryApiError(
      "BUILDING_REGISTRY_API_KEY가 설정되어 있지 않습니다. .env.local에 건축물대장정보 서비스 키를 추가하세요."
    );
  }

  // data.go.kr이 발급하는 서비스키는 이미 URL 인코딩된("Encoding") 형태라
  // URLSearchParams.set()에 그대로 넣으면 %2B, %3D 같은 문자가 다시 한 번
  // 인코딩되어(%252B 등) 키가 깨진다. serviceKey만 인코딩 없이 직접 붙인다.
  const otherParams = new URLSearchParams({
    sigunguCd: params.sigunguCd,
    bjdongCd: params.bjdongCd,
    platGbCd: params.platGbCd,
    bun: params.bun,
    ji: params.ji,
    numOfRows: "1",
    pageNo: "1",
    _type: "json",
  });
  const url = `${REGISTRY_ENDPOINT}?serviceKey=${apiKey}&${otherParams.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new BuildingRegistryApiError(`건축물대장 API 호출 실패: HTTP ${res.status}`);
  }

  const data = await res.json();
  const header = data?.response?.header;
  if (header?.resultCode && header.resultCode !== "00") {
    throw new BuildingRegistryApiError(
      `건축물대장 API 오류: ${header.resultMsg ?? header.resultCode}`
    );
  }

  const items = data?.response?.body?.items?.item;
  const item = Array.isArray(items) ? items[0] : items;
  if (!item) return null;

  return {
    buildingName: item.bldNm || null,
    mainPurpose: item.mainPurpsCdNm || null,
    totalFloorAreaM2: item.totArea ? Math.round(Number(item.totArea)) : null,
    groundFloorCount: item.grndFlrCnt ? Number(item.grndFlrCnt) : null,
    useApprovalDate: formatRegistryDate(item.useAprDay),
  };
}

// 건축물대장 API는 사용승인일을 "20200515" 형태로 내려준다.
function formatRegistryDate(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length !== 8) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}
