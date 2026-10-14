"use client";

import { useCommitOnBlur } from "~/hooks/useCommitOnBlur";
import { Input, type InputProps } from "./input";

export type DraftInputProps = Omit<InputProps, "value" | "onChange" | "defaultValue"> & {
  readonly value: string;
  readonly onCommit: (next: string) => void;
};

/** Buffer until blur or Enter to avoid settings-wide rerenders and server RPCs on every keystroke. */
export function DraftInput({ value, onCommit, ...rest }: DraftInputProps) {
  const bag = useCommitOnBlur(value, onCommit);
  return <Input {...rest} {...bag} />;
}
