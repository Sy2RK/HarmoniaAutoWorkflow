import { useEffect, useState } from "react";
import { Ban, Check, Save, SendHorizontal, UserRoundCheck } from "lucide-react";
import type { DraftStatus, ReplyDraft } from "@harmonia/shared";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";

const pendingDraftStatuses: DraftStatus[] = ["draft", "saved", "manual_required"];

export function DraftReviewPage() {
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = async () => {
    const results = await Promise.all(pendingDraftStatuses.map((status) => api.drafts(status)));
    const items = results
      .flatMap((result) => result.items)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setDrafts(items);
    setBodies(Object.fromEntries(items.map((draft) => [draft.id, draft.body])));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (label: string, action: () => Promise<unknown>) => {
    setNotice("");
    try {
      await action();
      await load();
      setNotice(label);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  if (loading) return <Loading label="读取回复草稿" />;

  return (
    <section>
      <PageHeader title="回复审核" meta={`${drafts.length} 封草稿`} />
      {notice ? <div className="notice">{notice}</div> : null}
      <div className="draft-list">
        {drafts.map((draft) => (
          <article className="panel draft-item" key={draft.id}>
            <div className="draft-meta">
              <strong>{draft.subject}</strong>
              <span>{draft.toEmail}</span>
              <span className="badge">{draft.status}</span>
            </div>
            <textarea
              className="draft-editor"
              value={bodies[draft.id] ?? ""}
              onChange={(event) => setBodies({ ...bodies, [draft.id]: event.target.value })}
            />
            <div className="button-row">
              <button className="icon-text" type="button" onClick={() => act("草稿已保存", () => api.saveDraft(draft.id, bodies[draft.id] ?? ""))}>
                <Save size={17} />
                <span>保存</span>
              </button>
              <button
                className="primary-action compact"
                type="button"
                onClick={() => act("草稿已发送", async () => {
                  await api.saveDraft(draft.id, bodies[draft.id] ?? "");
                  await api.sendDraft(draft.id);
                })}
              >
                <SendHorizontal size={17} />
                <span>确认发送</span>
              </button>
              <button className="icon-text danger" type="button" onClick={() => act("已拒绝发送", () => api.rejectDraft(draft.id))}>
                <Ban size={17} />
                <span>拒绝</span>
              </button>
              <button className="icon-text" type="button" onClick={() => act("已标记无需回复", () => api.noReply(draft.id))}>
                <Check size={17} />
                <span>无需回复</span>
              </button>
              <button
                className="icon-text"
                type="button"
                disabled={draft.status === "manual_required"}
                onClick={() => act("已转人工处理", () => api.markManual(draft.id))}
              >
                <UserRoundCheck size={17} />
                <span>转人工</span>
              </button>
            </div>
          </article>
        ))}
        {!drafts.length ? <div className="panel empty-panel">暂无回复草稿</div> : null}
      </div>
    </section>
  );
}
