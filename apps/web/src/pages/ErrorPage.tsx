import { Button } from "@/components/ui/button";
import { useNavigate, useRouteError, isRouteErrorResponse } from "react-router-dom";
import logoImage from "@/assets/OpenODRv2Logo.png";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = "Something went wrong";
  let description = "An unexpected error occurred. Please try again.";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    description = error.data?.message ?? description;
  } else if (error instanceof Error) {
    if (error.message.includes("Failed to fetch dynamically imported module")) {
      title = "Failed to load page";
      description =
        "The application couldn't load this page. This may be due to a network issue or a new deployment. Try refreshing.";
    } else {
      description = error.message;
    }
  }

  return (
    <div className="flex w-full h-full items-center justify-center">
      <div className="relative flex w-full h-screen items-center">
        {/* Grid background — matches NotFoundPage */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right,rgba(214, 251, 252, 0.06) 1px,transparent 1px),linear-gradient(to bottom,rgba(214, 251, 252, 0.06) 1px,transparent 1px)",
            maskImage:
              "radial-gradient(ellipse 50% 70% at 50% 0%,#000 70%,transparent 110%)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="container relative z-1 flex flex-col items-center justify-center text-center">
          {/* Logo */}
          <div className="flex flex-row mb-8">
            <div className="w-5.5 overflow-hidden">
              <img
                src={logoImage}
                alt="labworkforce"
                className="h-6 object-cover object-left logo"
              />
            </div>
            <div className="ml-2 mt-0.5">LabWorkforce</div>
          </div>

          {/* Icon */}
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-8 w-8" />
          </div>

          {/* Text */}
          <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            {description}
          </p>

          {/* Actions */}
          <div className="mt-8 flex items-center gap-3">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go back
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload page
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ErrorPage;
