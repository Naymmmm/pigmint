import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./routes/Landing";
import Gallery from "./routes/Gallery";
import GenerationDetail from "./routes/GenerationDetail";
import Assistant from "./routes/Assistant";
import Billing from "./routes/Billing";
import Legal from "./routes/Legal";
import AppShell from "./components/AppShell";
import { useMe } from "./lib/api";

function Protected({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useMe();
  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!data) {
    window.location.href = "/api/auth/login";
    return null;
  }
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/terms" element={<Legal slug="terms" />} />
      <Route path="/privacy" element={<Legal slug="privacy" />} />
      <Route path="/gallery" element={<Protected><Gallery /></Protected>} />
      <Route path="/generation/:id" element={<Protected><GenerationDetail /></Protected>} />
      <Route path="/assistant" element={<Protected><Assistant /></Protected>} />
      <Route path="/settings/billing" element={<Protected><Billing /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
