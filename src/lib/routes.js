
// Central route constants — change a path here; it updates everywhere.
// Import wherever you navigate() or use programmatic paths.
export const ROUTES = {
  LOGIN:           '/login',
  REGISTER:        '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD:  '/reset-password',
  CHECK_EMAIL:     '/check-email',
  AUTH_CALLBACK:   '/auth/callback',
  HOME:            '/',
  WAITING_APPROVAL:'/waiting-approval',
  LEADERBOARD:     '/leaderboard',

  TEACHER: {
    ONBOARDING:         '/teacher/onboarding',
    DASHBOARD:          '/teacher/dashboard',
    QR_GENERATOR:       '/teacher/qr-generator',
    MISSIONS:           '/teacher/missions',
    REWARDS:            '/teacher/rewards',
    SETTINGS:           '/teacher/settings',
    STUDENT_MANAGEMENT: '/teacher/student-management',
    ANNOUNCEMENTS:      '/teacher/announcements',
    ANALYTICS:          '/teacher/analytics',
    ROSTER:             '/teacher/roster',
    ACTIVITY_LOGS:      '/teacher/activity-logs',
    EVIDENCE:            '/teacher/evidence',
    MISSION_ARCHIVE:    '/teacher/mission-archive',
    SCORE_IMPORT:       '/teacher/score-import',
    ACTIVITIES:         '/teacher/activities',
    EXPORT_DATA:        '/teacher/export-data',
    HELP_GUIDE:         '/teacher/help-guide',
    BADGES:             '/teacher/badges',
  },

  STUDENT: {
    ONBOARDING: '/student/onboarding',
    DASHBOARD:  '/student/dashboard',
    ATTENDANCE: '/student/attendance',
    SCORES:     '/student/scores',
    SCAN:       '/student/scan',
    BADGES:     '/student/badges',
    MISSIONS:   '/student/missions',
    REWARDS:    '/student/rewards',
    HELP:       '/student/help',
    LEADERBOARD:'/student/leaderboard',
  },
};
