import { renderMarkdown } from "@/lib/markdown";

/**
 * Renders an agent artifact (Markdown) to HTML. The renderer escapes every text
 * node before inline formatting; the content is trusted single-operator output.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}
