import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Loading } from "./components/Loading.js";
import { api } from "./api/client.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DraftReviewPage } from "./pages/DraftReviewPage.js";
import { ForwardRecordsPage } from "./pages/ForwardRecordsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MessageDetailPage } from "./pages/MessageDetailPage.js";
import { MessagesPage } from "./pages/MessagesPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

function RequireAuth({ userKnown }: { userKnown: boolean }) {
  const location = useLocation();
  if (!userKnown) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Layout />;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [userKnown, setUserKnown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((result) => {
        if (!cancelled) setUserKnown(Boolean(result.user));
      })
      .catch(() => {
        if (!cancelled) setUserKnown(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loading label="连接后台" />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage onLoggedIn={() => setUserKnown(true)} />} />
      <Route element={<RequireAuth userKnown={userKnown} />}>
        <Route index element={<DashboardPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:id" element={<MessageDetailPage />} />
        <Route path="/drafts" element={<DraftReviewPage />} />
        <Route path="/forward-records" element={<ForwardRecordsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
