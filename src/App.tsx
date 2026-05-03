import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import CourseWizard from "@/pages/CourseWizard";
import CourseView from "@/pages/CourseView";
import Courses from "@/pages/Courses";
import Certificates from "@/pages/Certificates";
import CertificateValidation from "@/pages/CertificateValidation";
import Plans from "@/pages/Plans";
import Analytics from "@/pages/Analytics";
import NotFound from "@/pages/NotFound";
import TutorPublic from "@/pages/TutorPublic";
import CourseLanding from "@/pages/CourseLanding";
import LandingPageEditor from "@/pages/LandingPageEditor";
import ReviewPublic from "@/pages/ReviewPublic";
import PptxDebug from "@/pages/PptxDebug";
import StudentPortal from "@/pages/StudentPortal";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="courses" element={<Courses />} />
                <Route path="courses/new" element={<CourseWizard />} />
                <Route path="courses/:id" element={<CourseView />} />
                <Route path="courses/:id/landing-page" element={<LandingPageEditor />} />
                <Route path="certificates" element={<Certificates />} />
                <Route path="planos" element={<Plans />} />
                <Route path="analytics" element={<Analytics />} />
              </Route>
              <Route path="/certificate/:token" element={<CertificateValidation />} />
              <Route path="/tutor/:slug" element={<TutorPublic />} />
              <Route path="/c/:slug" element={<CourseLanding />} />
              <Route path="/learn/:slug" element={<StudentPortal />} />
              <Route path="/review/:token" element={<ReviewPublic />} />
              <Route path="/pptx-debug" element={<PptxDebug />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
