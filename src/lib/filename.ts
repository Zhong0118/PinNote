export function defaultMarkdownFilename(title: string) {
  const safeTitle = sanitizeFilename(title || "untitled");
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "_",
    safeTitle,
    ".md",
  ].join("");
}

export function sanitizeFilename(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "untitled"
  );
}
