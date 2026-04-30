import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { RoleSelectPage } from "../pages/role-select/RoleSelectPage";
import {
  AdminDashboardPage,
  AdminDoctorTrackingPage,
  AdminTeamCommunicationPage,
  AdminLeaveRequestsPage,
  AdminPatientDetailPage,
  AdminPatientsPage,
  AdminRemindersPage,
  AdminSchedulesPage,
  AdminStaffPage
} from "../pages/admin/AdminPages";
import {
  DoctorLocationPage,
  DoctorLeaveRequestPage,
  DoctorPatientPage,
  DoctorRecordPage,
  DoctorRemindersPage,
  DoctorTeamCommunicationPage,
  DoctorReturnRecordPage,
  DoctorScheduleDetailPage
} from "../pages/doctor/DoctorPages";
import { DemoOverviewPage, DoctorTracePage, MapsOverviewPage } from "../pages/shared/SharedPages";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RoleSelectPage />
  },
  {
    element: <AppShell />,
    children: [
      { path: "/demo-overview", element: <DemoOverviewPage /> },
      { path: "/doctor/navigation", element: <DoctorLocationPage /> },
      { path: "/doctor/location", element: <DoctorLocationPage /> },
      { path: "/doctor/return-records", element: <DoctorReturnRecordPage /> },
      { path: "/doctor/schedules/:id", element: <DoctorScheduleDetailPage /> },
      { path: "/doctor/records/:visitScheduleId", element: <DoctorRecordPage /> },
      { path: "/doctor/patients/:id", element: <DoctorPatientPage /> },
      { path: "/doctor/leave-requests", element: <DoctorLeaveRequestPage /> },
      { path: "/doctor/team-communication", element: <DoctorTeamCommunicationPage /> },
      { path: "/doctor/reminders", element: <DoctorRemindersPage /> },
      { path: "/admin/dashboard", element: <AdminDashboardPage /> },
      { path: "/admin/doctor-tracking", element: <AdminDoctorTrackingPage /> },
      { path: "/admin/team-communication", element: <AdminTeamCommunicationPage /> },
      { path: "/admin/patients", element: <AdminPatientsPage /> },
      { path: "/admin/patients/:id", element: <AdminPatientDetailPage /> },
      { path: "/admin/reminders", element: <AdminRemindersPage /> },
      { path: "/admin/leave-requests", element: <AdminLeaveRequestsPage /> },
      { path: "/admin/schedules", element: <AdminSchedulesPage /> },
      { path: "/admin/staff", element: <AdminStaffPage /> },
      { path: "/maps/overview", element: <MapsOverviewPage /> },
      { path: "/maps/doctor-trace/:doctorId", element: <DoctorTracePage /> }
    ]
  }
]);
