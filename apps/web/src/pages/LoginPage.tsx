import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogIn, Mail } from "lucide-react";
import { api } from "../api/client.js";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(email, password);
      onLoggedIn();
      const from = typeof location.state === "object" && location.state && "from" in location.state ? String(location.state.from) : "/";
      navigate(from);
    } catch {
      setError("账号或密码不正确");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-symbol">
          <Mail size={30} />
        </div>
        <h1>学院公共邮箱自动化</h1>
        <label>
          账号
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" />
        </label>
        <label>
          密码
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="primary-action" type="submit" disabled={busy}>
          <LogIn size={18} />
          <span>{busy ? "登录中" : "登录"}</span>
        </button>
      </form>
    </main>
  );
}
