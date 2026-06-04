import { describe, expect, it } from "vitest";
import { classifyByRules } from "../src/business/classifier.js";

describe("classifyByRules", () => {
  it("classifies the eight initial business scenarios", () => {
    expect(classifyByRules("毕业退宿申请", "姓名：张三")).toBe("checkout");
    expect(classifyByRules("楼层导师报告", "本周走访情况")).toBe("tutor_report");
    expect(classifyByRules("党组织关系转接咨询", "请问材料")).toBe("party_consultation");
    expect(classifyByRules("新生报到流程", "行李寄送")).toBe("admission_consultation");
    expect(classifyByRules("功能房使用报备", "会议室借用")).toBe("room_usage");
    expect(classifyByRules("换宿申请", "当前宿舍")).toBe("dorm_transfer");
    expect(classifyByRules("楼层导师申请", "申请 Tutor")).toBe("tutor_application");
    expect(classifyByRules("奖学金申请材料", "获奖证书见附件")).toBe("scholarship");
  });
});
