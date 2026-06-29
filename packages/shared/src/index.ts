export const mailCategories = [
  "checkout",
  "tutor_report",
  "party_consultation",
  "admission_consultation",
  "room_usage",
  "dorm_transfer",
  "tutor_application",
  "scholarship",
  "other"
] as const;

export type MailCategory = (typeof mailCategories)[number];

export const mailCategoryLabels: Record<MailCategory, string> = {
  checkout: "退宿申请",
  tutor_report: "Tutor 报告",
  party_consultation: "党团关系咨询",
  admission_consultation: "入学季咨询",
  room_usage: "功能房报备",
  dorm_transfer: "换宿申请",
  tutor_application: "Tutor 申请",
  scholarship: "奖学金申请",
  other: "其他"
};

export const processingStatuses = [
  "new",
  "processing",
  "awaiting_review",
  "auto_approved",
  "forwarded",
  "manual_required",
  "completed",
  "failed"
] as const;

export type ProcessingStatus = (typeof processingStatuses)[number];

export const draftStatuses = [
  "draft",
  "saved",
  "sent",
  "rejected",
  "manual_required",
  "no_reply_needed"
] as const;

export type DraftStatus = (typeof draftStatuses)[number];

export type AttachmentRecord = {
  id: string;
  messageId: string;
  graphAttachmentId: string;
  name: string;
  contentType: string;
  size: number;
  storagePath: string;
  createdAt: string;
};

