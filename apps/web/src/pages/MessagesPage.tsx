import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Search } from "lucide-react";
import { mailCategories, mailCategoryLabels, processingStatuses, type MailMessage } from "@harmonia/shared";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";
import { CategoryBadge, StatusBadge } from "../components/StatusBadge.js";

const statusLabels = {
  new: "新邮件",
  processing: "处理中",
  awaiting_review: "待审核",
  auto_approved: "自动批准",
  forwarded: "已转发",
  manual_required: "需人工",
  completed: "已完成",
  failed: "失败"
};

export function MessagesPage() {
  const [items, setItems] = useState<MailMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ category: "", status: "", needsReview: "", hasAttachments: "", from: "", to: "" });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString() ? `?${params.toString()}` : "";
  }, [filters]);

  const load = async () => {
    setLoading(true);
    const data = await api.messages(query);
    setItems(data.items);
    setTotal(data.total);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [query]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  return (
    <section>
      <PageHeader title="邮件列表" meta={`共 ${total} 封`} />
      <form className="filter-bar" onSubmit={submit}>
        <Filter size={18} />
        <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">全部类型</option>
          {mailCategories.map((category) => (
            <option key={category} value={category}>
              {mailCategoryLabels[category]}
            </option>
          ))}
        </select>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">全部状态</option>
          {processingStatuses.map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
        <select value={filters.needsReview} onChange={(event) => setFilters({ ...filters, needsReview: event.target.value })}>
          <option value="">审核不限</option>
          <option value="true">需要审核</option>
          <option value="false">无需审核</option>
        </select>
        <select value={filters.hasAttachments} onChange={(event) => setFilters({ ...filters, hasAttachments: event.target.value })}>
          <option value="">附件不限</option>
          <option value="true">有附件</option>
          <option value="false">无附件</option>
        </select>
        <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        <button className="icon-button" type="submit" title="筛选">
          <Search size={17} />
        </button>
      </form>
      {loading ? (
        <Loading label="读取邮件" />
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>主题</th>
                  <th>发件人</th>
                  <th>收到时间</th>
                  <th>状态</th>
                  <th>附件</th>
                  <th>审核</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((message) => (
                  <tr key={message.id}>
                    <td>
                      <CategoryBadge category={message.category} />
                    </td>
                    <td className="subject-cell">{message.subject}</td>
                    <td>{message.senderEmail}</td>
                    <td>{new Date(message.receivedAt).toLocaleString()}</td>
                    <td>
                      <StatusBadge status={message.status} />
                    </td>
                    <td>{message.hasAttachments ? "有" : "无"}</td>
                    <td>{message.needsReview ? "是" : "否"}</td>
                    <td>
                      <Link className="table-action" to={`/messages/${message.id}`}>
                        查看
                      </Link>
                    </td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={8} className="empty-cell">
                      没有匹配的邮件
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
