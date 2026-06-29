import type { ChangeEvent, FormEvent, InputHTMLAttributes } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  MessageAgentDraft,
  MessageAgentFileRole,
  MessageAgentFileStatus,
  MessageAgentMessage,
  MessageAgentQuestion,
  MessageAgentSession,
  MessageAgentSource,
  MessageAgentSourceRef,
  MessageAgentTemplate,
  MessageAgentTemplateCategory,
  MessageAgentUploadProgress
} from "@harmonia/shared";
import { BotMessageSquare, Copy, Download, FileUp, Image as ImageIcon, RefreshCw, Send, Trash2, X } from "lucide-react";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

type ActiveTab = "writing" | "reference";

type AssistantTurnExtra = {
  followUpQuestions: MessageAgentQuestion[];
  sources: MessageAgentSourceRef[];
  warnings: string[];
};

const sessionStorageKey = "harmonia-message-agent-session-id";
const acceptedMessageAgentDocuments = ".xlsx,.docx,.pdf,.md,.txt,.csv";
const parseableDocumentExtensions = new Set([".xlsx", ".docx", ".pdf", ".md", ".txt", ".csv"]);
const unsupportedLegacyExtensions = new Set([".msg", ".doc"]);
const chatImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const categoryLabels: Record<MessageAgentTemplateCategory, string> = {
  facility_notice: "物业施工维护通知",
  youth_league: "团组织相关回复",
  electricity_subsidy: "送电/电费",
  function_room: "功能房",
  property_staff: "物业人员相关",
  bfmo_coordination: "BFMO/部门沟通",
  recommendation_letter: "奖学金推荐信",
  event_registration: "活动报名回复",
  format_reminder: "邮件格式提醒",
  general_reply: "通用回复"
};

const fileRoleLabels: Record<MessageAgentFileRole, string> = {
  reference: "参考邮件库文档",
  request: "当前请求文档",
  attachment: "聊天附件"
};

const fileStatusLabels: Record<MessageAgentFileStatus, string> = {
  ready: "解析可用",
  partial: "部分可解析",
  unsupported: "不支持解析",
  failed: "解析失败",
  ignored: "已忽略"
};

const uploadPhaseLabels: Record<MessageAgentUploadProgress["phase"], string> = {
  uploading: "正在上传",
  parsing: "正在解析",
  templating: "正在生成参考模板",
  completed: "上传完成",
  failed: "上传失败"
};

function makeId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function readStoredSessionId(): string | null {
  try {
    return window.localStorage.getItem(sessionStorageKey);
  } catch {
    return null;
  }
}

function rememberSessionId(sessionId: string) {
  try {
    window.localStorage.setItem(sessionStorageKey, sessionId);
  } catch {
    // The session remains usable in component state if browser storage is blocked.
  }
}

