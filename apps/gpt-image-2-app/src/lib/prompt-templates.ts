export type PromptTemplateScope = "common" | "generate" | "edit" | "region";

export type PromptTemplateGroup = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PromptTemplate = {
  id: string;
  groupId: string;
  title: string;
  prompt: string;
  scope: PromptTemplateScope;
  createdAt: number;
  updatedAt: number;
  usedAt?: number;
};

export type PromptTemplateState = {
  version: 1;
  groups: PromptTemplateGroup[];
  templates: PromptTemplate[];
};

export type PromptInsertResult = {
  value: string;
  cursor: number;
};

const STORAGE_KEY = "gpt2.promptTemplates";
export const PROMPT_TEMPLATES_EVENT = "gpt2:promptTemplates";

export const PROMPT_SCOPE_LABEL: Record<PromptTemplateScope, string> = {
  common: "通用",
  generate: "生成",
  edit: "编辑",
  region: "局部编辑",
};

const DEFAULT_GROUP_ID = "sample-group";
const DEFAULT_NOW = 1_700_000_000_000;

function uid(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newPromptTemplateGroup(name = "新分组"): PromptTemplateGroup {
  const now = Date.now();
  return {
    id: uid("group"),
    name,
    createdAt: now,
    updatedAt: now,
  };
}

export function newPromptTemplate(
  groupId: string,
  scope: PromptTemplateScope = "common",
): PromptTemplate {
  const now = Date.now();
  return {
    id: uid("template"),
    groupId,
    title: "新模板",
    prompt: "",
    scope,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultPromptTemplateState(): PromptTemplateState {
  return {
    version: 1,
    groups: [
      {
        id: DEFAULT_GROUP_ID,
        name: "示例",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
    ],
    templates: [
      {
        id: "sample-product-photo",
        groupId: DEFAULT_GROUP_ID,
        title: "产品摄影",
        prompt: "产品摄影：主体清晰的产品，纯白背景，柔光，居中构图，高清细节",
        scope: "generate",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
      {
        id: "sample-edit-polish",
        groupId: DEFAULT_GROUP_ID,
        title: "局部精修",
        prompt: "保持整体风格不变，只优化选区细节，让材质更自然、边缘更干净。",
        scope: "region",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
      {
        id: "sample-style-note",
        groupId: DEFAULT_GROUP_ID,
        title: "通用质感",
        prompt: "电影级光线，真实材质，清晰层次，避免过度锐化。",
        scope: "common",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
    ],
  };
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readTime(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isPromptTemplateScope(
  value: unknown,
): value is PromptTemplateScope {
  return (
    value === "common" ||
    value === "generate" ||
    value === "edit" ||
    value === "region"
  );
}

export function normalizePromptTemplateState(
  value: unknown,
): PromptTemplateState {
  const now = Date.now();
  if (!value || typeof value !== "object") {
    return defaultPromptTemplateState();
  }
  const input = value as Partial<PromptTemplateState>;
  const groups = Array.isArray(input.groups)
    ? input.groups
        .map((group, index): PromptTemplateGroup | null => {
          if (!group || typeof group !== "object") return null;
          const raw = group as Partial<PromptTemplateGroup>;
          const id = readString(raw.id, `group-${index}`);
          return {
            id,
            name: readString(raw.name, "未命名分组"),
            createdAt: readTime(raw.createdAt, now),
            updatedAt: readTime(raw.updatedAt, now),
          };
        })
        .filter((group): group is PromptTemplateGroup => Boolean(group))
    : [];
  const dedupedGroups = groups.filter(
    (group, index, all) =>
      all.findIndex((item) => item.id === group.id) === index,
  );
  const hasInputTemplates =
    Array.isArray(input.templates) && input.templates.length > 0;
  const fallbackGroup =
    dedupedGroups[0] ??
    (hasInputTemplates ? newPromptTemplateGroup("默认") : null);
  const groupIds = new Set(dedupedGroups.map((group) => group.id));
  if (dedupedGroups.length === 0 && fallbackGroup) {
    dedupedGroups.push(fallbackGroup);
    groupIds.add(fallbackGroup.id);
  }
  const templates = Array.isArray(input.templates)
    ? input.templates
        .map((template, index): PromptTemplate | null => {
          if (!template || typeof template !== "object") return null;
          const raw = template as Partial<PromptTemplate>;
          const scope = isPromptTemplateScope(raw.scope) ? raw.scope : "common";
          const groupId =
            typeof raw.groupId === "string" && groupIds.has(raw.groupId)
              ? raw.groupId
              : fallbackGroup?.id;
          if (!groupId) return null;
          return {
            id: readString(raw.id, `template-${index}`),
            groupId,
            title: readString(raw.title, "未命名模板"),
            prompt: typeof raw.prompt === "string" ? raw.prompt : "",
            scope,
            createdAt: readTime(raw.createdAt, now),
            updatedAt: readTime(raw.updatedAt, now),
            usedAt: readTime(raw.usedAt, 0) || undefined,
          };
        })
        .filter((template): template is PromptTemplate => Boolean(template))
    : [];
  return {
    version: 1,
    groups: dedupedGroups,
    templates: templates.filter(
      (template, index, all) =>
        all.findIndex((item) => item.id === template.id) === index,
    ),
  };
}

export function loadPromptTemplates(): PromptTemplateState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPromptTemplateState();
    return normalizePromptTemplateState(JSON.parse(raw));
  } catch {
    return defaultPromptTemplateState();
  }
}

export function savePromptTemplates(state: PromptTemplateState) {
  const normalized = normalizePromptTemplateState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(PROMPT_TEMPLATES_EVENT));
  return normalized;
}

export function exportPromptTemplates(state: PromptTemplateState) {
  return JSON.stringify(normalizePromptTemplateState(state), null, 2);
}

export function importPromptTemplates(json: string): PromptTemplateState {
  return normalizePromptTemplateState(JSON.parse(json));
}

export function promptTemplateMatchesScope(
  templateScope: PromptTemplateScope,
  currentScope: PromptTemplateScope,
) {
  if (templateScope === "common" || templateScope === currentScope) return true;
  return currentScope === "region" && templateScope === "edit";
}

export function visiblePromptTemplatesForScope(
  state: PromptTemplateState,
  scope: PromptTemplateScope,
) {
  return state.templates
    .filter((template) => promptTemplateMatchesScope(template.scope, scope))
    .slice()
    .sort((a, b) => {
      const used = (b.usedAt ?? 0) - (a.usedAt ?? 0);
      if (used !== 0) return used;
      return b.updatedAt - a.updatedAt;
    });
}

export function insertPromptAtCursor(
  value: string,
  insert: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): PromptInsertResult {
  const start =
    typeof selectionStart === "number"
      ? Math.max(0, selectionStart)
      : value.length;
  const end =
    typeof selectionEnd === "number" ? Math.max(start, selectionEnd) : start;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return {
    value: next,
    cursor: start + insert.length,
  };
}
