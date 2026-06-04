import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, MailCheck, RefreshCw, Send, Timer } from "lucide-react";
import type { DashboardSummary } from "@harmonia/shared";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";
import { CategoryBadge, StatusBadge } from "../components/StatusBadge.js";

const stats = [
  { key: "pendingMessages", label: "待处理邮件", icon: Timer },
  { key: "pendingDrafts", label: "待审核回复", icon: MailCheck },
  { key: "processedToday", label: "今日已处理", icon: CheckCircle2 },
  { key: "autoApprovedToday", label: "自动批准", icon: Send },
  { key: "failedMessages", label: "处理失败", icon: AlertTriangle }
] as const;

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setError("");
    try {
      setData(await api.dashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      await api.runSync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  if (!data) return <Loading label="读取工作台" />;

  return (
    <section>
      <PageHeader
        title="工作台"
        meta="公共邮箱处理概览"
        actions={
          <button className="icon-text" type="button" onClick={runSync} disabled={syncing} title="立即同步">
            <RefreshCw size={17} />
            <span>{syncing ? "同步中" : "同步"}</span>
          </button>
        }
      />
      {error ? <div className="notice danger">{error}</div> : null}
      <div className="stat-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article className="stat-card" key={stat.key}>
              <Icon size={20} />
              <span>{stat.label}</span>
              <strong>{data[stat.key]}</strong>
            </article>
          );
        })}
      </div>
      <div className="panel">
        <div className="panel-title">最近收到</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>类型</th>
                <th>主题</th>
                <th>发件人</th>
                <th>状态</th>
                <th>收到时间</th>
              </tr>
            </thead>
            <tbody>
              {data.recentMessages.map((message) => (
                <tr key={message.id}>
                  <td>
                    <CategoryBadge category={message.category} />
                  </td>
                  <td>
                    <Link to={`/messages/${message.id}`}>{message.subject}</Link>
                  </td>
                  <td>{message.senderEmail}</td>
                  <td>
                    <StatusBadge status={message.status} />
                  </td>
                  <td>{new Date(message.receivedAt).toLocaleString()}</td>
                </tr>
              ))}
              {!data.recentMessages.length ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    暂无邮件
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
