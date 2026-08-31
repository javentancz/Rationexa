import type { Metadata } from "next";
import Script from "next/script";
import "./styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Rationexa",
  description: "Technical decision review intelligence",
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
          {`if(!location.pathname.startsWith("/share/")&&!location.pathname.startsWith("/account/")){let token;try{token=sessionStorage.getItem("rationexa-session-token")||localStorage.getItem("rationexa-session-token")}catch{}const headers=token?{Authorization:"Bearer "+token}:undefined;window.__rationexaBootstrapPromise=fetch(${JSON.stringify(bootstrapUrl)},{credentials:"include",cache:"no-store",headers})}`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
