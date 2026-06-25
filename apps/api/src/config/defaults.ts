import type { AppSettings } from "@harmonia/shared";

export function defaultSettings(mailboxAddress: string): AppSettings {
  return {
    mailboxAddress,
    ownerEmails: {
      tutor_report: "",
      room_usage: "",
      dorm_transfer: "",
      tutor_application: "",
      scholarship: "",
      other: ""
    },
    defaultManualEmail: "",
    scholarshipCheckAiModel: "qwen3-5-397b-a17b",
    roomAutoApproveEnabled: true,
    knowledgeBaseEnabled: true,
    mailSyncEnabled: false,
    roomRules: {
      allowedRooms: ["多功能室", "会议室", "研讨室"],
      maxParticipants: 30,
      allowedPurposes: ["班会", "导师活动", "学习研讨", "学院活动"]
    }
  };
}
