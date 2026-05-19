import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { RouteErrorFallback } from "./RouteErrorFallback";
import { RoleSelectPage } from "../pages/role-select/RoleSelectPage";

const AdminDashboardPage = lazy(() =>
  import("../pages/admin/AdminDashboardAndPatientPages").then((module) => ({
    default: module.AdminDashboardPage
  }))
);
const AdminDoctorTrackingPage = lazy(() =>
  import("../pages/admin/AdminDashboardAndPatientPages").then((module) => ({
    default: module.AdminDoctorTrackingPage
  }))
);
const AdminFamilyLinePage = lazy(() =>
  import("../pages/admin/AdminFamilyLinePage").then((module) => ({ default: module.AdminFamilyLinePage }))
);
const AdminTeamCommunicationPage = lazy(() =>
  import("../pages/admin/AdminCommunicationPage").then((module) => ({
    default: module.AdminTeamCommunicationPage
  }))
);
const AdminLeaveRequestsPage = lazy(() =>
  import("../pages/admin/AdminScheduleAndContactsPages").then((module) => ({
    default: module.AdminLeaveRequestsPage
  }))
);
const AdminPatientDetailPage = lazy(() =>
  import("../pages/admin/AdminDashboardAndPatientPages").then((module) => ({
    default: module.AdminPatientDetailPage
  }))
);
const AdminPatientsPage = lazy(() =>
  import("../pages/admin/AdminDashboardAndPatientPages").then((module) => ({
    default: module.AdminPatientsPage
  }))
);
const AdminRemindersPage = lazy(() =>
  import("../pages/admin/AdminScheduleAndContactsPages").then((module) => ({
    default: module.AdminRemindersPage
  }))
);
const AdminSchedulesPage = lazy(() =>
  import("../pages/admin/AdminScheduleAndContactsPages").then((module) => ({
    default: module.AdminSchedulesPage
  }))
);
const AdminStaffPage = lazy(() =>
  import("../pages/admin/AdminNotificationAndStaffPages").then((module) => ({
    default: module.AdminStaffPage
  }))
);
const DoctorLocationPage = lazy(() =>
  import("../pages/doctor/DoctorDashboardAndSchedulePages").then((module) => ({
    default: module.DoctorLocationPage
  }))
);
const DoctorLeaveRequestPage = lazy(() =>
  import("../pages/doctor/DoctorPatientAndReminderPages").then((module) => ({
    default: module.DoctorLeaveRequestPage
  }))
);
const DoctorLineQrPage = lazy(() =>
  import("../pages/doctor/DoctorLineQrPage").then((module) => ({ default: module.DoctorLineQrPage }))
);
const DoctorPatientPage = lazy(() =>
  import("../pages/doctor/DoctorPatientPage").then((module) => ({ default: module.DoctorPatientPage }))
);
const DoctorRecordPage = lazy(() =>
  import("../pages/doctor/DoctorRecordPage").then((module) => ({ default: module.DoctorRecordPage }))
);
const DoctorRemindersPage = lazy(() =>
  import("../pages/doctor/DoctorPatientAndReminderPages").then((module) => ({
    default: module.DoctorRemindersPage
  }))
);
const DoctorTeamCommunicationPage = lazy(() =>
  import("../pages/doctor/DoctorCommunicationPage").then((module) => ({
    default: module.DoctorTeamCommunicationPage
  }))
);
const DoctorReturnRecordPage = lazy(() =>
  import("../pages/doctor/DoctorReturnRecordPage").then((module) => ({
    default: module.DoctorReturnRecordPage
  }))
);
const DoctorScheduleDetailPage = lazy(() =>
  import("../pages/doctor/DoctorDashboardAndSchedulePages").then((module) => ({
    default: module.DoctorScheduleDetailPage
  }))
);
const DemoOverviewPage = lazy(() =>
  import("../pages/shared/SharedPages").then((module) => ({ default: module.DemoOverviewPage }))
);
const DoctorTracePage = lazy(() =>
  import("../pages/shared/SharedPages").then((module) => ({ default: module.DoctorTracePage }))
);
const MapsOverviewPage = lazy(() =>
  import("../pages/shared/SharedPages").then((module) => ({ default: module.MapsOverviewPage }))
);

function page(element: ReactNode) {
  return <Suspense fallback={null}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RoleSelectPage />,
    errorElement: <RouteErrorFallback />
  },
  {
    element: <AppShell />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: "/demo-overview", element: page(<DemoOverviewPage />) },
      { path: "/doctor/navigation", element: page(<DoctorLocationPage />) },
      { path: "/doctor/location", element: page(<DoctorLocationPage />) },
      { path: "/doctor/line-qr", element: page(<DoctorLineQrPage />) },
      { path: "/doctor/return-records", element: page(<DoctorReturnRecordPage />) },
      { path: "/doctor/schedules/:id", element: page(<DoctorScheduleDetailPage />) },
      { path: "/doctor/records/:visitScheduleId", element: page(<DoctorRecordPage />) },
      { path: "/doctor/patients/:id", element: page(<DoctorPatientPage />) },
      { path: "/doctor/leave-requests", element: page(<DoctorLeaveRequestPage />) },
      { path: "/doctor/team-communication", element: page(<DoctorTeamCommunicationPage />) },
      { path: "/doctor/reminders", element: page(<DoctorRemindersPage />) },
      { path: "/admin/dashboard", element: page(<AdminDashboardPage />) },
      { path: "/admin/doctor-tracking", element: page(<AdminDoctorTrackingPage />) },
      { path: "/admin/team-communication", element: page(<AdminTeamCommunicationPage />) },
      { path: "/admin/family-line", element: page(<AdminFamilyLinePage />) },
      { path: "/admin/patients", element: page(<AdminPatientsPage />) },
      { path: "/admin/patients/:id", element: page(<AdminPatientDetailPage />) },
      { path: "/admin/reminders", element: page(<AdminRemindersPage />) },
      { path: "/admin/leave-requests", element: page(<AdminLeaveRequestsPage />) },
      { path: "/admin/schedules", element: page(<AdminSchedulesPage />) },
      { path: "/admin/staff", element: page(<AdminStaffPage />) },
      { path: "/maps/overview", element: page(<MapsOverviewPage />) },
      { path: "/maps/doctor-trace/:doctorId", element: page(<DoctorTracePage />) }
    ]
  }
]);
