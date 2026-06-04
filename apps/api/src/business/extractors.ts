import type { MailCategory } from "@harmonia/shared";

const fieldSeparators = String.raw`[:：\s]*`;

function compact(value: string | undefined): string | null {
  const normalized = value?.replace(/[，,。；;\n\r]+$/g, "").trim();
  return normalized ? normalized : null;
}

function matchField(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const regex = new RegExp(`${label}${fieldSeparators}([^\\n\\r；;，,。]{2,80})`, "i");
    const match = text.match(regex);
    const value = compact(match?.[1]);
    if (value) return value;
  }
  return null;
}

function matchFirst(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return compact(match?.[1] ?? match?.[0]);
}

function extractCommon(text: string): Record<string, unknown> {
  return {
    name: matchField(text, ["姓名", "申请人", "提交人", "获奖人"]),
    studentId: matchField(text, ["学号"]) ?? matchFirst(text, /\b\d{8,12}\b/),
    contact: matchField(text, ["联系方式", "联系电话", "电话", "手机"]) ?? matchFirst(text, /\b1[3-9]\d{9}\b/)
  };
}

export function missingFields(data: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => {
    const value = data[field];
    return value === null || value === undefined || value === "";
  });
}

export function extractByRules(category: MailCategory, subject: string, bodyText: string): Record<string, unknown> {
  const text = `${subject}\n${bodyText}`;
  const common = extractCommon(text);

  if (category === "checkout") {
    return {
      ...common,
      reason: matchField(text, ["退宿原因", "原因"]),
      checkoutTime: matchField(text, ["退宿时间", "离校时间", "退寝时间"])
    };
  }

  if (category === "tutor_report") {
    return {
      reporter: matchField(text, ["提交人", "楼层导师", "导师姓名"]) ?? common.name,
      floor: matchField(text, ["楼层", "负责楼层"]),
      reportTime: matchField(text, ["时间", "提交时间", "报告时间"]),
      reportTopic: matchField(text, ["报告主题", "主题"]) ?? subject,
      mainContent: bodyText.slice(0, 800)
    };
  }

  if (category === "room_usage") {
    return {
      applicant: matchField(text, ["申请人", "报备人", "姓名"]) ?? common.name,
      room: matchField(text, ["使用地点", "地点", "功能房", "房间"]),
      usageTime: matchField(text, ["使用时间", "时间"]),
      purpose: matchField(text, ["使用目的", "用途", "活动内容"]),
      participantCount: Number(matchFirst(text, /(\d{1,3})\s*(人|位)/) ?? 0) || null,
      contact: common.contact
    };
  }

  if (category === "dorm_transfer") {
    return {
      ...common,
      currentDorm: matchField(text, ["当前宿舍", "原宿舍", "现宿舍"]),
      targetDorm: matchField(text, ["申请更换宿舍", "目标宿舍", "希望更换至"]),
      reason: matchField(text, ["换宿原因", "调宿原因", "原因"])
    };
  }

  if (category === "tutor_application") {
    return {
      ...common,
      grade: matchField(text, ["年级"]),
      major: matchField(text, ["专业"]),
      reason: matchField(text, ["申请理由", "理由"]),
      experience: matchField(text, ["相关经历", "经历", "工作经历"])
    };
  }

  if (category === "scholarship") {
    return {
      ...common,
      awardName: matchField(text, ["奖项名称", "奖项", "获奖名称"]),
      awardLevel: matchField(text, ["获奖等级", "等级"]),
      issuer: matchField(text, ["颁发单位", "发证单位", "主办单位"]),
      awardedAt: matchField(text, ["获奖时间", "颁发时间", "时间"])
    };
  }

  return common;
}

export function mergeExtraction(ruleData: Record<string, unknown>, aiData: Record<string, unknown> | null): Record<string, unknown> {
  if (!aiData) return ruleData;
  const merged = { ...aiData };
  for (const [key, value] of Object.entries(ruleData)) {
    if (value !== "" && value !== undefined && value !== null) merged[key] = value;
  }
  return Object.fromEntries(
    Object.entries(merged).map(([key, value]) => {
      if (value === "" || value === undefined) return [key, null];
      return [key, value];
    })
  );
}
