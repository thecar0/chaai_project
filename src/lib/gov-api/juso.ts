// 행정안전부 도로명주소 API - 주소 문자열을 건축물대장 조회에 필요한
// 법정동코드/지번 코드로 변환한다. https://www.juso.go.kr 개발자센터에서 키 발급.

import { withOneRetry } from "./retry";

const JUSO_ENDPOINT = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

export type RegistryLookupParams = {
  sigunguCd: string; // 시군구코드 5자리
  bjdongCd: string; // 법정동코드 5자리
  platGbCd: "0" | "1"; // 대지구분: 0=대지, 1=산
  bun: string; // 지번 본번 4자리
  ji: string; // 지번 부번 4자리
};

export class JusoApiError extends Error {}

type JusoResultItem = {
  admCd: string;
  mtYn: string;
  lnbrMnnm: string;
  lnbrSlno: string;
  roadAddr: string;
  jibunAddr: string;
  zipNo: string;
};

async function searchJusoList(keyword: string, countPerPage = 1): Promise<JusoResultItem[]> {
  const apiKey = process.env.JUSO_API_KEY;
  if (!apiKey) {
    throw new JusoApiError(
      "JUSO_API_KEY가 설정되어 있지 않습니다. .env.local에 도로명주소 API 키를 추가하세요."
    );
  }

  const url = new URL(JUSO_ENDPOINT);
  url.searchParams.set("confmKey", apiKey);
  url.searchParams.set("currentPage", "1");
  url.searchParams.set("countPerPage", String(countPerPage));
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("resultType", "json");

  const data = await withOneRetry(async () => {
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new JusoApiError(`도로명주소 API 호출 실패: HTTP ${res.status}`);
    }
    return res.json();
  });
  const common = data?.results?.common;
  if (common?.errorCode && common.errorCode !== "0") {
    throw new JusoApiError(`도로명주소 API 오류: ${common.errorMessage ?? common.errorCode}`);
  }

  return data?.results?.juso ?? [];
}

async function searchJuso(keyword: string): Promise<JusoResultItem | null> {
  const list = await searchJusoList(keyword, 1);
  return list[0] ?? null;
}

/**
 * 도로명주소 또는 지번주소 문자열로 검색해 가장 유력한 첫 번째 결과의
 * 법정동코드/지번을 건축물대장 조회 파라미터 형태로 변환해 반환한다.
 * 동일 건물이 여러 필지에 걸쳐 있거나 검색어가 모호하면 여러 결과가 나올 수 있는데,
 * 초기 버전에서는 첫 번째 결과만 사용한다 (다건 처리는 추후 개선 지점).
 */
export async function lookupAddressForRegistry(
  address: string
): Promise<RegistryLookupParams | null> {
  const juso = await searchJuso(address);
  if (!juso) return null;

  // admCd: 10자리 행정구역코드 = 시군구코드(5) + 법정동코드(5)
  const sigunguCd: string = juso.admCd.slice(0, 5);
  const bjdongCd: string = juso.admCd.slice(5, 10);
  const platGbCd: "0" | "1" = juso.mtYn === "1" ? "1" : "0";
  const bun = String(juso.lnbrMnnm ?? "0").padStart(4, "0");
  const ji = String(juso.lnbrSlno ?? "0").padStart(4, "0");

  return { sigunguCd, bjdongCd, platGbCd, bun, ji };
}

export type AddressSearchResult = {
  roadAddr: string;
  jibunAddr: string;
};

/**
 * 주소를 모르는 건물의 이름(또는 다른 키워드)으로 도로명주소를 검색한다.
 * 도로명주소 API는 건물명(예: 아파트/오피스텔 단지명)도 키워드로 검색 가능하다 -
 * "주소 채우기"에서 사용승인일/연면적 채우기와 같은 방식(정부 데이터 1건 조회 후
 * 바로 적용)으로 쓰인다.
 */
export async function searchAddressByKeyword(
  keyword: string
): Promise<AddressSearchResult | null> {
  const juso = await searchJuso(keyword);
  if (!juso) return null;
  return { roadAddr: juso.roadAddr, jibunAddr: juso.jibunAddr };
}

export type AddressCandidate = {
  roadAddr: string;
  jibunAddr: string;
  zipNo: string;
};

/**
 * 건물 등록 화면에서 사용자가 직접 검색어(건물명·도로명·지번 등)를 입력해
 * 후보 주소 목록을 받아 그 중 하나를 고를 수 있게 한다 (검색 결과 1건만
 * 신뢰하는 searchAddressByKeyword와 달리 여러 건을 그대로 보여줌).
 */
export async function searchAddressCandidates(keyword: string): Promise<AddressCandidate[]> {
  const list = await searchJusoList(keyword, 10);
  return list.map((j) => ({ roadAddr: j.roadAddr, jibunAddr: j.jibunAddr, zipNo: j.zipNo }));
}
