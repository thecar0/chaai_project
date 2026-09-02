// 정부 공공데이터 API(data.go.kr, juso.go.kr)는 순간적으로 503/타임아웃이 나는
// 경우가 관찰됨 - 같은 요청을 바로 재시도하면 곧바로 성공하는 경우가 많다.
// 그래서 실패 시 짧게 대기 후 한 번만 재시도한다 (그래도 실패하면 호출부가
// 그대로 에러를 받는다).
export async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return fn();
  }
}
