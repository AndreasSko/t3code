import type { File } from "expo-file-system";

let tempFileSequence = 0;

/** Stage each write in its own sibling temp file: interruption cannot truncate the destination or clobber another writer's stage. */
export async function writeFileAtomically(file: File, contents: string): Promise<void> {
  const { File: FileConstructor } = await import("expo-file-system");
  tempFileSequence += 1;
  const temp = new FileConstructor(file.parentDirectory, `${file.name}.${tempFileSequence}.tmp`);
  temp.create({ intermediates: true, overwrite: true });
  await temp.write(contents);
  temp.moveSync(file, { overwrite: true });
}
