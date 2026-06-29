import type { ChangeEvent, FormEvent, InputHTMLAttributes } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  CollegeKnowledgeChatMode,
  CollegeKnowledgeDocument,
  CollegeKnowledgeDocumentStatus,
  CollegeKnowledgeSource
} from "@harmonia/shared";
import { BookOpenText, FileUp, FolderOpen, Image as ImageIcon, RefreshCw, RotateCw, Send, Trash2, X } from "lucide-react";
import { api } from "../api/client.js";
import { PageHeader } from "../components/PageHeader.js";

type ActiveTab = "chat" | "documents";

type UserChatTurn = {
  id: string;
  role: "user";
  content: string;
  imageNames: string[];
  mode?: CollegeKnowledgeChatMode;
};

type AssistantChatTurn = {
  id: string;
  role: "assistant";
  content: string;
  answerable: boolean;
  sources: CollegeKnowledgeSource[];
  warnings: string[];
};

type ChatTurn = UserChatTurn | AssistantChatTurn;

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

const acceptedKnowledgeFiles = ".doc,.docx,.ppt,.pptx,.xls,.xlsx,.pdf,.md,.txt,.csv,.html,.htm,.zip";
const chatStorageKey = "college-knowledge-chat-turns";
const chatModeStorageKey = "college-knowledge-chat-mode";

const documentStatusLabels: Record<CollegeKnowledgeDocumentStatus, string> = {
  queued: "排队中",
  processing: "处理中",
  ready: "可问答",
  partial: "部分完成",
  failed: "失败",
  unsupported: "不支持"
};

function makeId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function relativeFilePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function readableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
}

function documentTitle(document: CollegeKnowledgeDocument): string {
  return document.originalName || document.fileName;
}

function documentIssues(document: CollegeKnowledgeDocument): string {
  const warnings = document.warnings ?? [];
  const parts = [...warnings, document.error].filter(Boolean);
  return parts.length ? parts.join("；") : "-";
}

function sourceTitle(source: CollegeKnowledgeSource): string {
  return source.relativePath || source.documentName;
}

function modeLabel(mode: CollegeKnowledgeChatMode): string {
  return mode === "precise" ? "精准模式" : "快速模式";
}

function readStoredChatMode(): CollegeKnowledgeChatMode {
  if (typeof window === "undefined") return "fast";
  return window.localStorage.getItem(chatModeStorageKey) === "precise" ? "precise" : "fast";
}

function readStoredChatTurns(): ChatTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(chatStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((turn): turn is ChatTurn => {
        if (!turn || typeof turn !== "object") return false;
        const candidate = turn as Partial<ChatTurn>;
        if (typeof candidate.id !== "string") return false;
        if (candidate.role === "user") return typeof candidate.content === "string" && Array.isArray(candidate.imageNames);
        if (candidate.role === "assistant") {
          return (
            typeof candidate.content === "string" &&
            typeof candidate.answerable === "boolean" &&
            Array.isArray(candidate.sources) &&
            Array.isArray(candidate.warnings)
          );
        }
        return false;
      })
      .slice(-80);
  } catch {
    return [];
  }
}

