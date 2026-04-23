import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./routes/Landing";
import Legal from "./routes/Legal";
import ProtectedRoute from "./routes/ProtectedRoute";

const Gallery = lazy(() => import("./routes/Gallery"));
const GenerationDetail = lazy(() => import("./routes/GenerationDetail"));
const Assistant = lazy(() => import("./routes/Assistant"));
const Billing = lazy(() => import("./routes/Billing"));
const Compare = lazy(() => import("./routes/Compare"));
const ComparisonDetail = lazy(() => import("./routes/ComparisonDetail"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/terms" element={<Legal slug="terms" />} />
      <Route path="/privacy" element={<Legal slug="privacy" />} />
      <Route path="/gallery" element={<ProtectedRoute><Gallery /></ProtectedRoute>} />
      <Route path="/generation/:id" element={<ProtectedRoute><GenerationDetail /></ProtectedRoute>} />
      <Route path="/assistant" element={<ProtectedRoute><Assistant /></ProtectedRoute>} />
      <Route path="/settings/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
      <Route path="/compare" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
      <Route path="/compare/:id" element={<ProtectedRoute><ComparisonDetail /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
