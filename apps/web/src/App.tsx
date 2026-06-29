import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Loading } from "./components/Loading.js";
import { api } from "./api/client.js";
import { CollegeKnowledgePage } from "./pages/CollegeKnowledgePage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DraftReviewPage } from "./pages/DraftReviewPage.js";
import { ForwardRecordsPage } from "./pages/ForwardRecordsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MessageAgentPage } from "./pages/MessageAgentPage.js";
import { MessageDetailPage } from "./pages/MessageDetailPage.js";
import { MessagesPage } from "./pages/MessagesPage.js";
import { ScholarshipCheckPage } from "./pages/ScholarshipCheckPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

const keptPages = [
  { path: "/", element: <DashboardPage /> },
  { path: "/messages", element: <MessagesPage /> },
  { path: "/drafts", element: <DraftReviewPage /> },
  { path: "/forward-records", element: <ForwardRecordsPage /> },
  { path: "/scholarship-check", element: <ScholarshipCheckPage /> },
  { path: "/college-knowledge", element: <CollegeKnowledgePage /> },
  { path: "/message-agent", element: <MessageAgentPage /> },
  { path: "/settings", element: <SettingsPage /> }
] as const;

function keepAlivePath(pathname: string): (typeof keptPages)[number]["path"] | null {
  return keptPages.some((page) => page.path === pathname) ? (pathname as (typeof keptPages)[number]["path"]) : null;
}

function ProtectedContent() {
  const location = useLocation();
  const activePath = keepAlivePath(location.pathname);
  const [visitedPaths, setVisitedPaths] = useState<Set<(typeof keptPages)[number]["path"]>>(() => new Set(activePath ? [activePath] : []));

  useEffect(() => {
    if (!activePath) return;
    setVisitedPaths((previous) => {
      if (previous.has(activePath)) return previous;
      const next = new Set(previous);
      next.add(activePath);
      return next;
    });
  }, [activePath]);

  if (activePath) {
    return (
      <>
        {keptPages.map((page) =>
          visitedPaths.has(page.path) ? (
            <div key={page.path} hidden={page.path !== activePath}>
              {page.element}
            </div>
          ) : null
        )}
      </>
    );
  }

  return (
    <Routes>
      <Route path="/messages/:id" element={<MessageDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireAuth({ userKnown, onLoggedOut }: { userKnown: boolean; onLoggedOut: () => void }) {
  const location = useLocation();
  if (!userKnown) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return (
    <Layout onLoggedOut={onLoggedOut}>
      <ProtectedContent />
    </Layout>
  );
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
      <Route path="/*" element={<RequireAuth userKnown={userKnown} onLoggedOut={() => setUserKnown(false)} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
