/**
 * 云端排行榜读取请求闸门。
 *
 * 每次开始读取都会使此前的请求失效，避免慢请求用旧结果覆盖较新的榜单。
 */
export class LeaderboardRefreshGate {
  private latestRequestId = 0;

  begin(): number {
    this.latestRequestId += 1;
    return this.latestRequestId;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.latestRequestId;
  }
}
