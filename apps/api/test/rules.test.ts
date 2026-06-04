import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/config/defaults.js";
import { validateRoomUsage } from "../src/business/roomRules.js";
import { compareScholarshipMaterial } from "../src/business/scholarship.js";

describe("room usage validation", () => {
  it("approves complete low-risk requests", () => {
    const result = validateRoomUsage(
      {
        applicant: "张三",
        room: "多功能室",
        usageTime: "2026年6月4日 14:00",
        purpose: "班会",
        participantCount: 20
      },
      defaultSettings("public@example.edu.cn")
    );
    expect(result.approved).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects missing or out-of-policy requests", () => {
    const result = validateRoomUsage(
      {
        applicant: "张三",
        room: "未配置空间",
        purpose: "商业活动",
        participantCount: 80
      },
      defaultSettings("public@example.edu.cn")
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.join("；")).toContain("缺失信息");
    expect(result.reasons.join("；")).toContain("参与人数超过上限");
  });
});

describe("scholarship material comparison", () => {
  it("flags obvious mismatch between body and image OCR", () => {
    const result = compareScholarshipMaterial(
      {
        awardName: "数学竞赛一等奖",
        awardLevel: "一等奖",
        name: "张三",
        issuer: "数学学会"
      },
      [
        {
          awardName: "物理竞赛二等奖",
          level: "二等奖",
          winner: "李四",
          issuer: "物理学会",
          awardedAt: "2026",
          confidence: 0.9
        }
      ]
    );
    expect(result.matched).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining(["正文奖项名称与附件识别结果不一致", "正文获奖人与附件识别结果不一致"])
    );
  });
});
