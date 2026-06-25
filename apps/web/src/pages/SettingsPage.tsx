import { FormEvent, useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  mailCategoryLabels,
  scholarshipAiModels,
  type AppSettings,
  type BusinessOwnerConfig,
  type MailCategory
} from "@harmonia/shared";
import { api } from "../api/client.js";
import { Loading } from "../components/Loading.js";
import { PageHeader } from "../components/PageHeader.js";

const ownerCategories: MailCategory[] = ["tutor_report", "room_usage", "dorm_transfer", "tutor_application", "scholarship", "other"];

function lines(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(value: string[]): string {
  return value.join("\n");
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [notice, setNotice] = useState("");
  const [roomText, setRoomText] = useState("");
  const [purposeText, setPurposeText] = useState("");

  const load = async () => {
    const settingsData = await api.settings();
    setSettings(settingsData);
    setRoomText(joinLines(settingsData.roomRules.allowedRooms));
    setPurposeText(joinLines(settingsData.roomRules.allowedPurposes));
  };

  useEffect(() => {
    void load();
  }, []);

  const updateOwner = (category: MailCategory, email: string) => {
    if (!settings) return;
    const ownerEmails: BusinessOwnerConfig = { ...settings.ownerEmails, [category]: email };
    setSettings({ ...settings, ownerEmails });
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    const saved = await api.saveSettings({
      ...settings,
      roomRules: {
        ...settings.roomRules,
        allowedRooms: lines(roomText),
        allowedPurposes: lines(purposeText)
      }
    });
    setSettings(saved);
    setNotice("配置已保存");
  };

  if (!settings) return <Loading label="读取配置" />;

  return (
    <section>
      <PageHeader title="配置" meta="基础运行参数" />
      {notice ? <div className="notice">{notice}</div> : null}
      <form className="settings-grid" onSubmit={saveSettings}>
        <section className="panel">
          <div className="panel-title">邮箱与开关</div>
          <label>
            Outlook 公共邮箱
            <input value={settings.mailboxAddress} onChange={(event) => setSettings({ ...settings, mailboxAddress: event.target.value })} />
          </label>
          <label>
            默认人工处理邮箱
            <input value={settings.defaultManualEmail} onChange={(event) => setSettings({ ...settings, defaultManualEmail: event.target.value })} />
          </label>
          <div className="toggle-list">
            <label>
              <input
                type="checkbox"
                checked={settings.roomAutoApproveEnabled}
                onChange={(event) => setSettings({ ...settings, roomAutoApproveEnabled: event.target.checked })}
              />
              功能房自动批准
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.knowledgeBaseEnabled}
                onChange={(event) => setSettings({ ...settings, knowledgeBaseEnabled: event.target.checked })}
              />
              知识库启用
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.mailSyncEnabled}
                onChange={(event) => setSettings({ ...settings, mailSyncEnabled: event.target.checked })}
              />
              邮件同步
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">AI 模型</div>
          <label>
            核对模型
            <select
              value={settings.scholarshipCheckAiModel}
              onChange={(event) =>
                setSettings({ ...settings, scholarshipCheckAiModel: event.target.value as AppSettings["scholarshipCheckAiModel"] })
              }
            >
              {scholarshipAiModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="panel">
          <div className="panel-title">负责老师邮箱</div>
          {ownerCategories.map((category) => (
            <label key={category}>
              {mailCategoryLabels[category]}
              <input value={settings.ownerEmails[category] ?? ""} onChange={(event) => updateOwner(category, event.target.value)} />
            </label>
          ))}
        </section>

        <section className="panel">
          <div className="panel-title">功能房规则</div>
          <label>
            可自动批准地点
            <textarea value={roomText} onChange={(event) => setRoomText(event.target.value)} />
          </label>
          <label>
            参与人数上限
            <input
              type="number"
              min={1}
              value={settings.roomRules.maxParticipants}
              onChange={(event) =>
                setSettings({ ...settings, roomRules: { ...settings.roomRules, maxParticipants: Number(event.target.value) || 1 } })
              }
            />
          </label>
          <label>
            可自动批准用途
            <textarea value={purposeText} onChange={(event) => setPurposeText(event.target.value)} />
          </label>
          <button className="primary-action compact" type="submit">
            <Save size={17} />
            <span>保存配置</span>
          </button>
        </section>
      </form>

    </section>
  );
}
