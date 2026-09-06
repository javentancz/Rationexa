import { Suspense } from "react";
import Link from "next/link";

import { ShareView } from "./share-view";

export default function SharedDecisionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <div className="share-shell">
      <header className="share-header">
        <Link className="brand" href="/" aria-label="Rationexa home">
          <span className="brand-mark">R</span><span>Rationexa</span>
        </Link>
        <span className="share-badge">Read-only shared record</span>
      </header>
      <Suspense fallback={<div className="share-loading">Loading shared decision…</div>}>
        {params.then(({ token }) => <ShareView token={token} />)}
      </Suspense>
    </div>
  );
}
