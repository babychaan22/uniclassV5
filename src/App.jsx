
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import { ROUTES } from '@/lib/routes';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Landing = lazy(() => import('./pages/Landing'));
const Layout = lazy(() => import('@/components/Layout'));
const WaitingApproval = lazy(() => import('./pages/WaitingApproval'));
const TeacherOnboarding = lazy(() => import('./pages/teacher/Onboarding'));
const TeacherDashboard = lazy(() => import('./pages/teacher/Dashboard'));
const TeacherQRGenerator = lazy(() => import('./pages/teacher/QRGenerator'));
const TeacherMissions = lazy(() => import('./pages/teacher/Missions'));
const TeacherRewards = lazy(() => import('./pages/teacher/Rewards'));
const TeacherSettings = lazy(() => import('./pages/teacher/Settings'));
const TeacherStudentManagement = lazy(() => import('./pages/teacher/StudentManagement'));
const TeacherAnnouncements = lazy(() => import('./pages/teacher/Announcements'));
const TeacherAnalytics = lazy(() => import('./pages/teacher/Analytics'));
const TeacherScoreImport = lazy(() => import('./pages/teacher/ScoreImport'));
const TeacherActivities = lazy(() => import('./pages/teacher/Activities'));
const TeacherAttendance = lazy(() => import('./pages/teacher/Attendance'));
const TeacherRoster = lazy(() => import('./pages/teacher/Roster'));
const TeacherActivityLogs = lazy(() => import('./pages/teacher/ActivityLogs'));
const TeacherEvidence = lazy(() => import('./pages/teacher/Evidence'));
const TeacherMissionArchive = lazy(() => import('./pages/teacher/MissionArchive'));
const TeacherHelpGuide = lazy(() => import('./pages/teacher/HelpGuide'));
const TeacherExportData = lazy(() => import('./pages/teacher/ExportData'));
const StudentOnboarding = lazy(() => import('./pages/student/Onboarding'));
const StudentDashboard = lazy(() => import('./pages/student/Dashboard'));
const StudentAttendance = lazy(() => import('./pages/student/Attendance'));
const StudentScores = lazy(() => import('./pages/student/Scores'));
const StudentScan = lazy(() => import('./pages/student/Scan'));
const StudentBadges = lazy(() => import('./pages/student/Badges'));
const TeacherBadges = lazy(() => import('./pages/teacher/Badges'));
const StudentMissions = lazy(() => import('./pages/student/Missions'));
const StudentRewards = lazy(() => import('./pages/student/Rewards'));
const StudentHelp = lazy(() => import('./pages/student/Help'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const CheckEmail = lazy(() => import('./pages/CheckEmail'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const StudentLeaderboard = lazy(() => import('./pages/student/Leaderboard'));

const PageLoader = () => <div className="fixed inset-0 flex items-center justify-center bg-cream"><div className="w-8 h-8 border-4 border-clay-purple/30 border-t-clay-purple rounded-full animate-spin" /></div>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-cream">
        <div className="w-8 h-8 border-4 border-clay-purple/30 border-t-clay-purple rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Suspense fallback={<PageLoader />}><Routes>
      <Route path={ROUTES.LOGIN} element={<Login />} />
      <Route path={ROUTES.REGISTER} element={<Register />} />
      <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPassword />} />
      <Route path={ROUTES.RESET_PASSWORD} element={<ResetPassword />} />

      <Route path={ROUTES.CHECK_EMAIL} element={<CheckEmail />} />

       {/* Public landing page — accessible to everyone */}
      <Route path={ROUTES.HOME} element={<Landing />} />
      <Route path={ROUTES.AUTH_CALLBACK} element={<AuthCallback />} />

      {/* Protected routes — require authentication */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to={ROUTES.LOGIN} replace />} />}>
        <Route element={<Layout />}>
          <Route path={ROUTES.WAITING_APPROVAL} element={<WaitingApproval />} />
          <Route path={ROUTES.TEACHER.ONBOARDING} element={<TeacherOnboarding />} />
          <Route path={ROUTES.TEACHER.DASHBOARD} element={<TeacherDashboard />} />
          <Route path={ROUTES.TEACHER.QR_GENERATOR} element={<TeacherQRGenerator />} />
          <Route path={ROUTES.TEACHER.MISSIONS} element={<TeacherMissions />} />
          <Route path={ROUTES.TEACHER.REWARDS} element={<TeacherRewards />} />
          <Route path={ROUTES.TEACHER.SETTINGS} element={<TeacherSettings />} />
          <Route path={ROUTES.TEACHER.STUDENT_MANAGEMENT} element={<TeacherStudentManagement />} />
          <Route path={ROUTES.TEACHER.ANNOUNCEMENTS} element={<TeacherAnnouncements />} />
          <Route path={ROUTES.TEACHER.ANALYTICS} element={<TeacherAnalytics />} />
          <Route path={ROUTES.TEACHER.ROSTER} element={<TeacherRoster />} />
          <Route path={ROUTES.TEACHER.ACTIVITY_LOGS} element={<TeacherActivityLogs />} />
          <Route path={ROUTES.TEACHER.EVIDENCE} element={<TeacherEvidence />} />
          <Route path={ROUTES.TEACHER.MISSION_ARCHIVE} element={<TeacherMissionArchive />} />
          <Route path={ROUTES.TEACHER.SCORE_IMPORT} element={<TeacherScoreImport />} />
          <Route path={ROUTES.TEACHER.ACTIVITIES} element={<TeacherActivities />} />
          <Route path={ROUTES.TEACHER.ATTENDANCE} element={<TeacherAttendance />} />
          <Route path={ROUTES.TEACHER.EXPORT_DATA} element={<TeacherExportData />} />
          <Route path={ROUTES.TEACHER.HELP_GUIDE} element={<TeacherHelpGuide />} />
          <Route path={ROUTES.LEADERBOARD} element={<Leaderboard />} />
          <Route path={ROUTES.STUDENT.ONBOARDING} element={<StudentOnboarding />} />
          <Route path={ROUTES.STUDENT.DASHBOARD} element={<StudentDashboard />} />
          <Route path={ROUTES.STUDENT.ATTENDANCE} element={<StudentAttendance />} />
          <Route path={ROUTES.STUDENT.SCORES} element={<StudentScores />} />
          <Route path={ROUTES.STUDENT.SCAN} element={<StudentScan />} />
          <Route path={ROUTES.STUDENT.BADGES} element={<StudentBadges />} />
          <Route path={ROUTES.TEACHER.BADGES} element={<TeacherBadges />} />
          <Route path={ROUTES.STUDENT.MISSIONS} element={<StudentMissions />} />
          <Route path={ROUTES.STUDENT.REWARDS} element={<StudentRewards />} />
          <Route path={ROUTES.STUDENT.HELP} element={<StudentHelp />} />
          <Route path={ROUTES.STUDENT.LEADERBOARD} element={<StudentLeaderboard />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes></Suspense>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
