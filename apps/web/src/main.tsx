import { StrictMode } from "react";
import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import "@/styles/index.css";
import { Toaster } from "@/components/ui/sonner";

import {
  SQLiteClient,
  SQLiteClientProvider,
} from "@/components/sqlite-client-provider.tsx";

const LandingPage = React.lazy(() => import("@/pages/LandingPage"));
const NotFoundPage = React.lazy(() => import("@/pages/NotFoundPage"));
const ErrorPage = React.lazy(() => import("@/pages/ErrorPage"));
const SurveyPage = React.lazy(() => import("@/pages/SurveyPage"));
const ReportsPage = React.lazy(() => import("@/pages/ReportsPage"));
const MyAssessmentsPage = React.lazy(() => import("@/pages/MyAssessmentsPage"));
const ReviewsPage = React.lazy(() => import("@/pages/ReviewsPage"));
const AssessmentsPage = React.lazy(() => import("@/pages/AssessmentsPage"));
const UsersPage = React.lazy(() => import("@/pages/UsersPage"));
const SetupPage = React.lazy(() => import("@/pages/SetupPage"));
const DocsPage = React.lazy(() => import("@/pages/DocsPage"));

const queryClient = new QueryClient();
const sqliteClient = new SQLiteClient();

const ENV = import.meta.env;
const baseUrl = ENV.VITE_BASE_URL || "/";

const router = createBrowserRouter([
  {
    path: baseUrl,
    element: <LandingPage />,
    errorElement: <ErrorPage />,
    children: [
      { path: baseUrl, element: <SurveyPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}reports`, element: <ReportsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}reports/regions/:regionId`,         element: <ReportsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}reports/facilities/:facilityId`,    element: <ReportsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}reports/departments/:departmentId`, element: <ReportsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}reports/users/:userId`,             element: <ReportsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}my-assessments`, element: <MyAssessmentsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}reviews`, element: <ReviewsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}assessments`, element: <AssessmentsPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}users`, element: <UsersPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}setup`, element: <SetupPage />, errorElement: <ErrorPage /> },
      { path: `${baseUrl}docs`, element: <DocsPage />, errorElement: <ErrorPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SQLiteClientProvider client={sqliteClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {import.meta.env.MODE === "development" && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </SQLiteClientProvider>

    <Toaster
      richColors
      expand={false}
      position="bottom-center"
      className="z-100! pointer-events-auto"
    />
  </StrictMode>,
);
