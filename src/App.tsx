import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./routes/Landing";

const Gallery = lazy(() => import("./routes/Gallery"));
const GenerationDetail = lazy(() => import("./routes/GenerationDetail"));
const Assistant = lazy(() => import("./routes/Assistant"));
const Billing = lazy(() => import("./routes/Billing"));
const Legal = lazy(() => import("./routes/Legal"));
const ProtectedRoute = lazy(() => import("./routes/ProtectedRoute"));

function RouteFallback() {
  return <div className="p-8 text-muted-foreground">Loading...</div>;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/terms" element={<Legal slug="terms" />} />
        <Route path="/privacy" element={<Legal slug="privacy" />} />
        <Route path="/gallery" element={<ProtectedRoute><Gallery /></ProtectedRoute>} />
        <Route path="/generation/:id" element={<ProtectedRoute><GenerationDetail /></ProtectedRoute>} />
        <Route path="/assistant" element={<ProtectedRoute><Assistant /></ProtectedRoute>} />
        <Route path="/settings/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
