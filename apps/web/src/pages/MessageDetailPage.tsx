import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RefreshCw, Save, SendHorizontal } from "lucide-react";
import type { MessageDetail } from "../api/client.js";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";
import { CategoryBadge, StatusBadge } from "../components/StatusBadge.js";

export function MessageDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    const data = await api.messageDetail(id);
    setDetail(data);
    setDraftBody(data.draft?.body ?? "");
  };

  useEffect(() => {
    void load();
  }, [id]);

  const process = async () => {
    if (!id) return;
    setBusy(true);
    setNotice("");
    try {
      await api.processMessage(id);
      await load();
      setNotice("已重新处理");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!detail?.draft) return;
    setBusy(true);
    setNotice("");
    try {
      await api.saveDraft(detail.draft.id, draftBody);
      await load();
      setNotice("草稿已保存");
    } finally {
      setBusy(false);
    }
  };

  const sendDraft = async () => {
    if (!detail?.draft) return;
    setBusy(true);
    setNotice("");
    try {
      await api.saveDraft(detail.draft.id, draftBody);
      await api.sendDraft(detail.draft.id);
      await load();
      setNotice("草稿已发送");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <Loading label="读取邮件详情" />;

  return (
    <section>
      <PageHeader
        title="邮件详情"
        meta={detail.message.subject}
        actions={
          <button className="icon-text" type="button" onClick={process} disabled={busy} title="重新处理">
            <RefreshCw size={17} />
            <span>处理</span>
          </button>
        }
      />
      {notice ? <div className="notice">{notice}</div> : null}
      <div className="detail-grid">
        <section className="panel detail-main">
          <div className="panel-title">原邮件</div>
          <dl className="detail-list">
            <dt>主题</dt>
            <dd>{detail.message.subject}</dd>
            <dt>发件人</dt>
            <dd>{detail.message.senderName ? `${detail.message.senderName} <${detail.message.senderEmail}>` : detail.message.senderEmail}</dd>
            <dt>收件人</dt>
            <dd>{detail.message.toRecipients.join("、") || "-"}</dd>
            <dt>抄送</dt>
            <dd>{detail.message.ccRecipients.join("、") || "-"}</dd>
            <dt>收到时间</dt>
            <dd>{new Date(detail.message.receivedAt).toLocaleString()}</dd>
          </dl>
          <pre className="mail-body">{detail.message.bodyText || "(无正文)"}</pre>
        </section>
        <aside className="panel">
          <div className="panel-title">系统结果</div>
          <div className="stack">
            <CategoryBadge category={detail.message.category} />
            <StatusBadge status={detail.message.status} />
            <span className="badge">{detail.message.needsReview ? "需要人工审核" : "无需人工审核"}</span>
          </div>
          <h3>系统建议</h3>
          <p>{detail.message.recommendation || "-"}</p>
          <h3>附件</h3>
          <ul className="plain-list">
            {detail.attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.name} <span>{Math.round(attachment.size / 1024)} KB</span>
              </li>
            ))}
            {!detail.attachments.length ? <li>无附件</li> : null}
          </ul>
        </aside>
      </div>

      <div className="split-panels">
        <section className="panel">
          <div className="panel-title">信息抽取</div>
          <pre className="json-view">{JSON.stringify(detail.message.extracted, null, 2)}</pre>
        </section>
        <section className="panel">
          <div className="panel-title">邮件概览</div>
          <pre className="summary-view">{detail.message.overview || "暂无概览"}</pre>
        </section>
      </div>

      {detail.draft ? (
        <section className="panel">
          <div className="panel-title">回复草稿</div>
          <textarea className="draft-editor" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
          <div className="button-row">
            <button className="icon-text" type="button" onClick={saveDraft} disabled={busy}>
              <Save size={17} />
              <span>保存</span>
            </button>
            <button className="primary-action compact" type="button" onClick={sendDraft} disabled={busy}>
              <SendHorizontal size={17} />
              <span>确认发送</span>
            </button>
            <Link className="table-action" to="/drafts">
              进入审核页
            </Link>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-title">操作日志</div>
        <ul className="timeline">
          {detail.audits.map((audit) => (
            <li key={audit.id}>
              <time>{new Date(audit.createdAt).toLocaleString()}</time>
              <strong>{audit.action}</strong>
              <span>{audit.actor}</span>
            </li>
          ))}
          {!detail.audits.length ? <li>暂无日志</li> : null}
        </ul>
      </section>
    </section>
  );
}
