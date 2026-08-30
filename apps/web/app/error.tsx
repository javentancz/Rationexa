"use client";

import { useEffect } from "react";
import { reportClientError } from "./monitoring";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportClientError(error, { category: "react_error", component: "route-boundary" });
  }, [error]);

  return <main className="fatal-error" role="alert">
    <span>Rationexa</span>
    <h1>This workspace could not finish loading</h1>
    <p>Your saved records were not changed. Try this screen again; if it keeps failing, the incident digest is available in the protected service logs.</p>
    <button type="button" onClick={reset}>Try again</button>
  </main>;
}
