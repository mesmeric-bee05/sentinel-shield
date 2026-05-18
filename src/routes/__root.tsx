import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-serif text-7xl text-primary">404</div>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That route isn't part of the ApexCare AI platform.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
          >
            Return home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "description", content: "ApexCare AI unifies scheduling, telemedicine, clinical AI, and Zero-Trust security into one platform for patients, providers, and health systems." },
      { name: "author", content: "ApexCare AI" },
      { property: "og:title", content: "ApexCare AI — The AI-Powered Healthcare Operating System" },
      { property: "og:description", content: "ApexCare AI unifies scheduling, telemedicine, clinical AI, and Zero-Trust security into a single intelligent platform for patients, providers, and health systems." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "ApexCare AI — The AI-Powered Healthcare Operating System" },
      { name: "twitter:description", content: "ApexCare AI unifies scheduling, telemedicine, clinical AI, and Zero-Trust security into a single intelligent platform for patients, providers, and health systems." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5aba8e04-c0fa-4289-8ed5-19a715e596db/id-preview-d090e13a--c36b93f8-430e-4f64-915c-449bf3d6eac3.lovable.app-1778065172870.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5aba8e04-c0fa-4289-8ed5-19a715e596db/id-preview-d090e13a--c36b93f8-430e-4f64-915c-449bf3d6eac3.lovable.app-1778065172870.png" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: () => <AuthProvider><Outlet /></AuthProvider>,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}
