import type { MailCategory } from "@harmonia/shared";

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, "");
}

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function classifyByRules(subject: string, bodyText: string): MailCategory {
  const text = normalize(`${subject}\n${bodyText}`);

  if (hasAny(text, ["楼层导师申请", "tutor申请", "申请tutor", "申请楼层导师"])) return "tutor_application";
  if (hasAny(text, ["奖学金", "奖项", "获奖", "荣誉证书", "证书附件"])) return "scholarship";
  if (hasAny(text, ["换宿", "调宿", "更换宿舍", "宿舍调整"])) return "dorm_transfer";
  if (hasAny(text, ["退宿", "退寝", "退出宿舍", "毕业离校住宿", "离校退宿"])) return "checkout";
  if (hasAny(text, ["功能房", "活动室", "会议室借用", "研讨室", "场地使用", "房间使用报备"])) return "room_usage";
  if (hasAny(text, ["党团关系", "党组织关系", "团组织关系", "组织关系转接", "团员关系", "党员关系"])) {
    return "party_consultation";
  }
  if (hasAny(text, ["入学", "新生", "报到", "迎新", "行李寄送", "入住安排", "新生材料"])) return "admission_consultation";
  if (hasAny(text, ["tutor报告", "楼层导师报告", "导师报告", "楼层情况", "走访报告"])) return "tutor_report";

  return "other";
}