export type MailMessage = {
  id: string;
  mailboxAddress: string;
  graphMessageId: string;
  internetMessageId: string | null;
  conversationId: string | null;
  subject: string;
  senderName: string | null;
  senderEmail: string;
  toRecipients: string[];
  ccRecipients: string[];
  receivedAt: string;
  bodyText: string;
  hasAttachments: boolean;
  category: MailCategory;
  status: ProcessingStatus;
  needsReview: boolean;
  extracted: Record<string, unknown>;
  overview: string | null;
  recommendation: string | null;
  error: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReplyDraft = {
  id: string;
  messageId: string;
  toEmail: string;
  ccEmails: string[];
  subject: string;
  body: string;
  status: DraftStatus;
  createdByAi: boolean;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ForwardRecord = {
  id: string;
  messageId: string;
  toEmail: string;
  subject: string;
  summary: string;
  status: "pending" | "sent" | "failed";
  error: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type DashboardSummary = {
  pendingMessages: number;
  pendingDrafts: number;
  processedToday: number;
  autoApprovedToday: number;
  failedMessages: number;
  recentMessages: MailMessage[];
};

export type BusinessOwnerConfig = Partial<Record<MailCategory, string>>;

export const scholarshipAiModels = ["qwen3-5-397b-a17b", "gemma-4-31B"] as const;

export type ScholarshipAiModel = (typeof scholarshipAiModels)[number];

export type AppSettings = {
  mailboxAddress: string;
  ownerEmails: BusinessOwnerConfig;
  defaultManualEmail: string;
  scholarshipCheckAiModel: ScholarshipAiModel;
  roomAutoApproveEnabled: boolean;
  knowledgeBaseEnabled: boolean;
  mailSyncEnabled: boolean;
  roomRules: {
    allowedRooms: string[];
    maxParticipants: number;
    allowedPurposes: string[];
  };
};

export type KnowledgeEntry = {
  id: string;
  category: "party_consultation" | "admission_consultation";
  question: string;
  answer: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const collegeKnowledgeDocumentStatuses = ["queued", "processing", "ready", "partial", "failed", "unsupported"] as const;

export type CollegeKnowledgeDocumentStatus = (typeof collegeKnowledgeDocumentStatuses)[number];

export const collegeKnowledgeChatModes = ["fast", "precise"] as const;

export type CollegeKnowledgeChatMode = (typeof collegeKnowledgeChatModes)[number];

export type CollegeKnowledgeDocument = {
  id: string;
  fileName: string;
  originalName: string;
  relativePath: string | null;
  contentType: string | null;
  size: number;
  sha256: string;
  status: CollegeKnowledgeDocumentStatus;
  error: string | null;
  warnings: string[];
  storagePath: string;
  extractedMarkdownPath: string;
  metadataPath: string;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CollegeKnowledgeSource = {
  id: string;
  documentId: string;
  documentName: string;
  relativePath: string | null;
  locator: string;
  title: string | null;
  snippet: string;
  score?: number;
};

export type CollegeKnowledgeChatResponse = {
  answer: string;
  answerable: boolean;
  sources: CollegeKnowledgeSource[];
  warnings: string[];
};

export const messageAgentTemplateCategories = [
  "facility_notice",
  "youth_league",
  "electricity_subsidy",
  "function_room",
  "property_staff",
  "bfmo_coordination",
  "recommendation_letter",
  "event_registration",
  "format_reminder",
  "general_reply"
] as const;

export type MessageAgentTemplateCategory = (typeof messageAgentTemplateCategories)[number];

export const messageAgentFileStatuses = ["ready", "partial", "unsupported", "failed", "ignored"] as const;

export type MessageAgentFileStatus = (typeof messageAgentFileStatuses)[number];

export type MessageAgentFileRole = "reference" | "request" | "attachment";

export type MessageAgentLanguage = "zh" | "en" | "bilingual" | "mixed";

export type MessageAgentAudience = "student" | "teachers_students" | "department" | "recommender" | "staff" | "unknown";

export type MessageAgentSlot = {
  key: string;
  label: string;
  description?: string;
};

export type MessageAgentSession = {
  id: string;
  status: "active" | "deleted";
  createdAt: string;
  updatedAt: string;
  sourceCount: number;
  templateCount: number;
  messageCount: number;
  latestDraftId: string | null;
};

export type MessageAgentUploadProgress = {
  active: boolean;
  phase: "uploading" | "parsing" | "templating" | "completed" | "failed";
  role: MessageAgentFileRole;
  totalFiles: number;
  processedFiles: number;
  currentFileName: string | null;
  warnings: string[];
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type MessageAgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type MessageAgentSource = {
  id: string;
  sessionId: string;
  fileName: string;
  originalName: string;
  relativePath: string | null;
  role: MessageAgentFileRole;
  contentType: string | null;
  size: number;
  status: MessageAgentFileStatus;
  text: string;
  warnings: string[];
  createdAt: string;
};

export type MessageAgentTemplate = {
  id: string;
  category: MessageAgentTemplateCategory;
  title: string;
  language: MessageAgentLanguage;
  audience: MessageAgentAudience;
  subjectPattern: string | null;
  bodySkeleton: string;
  requiredSlots: MessageAgentSlot[];
  optionalSlots: MessageAgentSlot[];
  tone: string;
  signatureStyle: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type MessageAgentDraft = {
  id: string;
  subject: string;
  body: string;
  plainText: string;
  sourceIds: string[];
  sourceRefs?: MessageAgentSourceRef[];
  attachmentSuggestions: string[];
  missingSlots: MessageAgentSlot[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
};

export type MessageAgentQuestion = {
  slotKey: string;
  question: string;
  required: boolean;
};

export type MessageAgentSourceRef = {
  sourceId: string;
  templateId: string | null;
  fileName: string;
  title: string;
  category: MessageAgentTemplateCategory | null;
  snippet: string;
};

export const messageAgentChatModes = ["fast", "precise"] as const;

export type MessageAgentChatMode = (typeof messageAgentChatModes)[number];

export type MessageAgentChatResponse = {
  session: MessageAgentSession;
  assistantMessage: MessageAgentMessage;
  draft: MessageAgentDraft | null;
  followUpQuestions: MessageAgentQuestion[];
  sources: MessageAgentSourceRef[];
  warnings: string[];
};

export type ApiListResponse<T> = {
  items: T[];
  total: number;
};

export const scholarshipCheckJobStatuses = ["queued", "processing", "paused", "completed", "failed", "cancelled"] as const;

export type ScholarshipCheckJobStatus = (typeof scholarshipCheckJobStatuses)[number];

export const scholarshipCheckRowStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;

export type ScholarshipCheckRowStatus = (typeof scholarshipCheckRowStatuses)[number];

export type ScholarshipCheckJob = {
  id: string;
  status: ScholarshipCheckJobStatus;
  createdAt: string;
  updatedAt: string;
  totalApplicants: number;
  processedApplicants: number;
  error: string | null;
};

export type ScholarshipCheckRow = {
  rowNumber: number;
  name: string;
  studentId: string;
  status: ScholarshipCheckRowStatus;
  remark: string | null;
  detail: string | null;
  error: string | null;
  editedAt?: string | null;
  editedBy?: string | null;
};

export const awardConfidenceJobStatuses = ["queued", "processing", "paused", "completed", "failed", "cancelled"] as const;

export type AwardConfidenceJobStatus = (typeof awardConfidenceJobStatuses)[number];

export const awardConfidenceRowStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;

export type AwardConfidenceRowStatus = (typeof awardConfidenceRowStatuses)[number];

export type AwardConfidenceJob = {
  id: string;
  status: AwardConfidenceJobStatus;
  createdAt: string;
  updatedAt: string;
  totalRows: number;
  processedRows: number;
  error: string | null;
};

export type AwardConfidenceRow = {
  sheetName: string;
  rowNumber: number;
  name: string;
  firstAward: string | null;
  secondAward: string | null;
  firstAwardConfidence: number | null;
  secondAwardConfidence: number | null;
  status: AwardConfidenceRowStatus;
  error: string | null;
};
