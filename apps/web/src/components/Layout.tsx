import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Archive, BookOpenText, FileCheck2, Gauge, Inbox, KeyRound, LogOut, MailCheck, NotebookTabs, SlidersHorizontal } from "lucide-react";
import { api } from "../api/client.js";

const navItems = [
  { to: "/", label: "工作台", icon: Gauge },
  { to: "/messages", label: "邮件列表", icon: Inbox },
  { to: "/drafts", label: "回复审核", icon: MailCheck },
  { to: "/forward-records", label: "转发记录", icon: Archive },
  { to: "/scholarship-check", label: "优秀毕业生核对", icon: FileCheck2 },
  { to: "/college-knowledge", label: "书院知识问答", icon: BookOpenText },
  { to: "/settings", label: "配置", icon: SlidersHorizontal }
];

export function Layout({ children, onLoggedOut }: { children: ReactNode; onLoggedOut: () => void }) {
  const navigate = useNavigate();
  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onLoggedOut();
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <NotebookTabs size={22} />
          </div>
          <div>
            <strong>Harmonia</strong>
            <span>祥波书院自动工作流</span>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="security-chip">
            <KeyRound size={16} />
            <span>本地账号</span>
          </div>
          <button className="icon-text danger" type="button" onClick={logout}>
            <LogOut size={17} />
            <span>退出</span>
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
