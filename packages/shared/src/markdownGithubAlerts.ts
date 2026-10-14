/**
 * GitHub alerts are not GFM, so remark-gfm leaves their markers as literal text.
 * A marker must occupy its own line; > [!NOTE] aside remains an ordinary quote.
 */

interface MarkdownAstNode {
  type?: string;
  value?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
}

const GITHUB_ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/i;

function readGithubAlert(node: MarkdownAstNode): void {
  if (node.type !== "blockquote") return;
  const paragraph = node.children?.[0];
  const text = paragraph?.children?.[0];
  if (paragraph?.type !== "paragraph" || text?.type !== "text" || typeof text.value !== "string") {
    return;
  }
  const match = GITHUB_ALERT_MARKER.exec(text.value);
  if (!match?.[1]) return;

  const remainder = text.value.slice(match[0].length);
  // An empty remainder can precede either next-line inline siblings or same-line content;
  // only a newline in this text node distinguishes those cases.
  const markerEndsItsLine = match[0].endsWith("\n");
  if (remainder.length > 0) {
    text.value = remainder;
  } else if (markerEndsItsLine || paragraph.children?.length === 1) {
    paragraph.children?.shift();
    if (paragraph.children?.length === 0) {
      node.children?.shift();
    }
  } else {
    // Something else shares the marker's line — `[!NOTE]*aside*` — which GitHub does not
    // read as an alert.
    return;
  }

  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      dataAlert: match[1].toLowerCase(),
    },
  };
}

export function remarkGithubAlerts() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      node.children?.forEach(visit);
      readGithubAlert(node);
    };
    visit(tree);
  };
}
