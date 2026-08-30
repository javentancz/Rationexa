"use client";

import { useEffect } from "react";
import { reportClientError } from "./monitoring";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportClientError(error, { category: "react_error", component: "root-boundary" });
  }, [error]);

  return <html lang="en"><body><main className="fatal-error" role="alert">
    <span>Rationexa</span>
    <h1>Something interrupted the application</h1>
    <p>Your decision data remains in the private workspace. Retry the application to continue.</p>
    <button type="button" onClick={reset}>Reload Rationexa</button>
  </main></body></html>;
}