function forgetSessionId() {
  try {
    window.localStorage.removeItem(sessionStorageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function relativeFilePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function fileExtension(file: File): string {
  const fileName = relativeFilePath(file).split(/[\\/]/).pop() || file.name;
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function isParseableDocument(file: File): boolean {
  return parseableDocumentExtensions.has(fileExtension(file));
}

function isOfficeTempFile(file: File): boolean {
  const fileName = relativeFilePath(file).split(/[\\/]/).pop() || file.name;
  return fileName.startsWith("~$");
}

function unsupportedUploadWarning(files: File[]): string | null {
  if (!files.length) return null;
  const legacyFiles = files.filter((file) => unsupportedLegacyExtensions.has(fileExtension(file)));
  const imageFiles = files.filter((file) => chatImageExtensions.has(fileExtension(file)));
  const otherFiles = files.filter((file) => !legacyFiles.includes(file) && !imageFiles.includes(file));
  const parts: string[] = [];
  if (legacyFiles.length) {
    parts.push(`已忽略 ${legacyFiles.length} 个不支持的 Outlook/旧版 Office 文件（.msg/.doc 第一版不解析，请转换为 .docx、.pdf 或文本后上传）。`);
  }
  if (imageFiles.length) {
    parts.push(`已忽略 ${imageFiles.length} 个图片文件；图片只能在对话区通过“添加聊天图片”作为多模态附件发送，不会作为可解析文档上传。`);
  }
  if (otherFiles.length) {
    parts.push(`已忽略 ${otherFiles.length} 个非可解析文档。参考/请求上传仅支持 .xlsx、.docx、.pdf、.md、.txt、.csv。`);
  }
  return parts.join(" ");
}

function friendlyWarning(value: string): string {
  if (value.startsWith("已忽略") || value.startsWith("检测到")) return value;
  if (value.startsWith("IGNORED_TEMP_FILE:")) {
    return `已忽略 Office 临时文件：${value.slice("IGNORED_TEMP_FILE:".length)}`;
  }
  const mentionsLegacyOffice = value.includes(".msg") || /(^|[^a-z0-9])\.doc($|[^a-z0-9x])/i.test(value);
  if (mentionsLegacyOffice) {
    return `${value}（.msg 和旧版 .doc 第一版不支持解析，请转换为 .docx、.pdf、.txt 等可解析文档后上传。）`;
  }
  if (value.includes("UNSUPPORTED")) {
    return `${value}（该文件不在可解析文档白名单内；上传入口仅支持 .xlsx、.docx、.pdf、.md、.txt、.csv。）`;
  }
  if (value.includes("PDF_PORTFOLIO_TEXT_NOT_EXTRACTED")) {
    return "PDF 可能是 Outlook PDF Portfolio，正文未能可靠提取；请优先上传邮件常用库 xlsx、docx 或文本版本。";
  }
  return value;
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

function readableUploadError(value: string): string {
  if (value === "MESSAGE_AGENT_UPLOAD_INTERRUPTED_RETRY_UPLOAD") return "上传流程曾被中断，请重新上传该文件。";
  return value;
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

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const items = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => items.set(item.id, item));
  return Array.from(items.values());
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeDocxName(subject: string): string {
  const base = subject.trim().replace(/[\\/:*?"<>|]+/g, "").slice(0, 48);
  return `${base || "message-agent-draft"}.docx`;
}

function snippet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function metadataQuestions(value: unknown): MessageAgentQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MessageAgentQuestion => isRecord(item) && typeof item.slotKey === "string" && typeof item.question === "string");
}

function metadataSourceRefs(value: unknown): MessageAgentSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MessageAgentSourceRef =>
      isRecord(item) && typeof item.sourceId === "string" && typeof item.fileName === "string" && typeof item.title === "string" && typeof item.snippet === "string"
  );
}

function metadataWarnings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function extrasFromMessages(messages: MessageAgentMessage[]): Record<string, AssistantTurnExtra> {
  const extras: Record<string, AssistantTurnExtra> = {};
  for (const item of messages) {
    if (item.role !== "assistant") continue;
    const followUpQuestions = metadataQuestions(item.metadata.followUpQuestions);
    const sources = metadataSourceRefs(item.metadata.sourceRefs);
    const warnings = metadataWarnings(item.metadata.warnings);
    if (followUpQuestions.length || sources.length || warnings.length) {
      extras[item.id] = { followUpQuestions, sources, warnings };
    }
  }
  return extras;
}

function latestDraftSourceRefs(messages: MessageAgentMessage[], draft: MessageAgentDraft | null): MessageAgentSourceRef[] {
  if (draft?.sourceRefs?.length) return draft.sourceRefs;
  for (const item of [...messages].reverse()) {
    if (item.role === "assistant" && item.metadata.type === "draft") return metadataSourceRefs(item.metadata.sourceRefs);
  }
  return [];
}

export function MessageAgentPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("writing");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [session, setSession] = useState<MessageAgentSession | null>(null);
  const [messages, setMessages] = useState<MessageAgentMessage[]>([]);
  const [sources, setSources] = useState<MessageAgentSource[]>([]);
  const [templates, setTemplates] = useState<MessageAgentTemplate[]>([]);
  const [draft, setDraft] = useState<MessageAgentDraft | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [assistantExtras, setAssistantExtras] = useState<Record<string, AssistantTurnExtra>>({});
  const [latestSourceRefs, setLatestSourceRefs] = useState<MessageAgentSourceRef[]>([]);
  const [uploadProgress, setUploadProgress] = useState<MessageAgentUploadProgress | null>(null);

  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [requestFiles, setRequestFiles] = useState<File[]>([]);
  const [chatImages, setChatImages] = useState<File[]>([]);
  const [message, setMessage] = useState("");

  const [uploadingRole, setUploadingRole] = useState<MessageAgentFileRole | null>(null);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const draftDirty = Boolean(draft && (draftSubject !== draft.subject || draftBody !== draft.body));
  const referenceSources = useMemo(() => sources.filter((source) => source.role === "reference"), [sources]);
  const visibleUploadProgress = uploadProgress && (uploadProgress.active || uploadingRole) ? uploadProgress : null;
  const draftSources = useMemo<MessageAgentSourceRef[]>(() => {
    if (!draft) return [];
    if (draft.sourceRefs?.length) return draft.sourceRefs;
    if (latestSourceRefs.length) return latestSourceRefs;
    const fallbackRefs: MessageAgentSourceRef[] = [];
    draft.sourceIds.forEach((sourceId) => {
      const source = sources.find((item) => item.id === sourceId);
      if (!source) return;
      fallbackRefs.push({
        sourceId: source.id,
        templateId: null,
        fileName: source.originalName || source.fileName,
        title: source.relativePath || source.fileName,
        category: null,
        snippet: snippet(source.text)
      });
    });
    return fallbackRefs;
  }, [draft, latestSourceRefs, sources]);

  const referenceDirectoryInputProps: DirectoryInputProps = {
    type: "file",
    accept: acceptedMessageAgentDocuments,
    multiple: true,
    webkitdirectory: "",
    directory: "",
    onChange: (event) => addUploadFiles("reference", event),
    disabled: Boolean(uploadingRole)
  };

  const requestDirectoryInputProps: DirectoryInputProps = {
    type: "file",
    accept: acceptedMessageAgentDocuments,
    multiple: true,
    webkitdirectory: "",
    directory: "",
    onChange: (event) => addUploadFiles("request", event),
    disabled: Boolean(uploadingRole)
  };

  const loadSession = async (sessionId: string) => {
    const detail = await api.messageAgentSession(sessionId);
    setSession(detail.session);
    setMessages(detail.messages);
    setSources(detail.sources);
    setTemplates(detail.templates);
    setDraft(detail.latestDraft);
    setDraftSubject(detail.latestDraft?.subject ?? "");
    setDraftBody(detail.latestDraft?.body ?? "");
    setAssistantExtras(extrasFromMessages(detail.messages));
    setLatestSourceRefs(latestDraftSourceRefs(detail.messages, detail.latestDraft));
    setUploadProgress(detail.uploadProgress ?? null);
    rememberSessionId(detail.session.id);
  };

  const createFreshSession = async () => {
    const result = await api.createMessageAgentSession();
    setSession(result.session);
    setMessages([]);
    setSources([]);
    setTemplates([]);
    setDraft(null);
    setDraftSubject("");
    setDraftBody("");
    setAssistantExtras({});
    setLatestSourceRefs([]);
    setUploadProgress(null);
    setWarnings([]);
    rememberSessionId(result.session.id);
    return result.session;
  };

  const ensureSession = async (): Promise<MessageAgentSession> => {
    if (session) return session;
    return createFreshSession();
  };

  const bootstrap = async () => {
    setBootstrapping(true);
    setError("");
    const storedSessionId = readStoredSessionId();
    if (storedSessionId) {
      try {
        await loadSession(storedSessionId);
        setBootstrapping(false);
        return;
      } catch {
        forgetSessionId();
      }
    }
    try {
      await createFreshSession();
    } catch (bootstrapError) {
      setError(readableError(bootstrapError));
    } finally {
      setBootstrapping(false);
    }
  };

  useEffect(() => {
    void bootstrap();
  }, []);

  const refreshSession = async () => {
    if (!session) return;
    setRefreshing(true);
    setError("");
    try {
      await loadSession(session.id);
      setNotice("会话已刷新。");
    } catch (refreshError) {
      setError(readableError(refreshError));
    } finally {
      setRefreshing(false);
    }
  };

  function addUploadFiles(role: "reference" | "request", event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    if (!selected.length) return;
    const parseableFiles = selected.filter(isParseableDocument);
    const rejectedFiles = selected.filter((file) => !isParseableDocument(file));
    const nextWarnings = [unsupportedUploadWarning(rejectedFiles)].filter((item): item is string => Boolean(item));
    const tempFiles = parseableFiles.filter(isOfficeTempFile);
    if (tempFiles.length) {
      nextWarnings.push(`检测到 ${tempFiles.length} 个 Office 临时文件；后端会忽略它们，不会作为模板或当前请求解析。`);
    }
    setWarnings(nextWarnings);
    if (!parseableFiles.length) {
      setNotice("");
    } else {
      setNotice(`已加入 ${parseableFiles.length} 个可解析文档。`);
    }
    setError("");
    if (role === "reference") {
      setReferenceFiles((previous) => [...previous, ...parseableFiles]);
    } else {
      setRequestFiles((previous) => [...previous, ...parseableFiles]);
    }
    event.currentTarget.value = "";
  }

  const removeUploadFile = (role: "reference" | "request", index: number) => {
    if (role === "reference") {
      setReferenceFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    } else {
      setRequestFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    }
  };

  const pollUploadProgress = async (sessionId: string, shouldContinue: () => boolean) => {
    while (shouldContinue()) {
      await delay(1200);
      if (!shouldContinue()) return;
      try {
        await loadSession(sessionId);
      } catch {
        return;
      }
    }
  };

  const uploadFiles = async (role: MessageAgentFileRole) => {
    const files = role === "reference" ? referenceFiles : requestFiles;
    if (!files.length) {
      setError(`请选择${fileRoleLabels[role]}。`);
      return;
    }
    setUploadingRole(role);
    setError("");
    setNotice("");
    setWarnings([]);
    let keepPolling = true;
    try {
      const activeSession = await ensureSession();
      const startedAt = new Date().toISOString();
      setUploadProgress({
        active: true,
        phase: "uploading",
        role,
        totalFiles: files.length,
        processedFiles: 0,
        currentFileName: null,
        warnings: [],
        error: null,
        startedAt,
        updatedAt: startedAt,
        finishedAt: null
      });
      void pollUploadProgress(activeSession.id, () => keepPolling);
      const result = await api.uploadMessageAgentFiles(activeSession.id, files, role, files.map(relativeFilePath));
      keepPolling = false;
      setSession(result.session);
      setSources((previous) => mergeById(previous, result.sources));
      setTemplates((previous) => mergeById(previous, result.templates));
      setUploadProgress(result.uploadProgress ?? null);
      setWarnings(result.warnings);
      setNotice(`已上传 ${result.sources.length} 个${fileRoleLabels[role]}。`);
      if (role === "reference") {
        setReferenceFiles([]);
      } else {
        setRequestFiles([]);
      }
    } catch (uploadError) {
      keepPolling = false;
      const message = readableError(uploadError);
      setUploadProgress((previous) =>
        previous
          ? {
              ...previous,
              active: false,
              phase: "failed",
              error: message,
              updatedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString()
            }
          : null
      );
      setError(message);
    } finally {
      keepPolling = false;
      setUploadingRole(null);
    }
  };

  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    const images = selected.filter((file) => chatImageExtensions.has(fileExtension(file)));
    const rejected = selected.filter((file) => !chatImageExtensions.has(fileExtension(file)));
    if (rejected.length) {
      setWarnings([`已忽略 ${rejected.length} 个非支持图片文件；聊天图片仅支持 .png、.jpg、.jpeg、.webp。`]);
    }
    if (images.length) {
      setChatImages((previous) => [...previous, ...images]);
    }
    event.currentTarget.value = "";
  };

  const removeImage = (index: number) => {
    setChatImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const sendChatMessage = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError("请输入当前请求或要补充的信息。");
      return;
    }
    const selectedImages = chatImages;
    const userMessage: MessageAgentMessage = {
      id: makeId("local-user"),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
      metadata: selectedImages.length ? { imageNames: selectedImages.map((image) => image.name) } : {}
    };
    setMessages((previous) => [...previous, userMessage]);
    setMessage("");
    setChatImages([]);
    setSending(true);
    setError("");
    setNotice("");
    setWarnings([]);
    try {
      const activeSession = await ensureSession();
      const response = await api.chatMessageAgent({ sessionId: activeSession.id, message: trimmed, images: selectedImages });
      setSession(response.session);
      setMessages((previous) => [...previous, response.assistantMessage]);
      setAssistantExtras((previous) => ({
        ...previous,
        [response.assistantMessage.id]: {
          followUpQuestions: response.followUpQuestions,
          sources: response.sources,
          warnings: response.warnings
        }
      }));
      setWarnings(response.warnings);
      setLatestSourceRefs(response.draft?.sourceRefs?.length ? response.draft.sourceRefs : response.sources);
      if (response.draft) {
        setDraft(response.draft);
        setDraftSubject(response.draft.subject);
        setDraftBody(response.draft.body);
        setNotice("已生成邮件草稿。");
      }
    } catch (chatError) {
      setError(readableError(chatError));
    } finally {
      setSending(false);
    }
  };

  const persistDraftEdits = async (): Promise<MessageAgentDraft | null> => {
    if (!session || !draft) return null;
    const subject = draftSubject.trim();
    const body = draftBody.trim();
    if (!subject || !body) {
      setError("邮件主题和正文不能为空。");
      return null;
    }
    setSavingDraft(true);
    setError("");
    try {
      const result = await api.updateMessageAgentDraft(session.id, subject, body);
      setDraft(result.draft);
      setDraftSubject(result.draft.subject);
      setDraftBody(result.draft.body);
      setNotice("草稿编辑已保存。");
      return result.draft;
    } catch (draftError) {
      setError(readableError(draftError));
      return null;
    } finally {
      setSavingDraft(false);
    }
  };

  const downloadDraft = async () => {
    if (!session || !draft) return;
    setDownloading(true);
    setError("");
    try {
      const currentDraft = draftDirty ? await persistDraftEdits() : draft;
      if (!currentDraft) return;
      const blob = await api.downloadMessageAgentDraftDocx(session.id);
      downloadBlob(blob, safeDocxName(currentDraft.subject));
    } catch (downloadError) {
      setError(readableError(downloadError));
    } finally {
      setDownloading(false);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label}已复制。`);
    } catch {
      setError("复制失败，请手动选择文本复制。");
    }
  };

  const clearChat = async () => {
    const hasPendingInput = Boolean(message.trim() || chatImages.length);
    if ((messages.length || hasPendingInput) && !window.confirm("确认清空当前对话记录和未发送内容？参考邮件库、上传文件和右侧草稿会保留。")) return;
    setClearingChat(true);
    setError("");
    setNotice("");
    try {
      if (!session) {
        setMessages([]);
        setAssistantExtras({});
        setLatestSourceRefs([]);
        setWarnings([]);
        setMessage("");
        setChatImages([]);
        setNotice("已清空对话记录。");
        return;
      }
      const detail = await api.clearMessageAgentChat(session.id);
      setSession(detail.session);
      setMessages(detail.messages);
      setSources(detail.sources);
      setTemplates(detail.templates);
      setDraft(detail.latestDraft);
      setDraftSubject(detail.latestDraft?.subject ?? "");
      setDraftBody(detail.latestDraft?.body ?? "");
      setAssistantExtras({});
      setLatestSourceRefs(latestDraftSourceRefs(detail.messages, detail.latestDraft));
      setUploadProgress(detail.uploadProgress ?? null);
      setWarnings([]);
      setMessage("");
      setChatImages([]);
      setNotice("已清空对话记录。");
    } catch (clearError) {
      setError(readableError(clearError));
    } finally {
      setClearingChat(false);
    }
  };

  const clearSession = async () => {
    if (!window.confirm("确认清空当前邮件写作会话？")) return;
    setError("");
    setNotice("");
    setWarnings([]);
    try {
      if (session) {
        await api.deleteMessageAgentSession(session.id);
      }
    } catch {
      // If the backend session has already gone away, still reset local state.
    }
    forgetSessionId();
    await createFreshSession();
    setReferenceFiles([]);
    setRequestFiles([]);
    setChatImages([]);
    setMessage("");
    setNotice("已清空会话。");
  };

  const renderUploadSelection = (role: "reference" | "request", files: File[]) => (
    <div className="selected-files message-agent-file-list">
      <div>
        <FileUp size={18} />
        <span>{files.length ? `${files.length} 个待上传可解析文档` : `尚未选择${fileRoleLabels[role]}`}</span>
      </div>
      {files.slice(0, 6).map((file, index) => (
        <div key={`${relativeFilePath(file)}-${index}`}>
          <span>{relativeFilePath(file)}</span>
          <span className="muted-row">{formatBytes(file.size)}</span>
          <button className="icon-button small" type="button" onClick={() => removeUploadFile(role, index)} title="移除文件">
            <X size={15} />
          </button>
        </div>
      ))}
      {files.length > 6 ? <div className="muted-row">还有 {files.length - 6} 个可解析文档待上传</div> : null}
    </div>
  );

  const renderUploadProgress = () => {
    if (!visibleUploadProgress) return null;
    const total = Math.max(visibleUploadProgress.totalFiles, 1);
    const processed = Math.min(visibleUploadProgress.processedFiles, total);
    const percent = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
    const detail = visibleUploadProgress.error
      ? `错误：${readableUploadError(visibleUploadProgress.error)}`
      : visibleUploadProgress.currentFileName
        ? `当前文件：${visibleUploadProgress.currentFileName}`
        : "正在准备上传队列";
    return (
      <div className="message-agent-upload-progress" role="status" aria-live="polite">
        <div className="message-agent-upload-progress-heading">
          <strong>{uploadPhaseLabels[visibleUploadProgress.phase]}</strong>
          <span>
            {fileRoleLabels[visibleUploadProgress.role]} · {processed}/{total}
          </span>
        </div>
        <div className={`job-progress message-agent-upload-progress-bar message-agent-upload-${visibleUploadProgress.phase}`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="job-progress-detail">{detail}</div>
      </div>
    );
  };

  const renderSourceRefs = (items: MessageAgentSourceRef[]) =>
    items.length ? (
      <div className="source-list">
        {items.map((source, index) => (
          <article className="source-card" key={`${source.sourceId}-${source.templateId ?? index}`}>
            <div className="source-card-heading">
              <BotMessageSquare size={15} />
              <strong>{source.title || source.fileName}</strong>
              <span>{source.category ? categoryLabels[source.category] : "来源引用"}</span>
            </div>
            <p>{source.snippet}</p>
          </article>
        ))}
      </div>
    ) : null;

  if (bootstrapping) return <Loading label="加载邮件写作 Agent" />;

  return (
    <section>
      <PageHeader
        title="邮件写作 Agent"
        meta={activeTab === "writing" ? "上传当前请求文档，聊天区可附加图片，生成可编辑邮件草稿" : "录入可解析参考邮件库文档，查看解析来源和模板"}
        actions={
          <>
            <button className="icon-text" type="button" onClick={() => void refreshSession()} disabled={!session || refreshing}>
              <RefreshCw size={17} />
              <span>{refreshing ? "刷新中" : "刷新"}</span>
            </button>
            {activeTab === "writing" ? (
              <button className="icon-text danger" type="button" onClick={() => void clearSession()} disabled={!session}>
                <Trash2 size={17} />
                <span>清空会话</span>
              </button>
            ) : null}
          </>
        }
      />

      <div className="segmented-tabs" role="tablist" aria-label="邮件写作 Agent">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "writing"}
          className={activeTab === "writing" ? "active" : ""}
          onClick={() => setActiveTab("writing")}
        >
          邮件写作
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "reference"}
          className={activeTab === "reference" ? "active" : ""}
          onClick={() => setActiveTab("reference")}
        >
          参考邮件库录入
        </button>
      </div>

      {error ? <div className="notice danger">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      {warnings.length ? (
        <div className="notice message-agent-warning">
          {warnings.map((warning) => (
            <span key={warning}>{friendlyWarning(warning)}</span>
          ))}
        </div>
      ) : null}
      {renderUploadProgress()}

      {activeTab === "writing" ? (
        <div className="message-agent-grid">
          <div className="message-agent-main">
            <section className="panel">
              <div className="panel-heading">
                <div className="panel-title">当前请求文档</div>
                <span className="muted-hint">仅上传可解析文档；截图或照片请走聊天图片附件</span>
              </div>
              <div className="upload-grid">
                <label className="file-field">
                  <span>请求可解析文档</span>
                  <input
                    type="file"
                    accept={acceptedMessageAgentDocuments}
                    multiple
                    onChange={(event) => addUploadFiles("request", event)}
                    disabled={Boolean(uploadingRole)}
                  />
                </label>
                <label className="file-field">
                  <span>请求文档文件夹</span>
                  <input {...requestDirectoryInputProps} />
                </label>
              </div>
              {renderUploadSelection("request", requestFiles)}
              <div className="button-row">
                <button
                  className="primary-action compact"
                  type="button"
                  onClick={() => void uploadFiles("request")}
                  disabled={Boolean(uploadingRole) || !requestFiles.length}
                >
                  {uploadingRole === "request" ? <RefreshCw size={17} /> : <FileUp size={17} />}
                  <span>{uploadingRole === "request" ? "上传中" : "上传请求文档"}</span>
                </button>
              </div>
            </section>

            <section className="panel message-agent-chat-panel">
              <div className="panel-heading">
                <div>
                  <div className="panel-title">对话</div>
                  <span className="muted-hint">图片只作为聊天附件进入多模态理解，不进入文档解析库。</span>
                </div>
                <button
                  className="icon-text"
                  type="button"
                  onClick={() => void clearChat()}
                  disabled={clearingChat || sending || (!messages.length && !message.trim() && !chatImages.length)}
                  title="清空对话记录和未发送内容"
                >
                  <Trash2 size={17} />
                  <span>{clearingChat ? "清空中" : "清空对话"}</span>
                </button>
              </div>

              <div className="chat-messages" aria-live="polite">
                {messages.length ? (
                  messages.map((item) => {
                    const extra = assistantExtras[item.id];
                    const imageNames = Array.isArray(item.metadata.imageNames) ? item.metadata.imageNames.map(String) : [];
                    return (
                      <div className={`chat-message ${item.role}`} key={item.id}>
                        <div className="chat-bubble">
                          <p className="chat-answer">{item.content}</p>
                          {imageNames.length ? (
                            <div className="chat-file-tags">
                              {imageNames.map((name) => (
                                <span key={name}>{name}</span>
                              ))}
                            </div>
                          ) : null}
                          {extra?.followUpQuestions.length ? (
                            <div className="follow-up-list">
                              {extra.followUpQuestions.map((question) => (
                                <div className="follow-up-card" key={question.slotKey}>
                                  <strong>{question.required ? "需补充" : "可补充"}</strong>
                                  <span>{question.question}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {extra?.warnings.length ? (
                            <div className="chat-warning">
                              {extra.warnings.map((warning) => (
                                <span key={warning}>{friendlyWarning(warning)}</span>
                              ))}
                            </div>
                          ) : null}
                          {extra?.sources.length ? renderSourceRefs(extra.sources) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-panel">暂无对话</div>
                )}
                {sending ? (
                  <div className="chat-message assistant">
                    <div className="chat-bubble">
                      <span className="muted-hint">正在整理邮件草稿</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <form className="chat-composer" onSubmit={sendChatMessage}>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="粘贴当前邮件、描述要回复的事项，或回答 Agent 的追问"
                  disabled={sending}
                />
                {chatImages.length ? (
                  <div className="chat-file-tags editable">
                    {chatImages.map((image, index) => (
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
                    <span>添加聊天图片</span>
                    <input type="file" accept="image/*" multiple onChange={selectImages} disabled={sending} />
                  </label>
                  <button className="primary-action compact" type="submit" disabled={sending}>
                    {sending ? <RefreshCw size={17} /> : <Send size={17} />}
                    <span>{sending ? "生成中" : "发送"}</span>
                  </button>
                </div>
              </form>
            </section>
          </div>

          <aside className="message-agent-side">
            <section className="panel">
              <div className="panel-title">会话概览</div>
              <dl className="compact-detail-list message-agent-summary">
                <dt>来源</dt>
                <dd>{session?.sourceCount ?? sources.length}</dd>
                <dt>模板</dt>
                <dd>{session?.templateCount ?? templates.length}</dd>
                <dt>消息</dt>
                <dd>{session?.messageCount ?? messages.length}</dd>
                <dt>更新</dt>
                <dd>{session ? formatTime(session.updatedAt) : "-"}</dd>
              </dl>
            </section>

            <section className="panel message-agent-draft-panel">
              <div className="panel-heading">
                <div className="panel-title">邮件草稿</div>
                {draftDirty ? <span className="badge message-agent-dirty">未保存</span> : null}
              </div>
              {draft ? (
                <>
                  <label>
                    主题
                    <input value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} />
                  </label>
                  <label>
                    正文
                    <textarea className="message-agent-draft-body" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
                  </label>
                  {draft.attachmentSuggestions.length ? (
                    <div className="message-agent-attachments">
                      {draft.attachmentSuggestions.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="button-row">
                    <button className="icon-text" type="button" onClick={() => void persistDraftEdits()} disabled={savingDraft || !draftDirty}>
                      <RefreshCw size={17} />
                      <span>{savingDraft ? "保存中" : "保存编辑"}</span>
                    </button>
                    <button className="icon-text" type="button" onClick={() => void copyText(draftSubject, "主题")}>
                      <Copy size={17} />
                      <span>复制主题</span>
                    </button>
                    <button className="icon-text" type="button" onClick={() => void copyText(draftBody, "正文")}>
                      <Copy size={17} />
                      <span>复制正文</span>
                    </button>
                    <button className="primary-action compact" type="button" onClick={() => void downloadDraft()} disabled={downloading || savingDraft}>
                      {downloading ? <RefreshCw size={17} /> : <Download size={17} />}
                      <span>{downloading ? "下载中" : "下载 DOCX"}</span>
                    </button>
                  </div>
                  {renderSourceRefs(draftSources)}
                </>
              ) : (
                <div className="empty-panel">生成草稿后可在这里编辑并下载 DOCX</div>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div className="panel-title">参考邮件库录入</div>
              <span className="muted-hint">模板 {templates.length} 个 · 参考来源 {referenceSources.length} 个</span>
            </div>
            <div className="upload-grid">
              <label className="file-field">
                <span>参考可解析文档</span>
                <input
                  type="file"
                  accept={acceptedMessageAgentDocuments}
                  multiple
                  onChange={(event) => addUploadFiles("reference", event)}
                  disabled={Boolean(uploadingRole)}
                />
              </label>
              <label className="file-field">
                <span>参考文档文件夹</span>
                <input {...referenceDirectoryInputProps} />
              </label>
            </div>
            {renderUploadSelection("reference", referenceFiles)}
            <div className="button-row">
              <button
                className="primary-action compact"
                type="button"
                onClick={() => void uploadFiles("reference")}
                disabled={Boolean(uploadingRole) || !referenceFiles.length}
              >
                {uploadingRole === "reference" ? <RefreshCw size={17} /> : <FileUp size={17} />}
                <span>{uploadingRole === "reference" ? "上传中" : "上传参考文档"}</span>
              </button>
              <span className="muted-hint">仅支持可解析文档：.xlsx、.docx、.pdf、.md、.txt、.csv；.msg/.doc 不支持，图片请在邮件写作页签的对话区添加。</span>
            </div>
          </section>

          <div className="message-agent-grid">
            <section className="panel">
              <div className="panel-title">可解析文档来源状态</div>
              {referenceSources.length ? (
                <div className="message-agent-source-list">
                  {referenceSources.slice(0, 12).map((source) => (
                    <div className="message-agent-source-item" key={source.id}>
                      <div>
                        <strong>{source.originalName || source.fileName}</strong>
                        <span>{fileRoleLabels[source.role]} · {formatBytes(source.size)}</span>
                      </div>
                      <span className={`badge message-agent-file-${source.status}`}>{fileStatusLabels[source.status]}</span>
                      {source.warnings.length ? <p>{source.warnings.map(friendlyWarning).join("；")}</p> : null}
                    </div>
                  ))}
                  {referenceSources.length > 12 ? <div className="muted-row">还有 {referenceSources.length - 12} 个参考来源</div> : null}
                </div>
              ) : (
                <div className="empty-panel">暂无参考可解析文档来源</div>
              )}
            </section>

            <aside className="message-agent-side">
              <section className="panel">
                <div className="panel-title">参考模板</div>
                {templates.length ? (
                  <div className="message-agent-template-list">
                    {templates.slice(0, 10).map((template) => (
                      <article className="source-card" key={template.id}>
                        <div className="source-card-heading">
                          <BotMessageSquare size={15} />
                          <strong>{template.title}</strong>
                          <span>{categoryLabels[template.category]}</span>
                        </div>
                        <p>{snippet(template.bodySkeleton)}</p>
                      </article>
                    ))}
                    {templates.length > 10 ? <div className="muted-row">还有 {templates.length - 10} 个模板</div> : null}
                  </div>
                ) : (
                  <div className="empty-panel">上传参考可解析文档后显示模板</div>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
