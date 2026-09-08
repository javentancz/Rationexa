import type { Metadata } from "next";
import Script from "next/script";
import "./styles.css";
import { Providers } from "./providers";
import { WebAnalytics } from "./web-analytics";

export const metadata: Metadata = {
  title: "Rationexa | Human-reviewed decision memory",
  description: "Preserve why decisions were made, map new evidence to their assumptions, and keep human judgment in control.",
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const bootstrapUrl = `${apiUrl.replace(/\/$/, "")}/v1/bootstrap`;
const apiOrigin = /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : null;
const workspacePaths = ["/workspace", "/library", "/usage", "/settings"];
const bootstrapCacheKey = "rationexa-refresh-v1:workspace-bootstrap";
const bootstrapFreshnessMs = 5 * 60_000;
const bootstrapPreloadScript = `{const path=location.pathname;if(${JSON.stringify(workspacePaths)}.some(route=>path===route||path.startsWith(route+"/"))){let token;let fresh=false;try{token=sessionStorage.getItem("rationexa-session-token")||localStorage.getItem("rationexa-session-token");const cached=JSON.parse(sessionStorage.getItem(${JSON.stringify(bootstrapCacheKey)})||"null");fresh=Boolean(cached&&typeof cached.savedAt==="number"&&Date.now()-cached.savedAt<${bootstrapFreshnessMs})}catch{}if(!fresh){const headers=token?{Authorization:"Bearer "+token}:undefined;window.__rationexaBootstrapPromise=fetch(${JSON.stringify(bootstrapUrl)},{credentials:"include",cache:"no-store",headers})}}}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {apiOrigin ? <link rel="preconnect" href={apiOrigin} crossOrigin="use-credentials" /> : null}
        {apiOrigin ? <link rel="dns-prefetch" href={apiOrigin} /> : null}
      </head>
      <body>
        <Script id="rationexa-bootstrap-preload" strategy="beforeInteractive">
          {bootstrapPreloadScript}
        </Script>
        <Providers>{children}</Providers>
        <WebAnalytics />
      </body>
    </html>
  );
}
