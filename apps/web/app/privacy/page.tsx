import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy and data use | Rationexa",
  description: "How the Rationexa public preview handles decision material, accounts, provider keys, analytics, and deletion.",
};

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <nav className="policy-nav" aria-label="Privacy navigation">
        <Link className="landing-brand" href="/" aria-label="Rationexa home"><span>R</span><strong>Rationexa</strong></Link>
        <Link className="landing-secondary" href="/workspace">Open workspace</Link>
      </nav>
      <article className="policy-document">
        <header>
          <span className="landing-eyebrow">Public preview policy</span>
          <h1>Privacy and data use</h1>
          <p>Last updated September 7, 2026</p>
        </header>

        <section>
          <h2>Use staging for evaluation</h2>
          <p>The hosted Rationexa site is an experimental staging preview with no uptime or data-durability guarantee. Do not submit confidential customer data, production secrets, regulated information, or decision material you cannot safely lose.</p>
        </section>

        <section>
          <h2>What is stored</h2>
          <p>Rationexa stores the decision material you submit, extracted candidate premises, human review choices, finalized records, revisit evidence, model provenance, usage metadata, and account information needed to provide the workspace.</p>
          <p>Guest workspaces are isolated through a browser cookie and are scheduled for deletion after 24 hours. Registered workspace data remains until you delete the account or the staging environment is reset during development.</p>
        </section>

        <section>
          <h2>Models and BYOK</h2>
          <p>Deterministic rules run without a model key. If you connect a hosted provider and select one of its models, the relevant source or evidence is sent to that provider under its own terms. Provider keys are encrypted at rest per workspace and are not returned by the API or included in shared records.</p>
          <p>Use a restricted, revocable provider key with a spending limit. Do not reuse a privileged personal or production key in the public preview.</p>
        </section>

        <section>
          <h2>Infrastructure and analytics</h2>
          <p>The preview uses Vercel for web and API hosting, PostgreSQL for workspace storage, an SMTP provider for password-recovery email when configured, and the model provider you explicitly connect. Privacy-filtered web analytics may record page and device-level usage; share-token paths are excluded.</p>
          <p>Operational logs record request metadata such as route, status, duration, and request ID. The application is designed not to log request bodies, cookies, provider keys, reset tokens, or evidence content.</p>
        </section>

        <section>
          <h2>Sharing and deletion</h2>
          <p>Shared links expose only the finalized record fields selected by the product. They expire and can be revoked. They do not include provider credentials, private source artifacts, session metadata, or internal workspace identifiers.</p>
          <p>You can remove a provider connection, revoke a share, delete an individual decision, or permanently delete your registered account and workspace from Account &amp; AI connections.</p>
        </section>

        <section>
          <h2>Questions and security reports</h2>
          <p>For ordinary questions or private security reports, <a href="mailto:javentanzhe@gmail.com?subject=Rationexa%20support">contact the maintainer</a>. Once the repository is public, its support and security guides provide the community reporting paths.</p>
        </section>
      </article>
    </main>
  );
}
