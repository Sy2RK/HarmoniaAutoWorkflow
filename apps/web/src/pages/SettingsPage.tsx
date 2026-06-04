import { FormEvent, useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  mailCategoryLabels,
  type AppSettings,
  type BusinessOwnerConfig,
  type KnowledgeEntry,
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
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [roomText, setRoomText] = useState("");
  const [purposeText, setPurposeText] = useState("");
  const [faq, setFaq] = useState({
    category: "party_consultation" as KnowledgeEntry["category"],
    question: "",
    answer: "",
    enabled: true
  });

  const load = async () => {
    const [settingsData, knowledgeData] = await Promise.all([api.settings(), api.knowledge()]);
    setSettings(settingsData);
    setRoomText(joinLines(settingsData.roomRules.allowedRooms));
    setPurposeText(joinLines(settingsData.roomRules.allowedPurposes));
    setKnowledge(knowledgeData.items);
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

  const saveKnowledge = async (event: FormEvent) => {
    event.preventDefault();
    await api.saveKnowledge(faq);
    setFaq({ category: faq.category, question: "", answer: "", enabled: true });
    await load();
    setNotice("知识库已更新");
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

      <div className="settings-grid">
        <section className="panel">
          <div className="panel-title">新增知识库</div>
          <form className="knowledge-form" onSubmit={saveKnowledge}>
            <label>
              类别
              <select value={faq.category} onChange={(event) => setFaq({ ...faq, category: event.target.value as KnowledgeEntry["category"] })}>
                <option value="party_consultation">党团关系咨询</option>
                <option value="admission_consultation">入学季咨询</option>
              </select>
            </label>
            <label>
              问题
              <input value={faq.question} onChange={(event) => setFaq({ ...faq, question: event.target.value })} />
            </label>
            <label>
              标准答案
              <textarea value={faq.answer} onChange={(event) => setFaq({ ...faq, answer: event.target.value })} />
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={faq.enabled} onChange={(event) => setFaq({ ...faq, enabled: event.target.checked })} />
              启用
            </label>
            <button className="icon-text" type="submit">
              <Save size={17} />
              <span>保存知识</span>
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title">知识库条目</div>
          <ul className="knowledge-list">
            {knowledge.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.question}</strong>
                <span>{entry.category === "party_consultation" ? "党团关系" : "入学季"}</span>
                <p>{entry.answer}</p>
              </li>
            ))}
            {!knowledge.length ? <li>暂无知识库条目</li> : null}
          </ul>
        </section>
      </div>
    </section>
  );
}
