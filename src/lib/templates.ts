import { browser } from "$app/environment";
import { invoke } from "@tauri-apps/api/core";

export type NoteTemplate = {
  id: string;
  name: string;
  title: string;
  content: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
};

type TemplateFile = {
  version: 1;
  templates: Record<string, NoteTemplate>;
};

const customTemplateLimit = 8;

const now = 1;

export const builtInTemplates: NoteTemplate[] = [
  {
    id: "blank",
    name: "空白便签",
    title: "PinNote",
    content: "",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "today-todo",
    name: "今日 TODO",
    title: "今日 TODO",
    content: "# 今日 TODO\n\n- [ ] \n- [ ] \n- [ ] \n\n## 下一步\n\n- ",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "meeting",
    name: "会议记录",
    title: "会议记录",
    content: "# 会议记录\n\n时间：\n参与者：\n\n## 结论\n\n- \n\n## 待办\n\n- [ ] \n\n## 备注\n\n- ",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "ai-prompt",
    name: "AI 提示词",
    title: "AI 提示词",
    content: "# AI 提示词\n\n## 目标\n\n\n## 背景\n\n\n## 约束\n\n- \n\n## 输出格式\n\n- ",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "project-plan",
    name: "项目计划",
    title: "项目计划",
    content: "# 项目计划\n\n## 目标\n\n\n## 当前状态\n\n- \n\n## P0\n\n- [ ] \n\n## P1\n\n- [ ] \n\n## 风险\n\n- ",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "bug-check",
    name: "Bug 排查",
    title: "Bug 排查",
    content: "# Bug 排查\n\n## 现象\n\n\n## 复现步骤\n\n1. \n2. \n3. \n\n## 可能原因\n\n- \n\n## 验证结果\n\n- [ ] ",
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  },
];

export { customTemplateLimit };

export async function loadTemplates() {
  const custom = await loadCustomTemplates();
  return [...builtInTemplates, ...custom];
}

export async function loadCustomTemplates() {
  if (!browser) return [];

  try {
    const raw = await invoke<string | null>("load_templates");
    if (!raw) return [];
    return normalizeTemplateFile(JSON.parse(raw) as Partial<TemplateFile>);
  } catch {
    return [];
  }
}

export async function saveCustomTemplate(template: Omit<NoteTemplate, "builtIn" | "createdAt" | "updatedAt">) {
  const current = await loadCustomTemplates();
  if (!current.some((item) => item.id === template.id) && current.length >= customTemplateLimit) {
    throw new Error(`最多只能保存 ${customTemplateLimit} 个自定义模板`);
  }

  const now = Date.now();
  const existing = current.find((item) => item.id === template.id);
  const next: NoteTemplate = {
    ...template,
    builtIn: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const raw = await invoke<string>("upsert_template", { json: JSON.stringify(next) });
  return normalizeTemplate(JSON.parse(raw) as Partial<NoteTemplate>);
}

export async function deleteCustomTemplate(id: string) {
  await invoke("delete_template", { id });
}

export function createTemplateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTemplateFile(file: Partial<TemplateFile>) {
  return Object.entries(file.templates ?? {})
    .map(([id, template]) => normalizeTemplate({ ...template, id, builtIn: false }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

function normalizeTemplate(template: Partial<NoteTemplate>): NoteTemplate {
  const timestamp = Date.now();
  return {
    id: template.id ?? createTemplateId(),
    name: template.name?.trim() || "未命名模板",
    title: template.title?.trim() || template.name?.trim() || "PinNote",
    content: template.content ?? "",
    builtIn: Boolean(template.builtIn),
    createdAt: template.createdAt ?? timestamp,
    updatedAt: template.updatedAt ?? timestamp,
  };
}
