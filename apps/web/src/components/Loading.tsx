export function Loading({ label = "加载中" }: { label?: string }) {
  return <div className="loading">{label}</div>;
}
