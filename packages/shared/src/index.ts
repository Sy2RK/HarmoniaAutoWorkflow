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

export type AppSettings = {
  mailboxAddress: string;
  ownerEmails: BusinessOwnerConfig;
  defaultManualEmail: string;
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

export type ApiListResponse<T> = {
  items: T[];
  total: number;
};
