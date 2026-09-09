import Link from "next/link";

export function RulesDemoNotice({ review = false }: { review?: boolean }) {
  return (
    <aside className="rules-demo-notice" aria-label={review ? "Generated with rules" : "About the rules demo"}>
      <div>
        <strong>{review ? "Generated with rules · No AI" : "Rules demo · No AI"}</strong>
        <p>
          {review
            ? "Fixed text patterns produced this draft and may repeat whole sentences. Exact source excerpts stay unchanged so you can verify each premise."
            : "This demo uses fixed text patterns and may repeat your original sentences. It demonstrates the review workflow, not AI analysis."}
        </p>
        <p>Connect your own model key for AI-assisted extraction, or use a local model when self-hosting. All results still need your review.</p>
      </div>
      <Link href="/settings">Connect an AI model →</Link>
    </aside>
  );
}
