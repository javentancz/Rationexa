import { Suspense } from "react";

import { ShareView } from "./share-view";

export default function SharedDecisionPage({
  params,
}: {
  params: Promise<{ token: string }>;
   }) {
  return (
     <div className="share-shell">
       <header className="share-header">
         <div className="brand"><span className="brand-mark">R</span><span>Rationexa</span></div>
         <span className="share-badge">Read-only shared record</span>
        </header>
       <Suspense fallback={<div className="share-loading">Loading shared decision…</div>}>
         {params.then(({ token }) => <ShareView token={token} />)}
       </Suspense>
     </div>
    );
   }
