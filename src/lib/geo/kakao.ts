// 카카오 API로 주소→좌표 변환(지오코딩)과 두 좌표 간 실제 주행거리를 구한다.
// developers.kakao.com에서 REST API 키를 발급받고 "카카오맵"(주소 검색)과
// "Mobility"(길찾기) 두 제품을 모두 활성화해야 한다.

export type Coordinates = { lat: number; lng: number };

export class KakaoApiError extends Error {}

function getApiKey(): string {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    throw new KakaoApiError(
      "KAKAO_REST_API_KEY가 설정되어 있지 않습니다. .env.local에 카카오 REST API 키를 추가하세요."
    );
  }
  return key;
}

/** 주소 문자열을 위경도 좌표로 변환한다. 검색 결과가 없으면 null. */
export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const apiKey = getApiKey();
  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", address);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) {
    throw new KakaoApiError(`카카오 주소 검색 API 호출 실패: HTTP ${res.status}`);
  }

  const data = await res.json();
  const doc = data?.documents?.[0];
  if (!doc) return null;

  return { lat: Number(doc.y), lng: Number(doc.x) };
}

/** 두 좌표 간 실제 도로 기준 최단 주행거리(km)를 구한다. */
export async function getDrivingDistanceKm(
  origin: Coordinates,
  destination: Coordinates
): Promise<number | null> {
  const apiKey = getApiKey();
  const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${origin.lng},${origin.lat}`);
  url.searchParams.set("destination", `${destination.lng},${destination.lat}`);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });
  if (!res.ok) {
    throw new KakaoApiError(`카카오모빌리티 길찾기 API 호출 실패: HTTP ${res.status}`);
  }

  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route || route.result_code !== 0) return null;

  const distanceMeters: number | undefined = route.summary?.distance;
  if (typeof distanceMeters !== "number") return null;

  return distanceMeters / 1000;
}
