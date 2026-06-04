import { mailCategoryLabels, type MailCategory, type ProcessingStatus } from "@harmonia/shared";

const statusLabels: Record<ProcessingStatus, string> = {
  new: "新邮件",
  processing: "处理中",
  awaiting_review: "待审核",
  auto_approved: "自动批准",
  forwarded: "已转发",
  manual_required: "需人工",
  completed: "已完成",
  failed: "失败"
};

export function StatusBadge({ status }: { status: ProcessingStatus }) {
  return <span className={`badge status-${status}`}>{statusLabels[status]}</span>;
}

export function CategoryBadge({ category }: { category: MailCategory }) {
  return <span className={`badge category-${category}`}>{mailCategoryLabels[category]}</span>;
}
