import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

/**
 * CSS has no middle ellipsis; split head and tail without measuring so long virtualized lists stay cheap.
 * Both halves remain real text for selection, copying, and screen readers.
 */
export function MiddleTruncate({
  value,
  tail,
  showTitle = true,
  variant = "default",
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  value: string;
  /** Characters kept at the end. Defaults to the last path segment, capped, or 10. */
  tail?: number;
  /** The full value on hover. Off where a tooltip already carries it. */
  showTitle?: boolean;
  /** Align capital letters with adjacent icons while preserving accents and descenders. */
  variant?: "default" | "cap-aligned";
}) {
  const split = splitForMiddleTruncate(value, tail);
  return (
    <span
      {...(showTitle ? { title: value } : {})}
      className={cn(
        "inline-flex min-w-0 max-w-full overflow-hidden whitespace-nowrap",
        variant === "cap-aligned" &&
          "overflow-x-clip overflow-y-visible [&>span]:[text-box:trim-both_cap_alphabetic] [&>span]:overflow-x-clip [&>span]:overflow-y-visible",
        className,
      )}
      {...props}
    >
      {split ? (
        <>
          <span className="min-w-0 truncate">{split.head}</span>
          <span className="shrink-0">{split.tail}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{value}</span>
      )}
    </span>
  );
}

const DEFAULT_TAIL = 10;
const MAX_SEGMENT_TAIL = 16;

/**
 * Keep a short last path segment, otherwise a fixed tail; skip splitting when too little head would remain
 * before the ellipsis.
 */
export function splitForMiddleTruncate(
  value: string,
  tail?: number,
): { head: string; tail: string } | null {
  // Code points, not UTF-16 units: a cut inside a surrogate pair would render two broken
  // glyphs where an emoji or a CJK extension character used to be.
  const chars = Array.from(value);
  let keep = tail ?? DEFAULT_TAIL;
  if (tail === undefined) {
    const slash = chars.lastIndexOf("/");
    if (slash > 0 && slash < chars.length - 1) {
      const segment = chars.length - slash - 1;
      keep = segment <= MAX_SEGMENT_TAIL ? segment : DEFAULT_TAIL;
    }
  }
  if (keep <= 0 || chars.length <= keep + 4) return null;
  const cut = chars.length - keep;
  return { head: chars.slice(0, cut).join(""), tail: chars.slice(cut).join("") };
}
