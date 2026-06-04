import type { AppSettings, MailMessage } from "@harmonia/shared";
import { missingFields } from "./extractors.js";

export type RoomValidationResult = {
  approved: boolean;
  reasons: string[];
};

function textValue(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

export function validateRoomUsage(
  extracted: Record<string, unknown>,
  settings: AppSettings,
  existingRoomMessages: MailMessage[] = []
): RoomValidationResult {
  const reasons: string[] = [];
  const missing = missingFields(extracted, ["applicant", "room", "usageTime", "purpose", "participantCount"]);
  if (missing.length) reasons.push(`缺失信息：${missing.join("、")}`);

  const room = textValue(extracted, "room");
  const purpose = textValue(extracted, "purpose");
  const participantCount = Number(extracted.participantCount ?? 0);
  const usageTime = textValue(extracted, "usageTime");

  if (settings.roomRules.allowedRooms.length && !settings.roomRules.allowedRooms.some((allowed) => room.includes(allowed))) {
    reasons.push("申请地点不在允许的功能房列表中");
  }
  if (participantCount > settings.roomRules.maxParticipants) {
    reasons.push(`参与人数超过上限 ${settings.roomRules.maxParticipants}`);
  }
  if (settings.roomRules.allowedPurposes.length && !settings.roomRules.allowedPurposes.some((allowed) => purpose.includes(allowed))) {
    reasons.push("申请用途不在默认可自动批准范围内");
  }

  const hasConflict = existingRoomMessages.some((message) => {
    if (message.status !== "auto_approved" && message.status !== "completed") return false;
    const otherRoom = textValue(message.extracted, "room");
    const otherTime = textValue(message.extracted, "usageTime");
    return otherRoom && otherTime && room.includes(otherRoom) && usageTime === otherTime;
  });
  if (hasConflict) reasons.push("存在同一地点同一时间的已批准记录");

  return { approved: reasons.length === 0, reasons };
}
