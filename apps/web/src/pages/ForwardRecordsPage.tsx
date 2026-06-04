import { useEffect, useState } from "react";
import type { ForwardRecord } from "@harmonia/shared";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";

export function ForwardRecordsPage() {
  const [items, setItems] = useState<ForwardRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.forwards().then((result) => {
      setItems(result.items);
      setLoading(false);
    });
  }, []);

  if (loading) return <Loading label="读取转发记录" />;

  return (
    <section>
      <PageHeader title="概览转发记录" meta={`${items.length} 条`} />
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>原邮件</th>
                <th>转发对象</th>
                <th>转发时间</th>
                <th>状态</th>
                <th>内容摘要</th>
                <th>失败原因</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.subject}</td>
                  <td>{item.toEmail}</td>
                  <td>{item.sentAt ? new Date(item.sentAt).toLocaleString() : "-"}</td>
                  <td>
                    <span className={`badge forward-${item.status}`}>{item.status}</span>
                  </td>
                  <td className="summary-cell">{item.summary.slice(0, 140)}</td>
                  <td>{item.error || "-"}</td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    暂无转发记录
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
