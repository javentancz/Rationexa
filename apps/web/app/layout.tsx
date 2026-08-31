import type { Metadata } from "next";
import Script from "next/script";
import "./styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Rationexa — Human-reviewed decision memory",
  description: "Preserve why decisions were made, map new evidence to their assumptions, and keep human judgment in control.",
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const bootstrapUrl = `${apiUrl.replace(/\/$/, "")}/v1/bootstrap`;
const apiOrigin = /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : null;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {apiOrigin ? <link rel="preconnect" href={apiOrigin} crossOrigin="use-credentials" /> : null}
        {apiOrigin ? <link rel="dns-prefetch" href={apiOrigin} /> : null}
      </head>
      <body>
        <Script id="rationexa-bootstrap-preload" strategy="beforeInteractive">
          {`if(/^\/(workspace|library|usage|settings)(\/|$)/.test(location.pathname)){let token;try{token=sessionStorage.getItem("rationexa-session-token")||localStorage.getItem("rationexa-session-token")}catch{}const headers=token?{Authorization:"Bearer "+token}:undefined;window.__rationexaBootstrapPromise=fetch(${JSON.stringify(bootstrapUrl)},{credentials:"include",cache:"no-store",headers})}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