export function CollegeKnowledgePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>(() => readStoredChatTurns());
  const [chatMode, setChatMode] = useState<CollegeKnowledgeChatMode>(() => readStoredChatMode());
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState("");

  const [documents, setDocuments] = useState<CollegeKnowledgeDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [documentNotice, setDocumentNotice] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [actioningDocumentId, setActioningDocumentId] = useState<string | null>(null);

  const uploadPaths = useMemo(() => uploadFiles.map(relativeFilePath), [uploadFiles]);
  const documentSummary = useMemo(() => {
    const ready = documents.filter((item) => item.status === "ready").length;
    const processing = documents.filter((item) => item.status === "queued" || item.status === "processing").length;
    const needsAttention = documents.filter(
      (item) =>
        item.status === "partial" || item.status === "failed" || item.status === "unsupported" || Boolean(item.error) || (item.warnings ?? []).length > 0
    ).length;
    return { ready, processing, needsAttention };
  }, [documents]);

  const loadDocuments = async () => {
    setDocumentsLoading(true);
    setDocumentError("");
    try {
      const result = await api.collegeKnowledgeDocuments();
      setDocuments(result.items);
    } catch (error) {
      setDocumentError(readableError(error));
    } finally {
      setDocumentsLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(chatStorageKey, JSON.stringify(chatTurns));
  }, [chatTurns]);

  useEffect(() => {
    window.localStorage.setItem(chatModeStorageKey, chatMode);
  }, [chatMode]);

  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const nextImages = Array.from(event.currentTarget.files ?? []);
    if (nextImages.length) {
      setImages((previous) => [...previous, ...nextImages]);
      setChatError("");
    }
    event.currentTarget.value = "";
  };

  const removeImage = (index: number) => {
    setImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const sendQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setChatError("请输入问题。");
      return;
    }

    const selectedImages = images;
    const userTurn: UserChatTurn = {
      id: makeId("question"),
      role: "user",
      content: trimmed,
      imageNames: selectedImages.map((image) => image.name),
      mode: chatMode
    };

    setChatTurns((previous) => [...previous, userTurn]);
    setMessage("");
    setImages([]);
    setAsking(true);
    setChatError("");

    try {
      const response = await api.askCollegeKnowledge({ message: trimmed, mode: chatMode, images: selectedImages });
      const assistantTurn: AssistantChatTurn = {
        id: makeId("answer"),
        role: "assistant",
        content: response.answer,
        answerable: response.answerable,
        sources: response.sources ?? [],
        warnings: response.warnings ?? []
      };
      setChatTurns((previous) => [...previous, assistantTurn]);
    } catch (error) {
      setChatError(readableError(error));
    } finally {
      setAsking(false);
    }
  };

  const addUploadFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    if (selected.length) {
      setUploadFiles((previous) => [...previous, ...selected]);
      setDocumentError("");
      setDocumentNotice("");
    }
    event.currentTarget.value = "";
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const clearChatSession = () => {
    setChatTurns([]);
    setMessage("");
    setImages([]);
    setChatError("");
    window.localStorage.removeItem(chatStorageKey);
  };

  const startUpload = async () => {
    if (!uploadFiles.length) {
      setDocumentError("请选择要录入的知识文档或文件夹。");
      return;
    }
    setUploading(true);
    setDocumentError("");
    setDocumentNotice("");
    try {
      const result = await api.uploadCollegeKnowledgeDocuments(uploadFiles, uploadPaths);
      setDocumentNotice(`已提交 ${result.documents.length} 个知识文档。`);
      setUploadFiles([]);
      await loadDocuments();
    } catch (error) {
      setDocumentError(readableError(error));
    } finally {
      setUploading(false);
    }
  };

  const reindexDocument = async (document: CollegeKnowledgeDocument) => {
    setActioningDocumentId(document.id);
    setDocumentError("");
    setDocumentNotice("");
    try {
      const result = await api.reindexCollegeKnowledgeDocument(document.id);
      setDocuments((previous) => previous.map((item) => (item.id === result.document.id ? result.document : item)));
      setDocumentNotice(`${documentTitle(result.document)} 已重新索引。`);
    } catch (error) {
      setDocumentError(readableError(error));
    } finally {
      setActioningDocumentId(null);
    }
  };

  const deleteDocument = async (document: CollegeKnowledgeDocument) => {
    if (!window.confirm(`确认删除「${documentTitle(document)}」？`)) return;
    setActioningDocumentId(document.id);
    setDocumentError("");
    setDocumentNotice("");
    try {
      await api.deleteCollegeKnowledgeDocument(document.id);
      setDocuments((previous) => previous.filter((item) => item.id !== document.id));
      setDocumentNotice("知识文档已删除。");
    } catch (error) {
      setDocumentError(readableError(error));
    } finally {
      setActioningDocumentId(null);
    }
  };

  const directoryInputProps: DirectoryInputProps = {
    type: "file",
    multiple: true,
    webkitdirectory: "",
    directory: "",
    onChange: addUploadFiles,
    disabled: uploading
  };

  return (
    <section>
      <PageHeader
        title="书院知识问答"
        meta={activeTab === "chat" ? "基于已录入的书院知识文档进行问答" : "上传书院制度、通知和常见问题文档"}
        actions={
          <button className="icon-text" type="button" onClick={() => void loadDocuments()} disabled={documentsLoading}>
            <RefreshCw size={17} />
            <span>{documentsLoading ? "刷新中" : "刷新文档"}</span>
          </button>
        }
      />

      <div className="segmented-tabs" role="tablist" aria-label="书院知识问答">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chat"}
          className={activeTab === "chat" ? "active" : ""}
          onClick={() => setActiveTab("chat")}
        >
          知识问答
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "documents"}
          className={activeTab === "documents" ? "active" : ""}
          onClick={() => setActiveTab("documents")}
        >
          知识文档录入
        </button>
      </div>

      {activeTab === "chat" ? (
        <section className="panel college-chat-panel">
          <div className="panel-heading">
            <div className="panel-title">知识问答</div>
            <div className="chat-toolbar">
              <div className="mode-toggle" role="radiogroup" aria-label="问答模式">
                <button
                  type="button"
                  className={chatMode === "fast" ? "active" : ""}
                  aria-checked={chatMode === "fast"}
                  role="radio"
                  onClick={() => setChatMode("fast")}
                  disabled={asking}
                >
                  快速
                </button>
                <button
                  type="button"
                  className={chatMode === "precise" ? "active" : ""}
                  aria-checked={chatMode === "precise"}
                  role="radio"
                  onClick={() => setChatMode("precise")}
                  disabled={asking}
                >
                  精准
                </button>
              </div>
              <button className="icon-text danger compact" type="button" onClick={clearChatSession} disabled={asking || chatTurns.length === 0}>
                <Trash2 size={16} />
                <span>清空会话</span>
              </button>
              <span className="muted-hint">当前可问答文档 {documentSummary.ready} 个</span>
            </div>
          </div>

          {chatError ? <div className="notice danger">{chatError}</div> : null}

          <div className="chat-messages" aria-live="polite">
            {chatTurns.length ? (
              chatTurns.map((turn) =>
                turn.role === "user" ? (
                  <div className="chat-message user" key={turn.id}>
                    <div className="chat-bubble">
                      <p>{turn.content}</p>
                      <div className="chat-file-tags">
                        <span>{modeLabel(turn.mode ?? "fast")}</span>
                      </div>
                      {turn.imageNames.length ? (
                        <div className="chat-file-tags">
                          {turn.imageNames.map((name) => (
                            <span key={name}>{name}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="chat-message assistant" key={turn.id}>
                    <div className="chat-bubble">
                      {!turn.answerable ? <span className="badge college-doc-partial">未找到充分依据</span> : null}
                      <p className="chat-answer">{turn.content}</p>
                      {turn.warnings.length ? (
                        <div className="chat-warning">
                          {turn.warnings.map((warning) => (
                            <span key={warning}>{warning}</span>
                          ))}
                        </div>
                      ) : null}
                      {turn.sources.length ? (
                        <div className="source-list">
                          {turn.sources.map((source, index) => (
                            <article className="source-card" key={source.id || `${source.documentId}-${index}`}>
                              <div className="source-card-heading">
                                <BookOpenText size={15} />
                                <strong>{sourceTitle(source)}</strong>
                                <span>{source.locator}</span>
                              </div>
                              {source.title ? <div className="source-title">{source.title}</div> : null}
                              <p>{source.snippet}</p>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              )
            ) : (
              <div className="empty-panel">暂无对话</div>
            )}
            {asking ? (
              <div className="chat-message assistant">
                <div className="chat-bubble">
                  <span className="muted-hint">正在检索书院知识文档</span>
                </div>
              </div>
            ) : null}
          </div>

          <form className="chat-composer" onSubmit={sendQuestion}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="输入关于书院制度、通知或办事流程的问题"
              disabled={asking}
            />
            {images.length ? (
              <div className="chat-file-tags editable">
                {images.map((image, index) => (
                  <span key={`${image.name}-${index}`}>
                    {image.name}
                    <button type="button" onClick={() => removeImage(index)} title="移除图片">
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="chat-composer-actions">
              <label className="icon-text file-action">
                <ImageIcon size={17} />
                <span>添加图片</span>
                <input type="file" accept="image/*" multiple onChange={selectImages} disabled={asking} />
              </label>
              <button className="primary-action compact" type="submit" disabled={asking}>
                {asking ? <RefreshCw size={17} /> : <Send size={17} />}
                <span>{asking ? "生成中" : "发送"}</span>
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          {documentError ? <div className="notice danger">{documentError}</div> : null}
          {documentNotice ? <div className="notice">{documentNotice}</div> : null}

          <div className="college-document-grid">
            <section className="panel">
              <div className="panel-title">知识文档录入</div>
              <div className="upload-grid">
                <label className="file-field">
                  <span>选择文件</span>
                  <input type="file" accept={acceptedKnowledgeFiles} multiple onChange={addUploadFiles} disabled={uploading} />
                </label>
                <label className="file-field">
                  <span>选择文件夹</span>
                  <input {...directoryInputProps} />
                </label>
              </div>
              <div className="selected-files">
                <div>
                  <FileUp size={18} />
                  <span>{uploadFiles.length ? `${uploadFiles.length} 个待上传文档` : "尚未选择知识文档"}</span>
                </div>
                {uploadPaths.slice(0, 6).map((path, index) => (
                  <div key={`${path}-${index}`}>
                    <BookOpenText size={18} />
                    <span>{path}</span>
                    <button className="icon-button small" type="button" onClick={() => removeUploadFile(index)} title="移除文件">
                      <X size={15} />
                    </button>
                  </div>
                ))}
                {uploadPaths.length > 6 ? <div className="muted-row">还有 {uploadPaths.length - 6} 个文件待上传</div> : null}
              </div>
              <div className="button-row">
                <button className="primary-action compact" type="button" onClick={() => void startUpload()} disabled={uploading || !uploadFiles.length}>
                  {uploading ? <RefreshCw size={17} /> : <FileUp size={17} />}
                  <span>{uploading ? "上传中" : "上传录入"}</span>
                </button>
                <button className="icon-text" type="button" onClick={() => setUploadFiles([])} disabled={uploading || !uploadFiles.length}>
                  清空
                </button>
              </div>
            </section>

            <aside className="panel">
              <div className="panel-title">录入状态</div>
              <dl className="compact-detail-list">
                <dt>总文档</dt>
                <dd>{documents.length}</dd>
                <dt>可问答</dt>
                <dd>{documentSummary.ready}</dd>
                <dt>处理中</dt>
                <dd>{documentSummary.processing}</dd>
                <dt>需关注</dt>
                <dd>{documentSummary.needsAttention}</dd>
              </dl>
              <div className="college-upload-note">
                <FolderOpen size={17} />
                <span>文件夹上传会保留相对路径，用于后续来源定位。</span>
              </div>
            </aside>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <div className="panel-title">知识文档列表</div>
              <button className="icon-button small" type="button" onClick={() => void loadDocuments()} disabled={documentsLoading} title="刷新文档列表">
                <RefreshCw size={16} />
              </button>
            </div>
            {documents.length ? (
              <div className="table-wrap">
                <table className="college-document-table">
                  <thead>
                    <tr>
                      <th>文档</th>
                      <th>类型</th>
                      <th>状态</th>
                      <th>分块</th>
                      <th>时间</th>
                      <th>警告 / 错误</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id}>
                        <td>
                          <div className="document-name-cell">
                            <strong>{documentTitle(document)}</strong>
                            <span>{document.relativePath || document.fileName}</span>
                          </div>
                        </td>
                        <td>
                          <span>{document.contentType || "未知类型"}</span>
                          <span className="muted-row">{formatBytes(document.size)}</span>
                        </td>
                        <td>
                          <span className={`badge college-doc-${document.status}`}>{documentStatusLabels[document.status]}</span>
                        </td>
                        <td>{document.chunkCount}</td>
                        <td>
                          <span>更新 {formatTime(document.updatedAt)}</span>
                          <span className="muted-row">上传 {formatTime(document.createdAt)}</span>
                        </td>
                        <td>{documentIssues(document)}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="icon-button small"
                              type="button"
                              onClick={() => void reindexDocument(document)}
                              disabled={actioningDocumentId === document.id}
                              title="重新索引"
                            >
                              <RotateCw size={15} />
                            </button>
                            <button
                              className="icon-button small danger"
                              type="button"
                              onClick={() => void deleteDocument(document)}
                              disabled={actioningDocumentId === document.id}
                              title="删除文档"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-panel">{documentsLoading ? "正在加载知识文档" : "暂无知识文档"}</div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
