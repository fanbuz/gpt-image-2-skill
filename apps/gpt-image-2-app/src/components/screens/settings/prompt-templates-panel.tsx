import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Segmented } from "@/components/ui/segmented";
import { GlassSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PromptTemplateMark,
  promptTemplateColorStyle,
} from "@/components/screens/shared/prompt-template-mark";
import { useConfirm } from "@/hooks/use-confirm";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import {
  DEFAULT_PROMPT_TEMPLATE_COLOR,
  DEFAULT_PROMPT_TEMPLATE_ICON,
  exportPromptTemplates,
  importPromptTemplates,
  newPromptTemplate,
  newPromptTemplateGroup,
  PROMPT_TEMPLATE_COLORS,
  PROMPT_TEMPLATE_ICONS,
  PROMPT_SCOPE_LABEL,
  type PromptTemplate,
  type PromptTemplateColor,
  type PromptTemplateIcon,
  type PromptTemplateScope,
} from "@/lib/prompt-templates";
import { cn } from "@/lib/cn";

const SCOPE_OPTIONS = (
  Object.entries(PROMPT_SCOPE_LABEL) as [PromptTemplateScope, string][]
).map(([value, label]) => ({ value, label }));

function TemplateSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-border-faint"
      style={{ background: "var(--w-02)" }}
    >
      <header className="border-b border-border-faint px-4 py-3 sm:px-5">
        <div className="t-h3">{title}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-muted">{description}</div>
        )}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      className="h-9 w-full rounded-md border border-border bg-[color:var(--w-04)] px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-[color:var(--accent-55)] focus:bg-[color:var(--accent-06)]"
    />
  );
}

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TemplateIconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: PromptTemplateIcon;
  color: PromptTemplateColor;
  onIconChange: (icon: PromptTemplateIcon) => void;
  onColorChange: (color: PromptTemplateColor) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--w-06)]"
          title="选择模板图标和颜色"
          aria-label="选择模板图标和颜色"
        >
          <PromptTemplateMark icon={icon} color={color} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[326px] p-2">
        <div className="grid grid-cols-6 gap-1">
          {PROMPT_TEMPLATE_ICONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onIconChange(item.value)}
              title={item.label}
              aria-label={`选择图标：${item.label}`}
              aria-pressed={icon === item.value}
              className={cn(
                "flex h-10 items-center justify-center rounded-lg border transition-[background-color,border-color,transform]",
                icon === item.value
                  ? "scale-[1.03] border-[color:var(--accent-45)] bg-[color:var(--accent-14)]"
                  : "border-transparent hover:border-border-faint hover:bg-[color:var(--w-06)] hover:scale-[1.02]",
              )}
            >
              <PromptTemplateMark
                icon={item.value}
                color={color}
                size="md"
                className="border-transparent"
              />
            </button>
          ))}
        </div>
        <div className="mt-2 border-t border-border-faint pt-2">
          <div className="flex items-center justify-between gap-2">
            {PROMPT_TEMPLATE_COLORS.map((item) => {
              const style = promptTemplateColorStyle(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onColorChange(item.value)}
                  title={item.label}
                  aria-label={`选择颜色：${item.label}`}
                  aria-pressed={color === item.value}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-transform",
                    color === item.value
                      ? "border-[color:var(--accent-65)] bg-[color:var(--w-06)]"
                      : "border-transparent hover:scale-105 hover:border-border-faint",
                  )}
                >
                  <span
                    className="h-4 w-4 rounded-full border"
                    style={{ background: style.fg, borderColor: style.border }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PromptTemplatesPanel() {
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    state,
    update,
    upsertGroup,
    deleteGroup,
    upsertTemplate,
    deleteTemplate,
  } = usePromptTemplates();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    () => state.groups[0]?.id ?? null,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [templateScope, setTemplateScope] =
    useState<PromptTemplateScope>("common");
  const [templateIcon, setTemplateIcon] = useState<PromptTemplateIcon>(
    DEFAULT_PROMPT_TEMPLATE_ICON,
  );
  const [templateColor, setTemplateColor] = useState<PromptTemplateColor>(
    DEFAULT_PROMPT_TEMPLATE_COLOR,
  );
  const [templateGroupId, setTemplateGroupId] = useState<string>("");

  const selectedGroup = state.groups.find(
    (group) => group.id === selectedGroupId,
  );
  const groupTemplates = selectedGroup
    ? state.templates.filter(
        (template) => template.groupId === selectedGroup.id,
      )
    : [];

  useEffect(() => {
    if (
      selectedGroupId &&
      state.groups.some((group) => group.id === selectedGroupId)
    ) {
      return;
    }
    setSelectedGroupId(state.groups[0]?.id ?? null);
  }, [selectedGroupId, state.groups]);

  useEffect(() => {
    if (
      !templateGroupId ||
      !state.groups.some((group) => group.id === templateGroupId)
    ) {
      setTemplateGroupId(selectedGroupId ?? state.groups[0]?.id ?? "");
    }
  }, [selectedGroupId, state.groups, templateGroupId]);

  const resetForm = () => {
    setEditingId(null);
    setTemplateTitle("");
    setTemplatePrompt("");
    setTemplateScope("common");
    setTemplateIcon(DEFAULT_PROMPT_TEMPLATE_ICON);
    setTemplateColor(DEFAULT_PROMPT_TEMPLATE_COLOR);
    setTemplateGroupId(selectedGroupId ?? state.groups[0]?.id ?? "");
  };

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const group = newPromptTemplateGroup(name);
    upsertGroup(group);
    setSelectedGroupId(group.id);
    setTemplateGroupId(group.id);
    setNewGroupName("");
  };

  const renameGroup = (groupId: string, name: string) => {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    upsertGroup({
      ...group,
      name,
      updatedAt: Date.now(),
    });
  };

  const removeGroup = async (groupId: string) => {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    const templateCount = state.templates.filter(
      (template) => template.groupId === groupId,
    ).length;
    const ok = await confirm({
      title: `删除分组「${group.name}」`,
      description:
        templateCount > 0
          ? `会同时删除这个分组里的 ${templateCount} 个模板。`
          : "此操作无法撤销。",
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteGroup(groupId);
    if (templateGroupId === groupId) resetForm();
  };

  const editTemplate = (template: PromptTemplate) => {
    setEditingId(template.id);
    setTemplateTitle(template.title);
    setTemplatePrompt(template.prompt);
    setTemplateScope(template.scope);
    setTemplateIcon(template.icon);
    setTemplateColor(template.color);
    setTemplateGroupId(template.groupId);
  };

  const duplicateTemplate = (template: PromptTemplate) => {
    const copy = newPromptTemplate(template.groupId, template.scope);
    upsertTemplate({
      ...copy,
      title: `${template.title} 副本`,
      prompt: template.prompt,
      icon: template.icon,
      color: template.color,
    });
    toast.success("模板已复制");
  };

  const removeTemplate = async (template: PromptTemplate) => {
    const ok = await confirm({
      title: `删除模板「${template.title}」`,
      description: "此操作无法撤销。",
      confirmText: "删除",
      variant: "danger",
    });
    if (!ok) return;
    deleteTemplate(template.id);
    if (editingId === template.id) resetForm();
  };

  const saveTemplate = () => {
    const title = templateTitle.trim();
    const prompt = templatePrompt.trim();
    const groupId = templateGroupId || selectedGroupId || state.groups[0]?.id;
    if (!groupId) {
      toast.error("请先创建一个分组");
      return;
    }
    if (!title) {
      toast.error("请填写模板名称");
      return;
    }
    if (!prompt) {
      toast.error("请填写提示词内容");
      return;
    }
    const existing = editingId
      ? state.templates.find((template) => template.id === editingId)
      : null;
    const base = existing ?? newPromptTemplate(groupId, templateScope);
    upsertTemplate({
      ...base,
      groupId,
      title,
      prompt,
      scope: templateScope,
      icon: templateIcon,
      color: templateColor,
      updatedAt: Date.now(),
    });
    toast.success(existing ? "模板已更新" : "模板已添加");
    resetForm();
  };

  const handleExport = () => {
    downloadJson(
      "gpt-image-2-prompt-templates.json",
      exportPromptTemplates(state),
    );
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = importPromptTemplates(await file.text());
      const ok = await confirm({
        title: "导入提示词模板",
        description: "导入会替换当前所有分组和模板。",
        confirmText: "导入",
      });
      if (!ok) return;
      update(imported);
      setSelectedGroupId(imported.groups[0]?.id ?? null);
      resetForm();
      toast.success("提示词模板已导入", {
        description: `${imported.groups.length} 个分组，${imported.templates.length} 个模板。`,
      });
    } catch (error) {
      toast.error("导入失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] text-muted">
          模板会插入到生成 / 编辑提示词的光标位置；新模板默认作用域为通用。
        </div>
        <div className="flex gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void handleImportFile(event.target.files?.[0])}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={13} />
            导入 JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download size={13} />
            导出 JSON
          </Button>
        </div>
      </div>

      <TemplateSection
        title="分组"
        description="分组可自定义；删除分组会删除其中模板。"
      >
        <div className="flex gap-2">
          <TextInput
            value={newGroupName}
            onChange={setNewGroupName}
            placeholder="新分组名称"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={!newGroupName.trim()}
            onClick={addGroup}
          >
            添加
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {state.groups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-faint px-3 py-4 text-center text-[12px] text-muted">
              暂无分组，添加一个分组后即可创建模板。
            </div>
          ) : (
            state.groups.map((group) => {
              const isSelected = group.id === selectedGroupId;
              return (
                <div
                  key={group.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                    isSelected
                      ? "border-[color:var(--accent-30)] bg-[color:var(--accent-06)]"
                      : "border-border-faint bg-[color:var(--w-03)]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!isSelected) setSelectedGroupId(group.id);
                    }}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
                      isSelected
                        ? "bg-[color:var(--accent-14)] text-foreground"
                        : "text-muted hover:bg-[color:var(--w-06)] hover:text-foreground",
                    )}
                  >
                    <FileText size={12} />
                    {isSelected ? "当前" : "切换"}
                  </button>
                  <TextInput
                    value={group.name}
                    onChange={(name) => renameGroup(group.id, name)}
                    ariaLabel="分组名称"
                  />
                  <button
                    type="button"
                    onClick={() => void removeGroup(group.id)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--status-err-10)] hover:text-[color:var(--status-err)]"
                    title="删除分组"
                    aria-label="删除分组"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </TemplateSection>

      <TemplateSection
        title={editingId ? "编辑模板" : "新建模板"}
        description="作用域控制模板出现在哪些创作页面；通用模板会出现在所有页面。"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="flex h-9 w-full items-center gap-1.5 rounded-md border border-border bg-[color:var(--w-04)] px-1.5 transition-colors focus-within:border-[color:var(--accent-55)] focus-within:bg-[color:var(--accent-06)]">
            <TemplateIconPicker
              icon={templateIcon}
              color={templateColor}
              onIconChange={setTemplateIcon}
              onColorChange={setTemplateColor}
            />
            <input
              value={templateTitle}
              onChange={(event) => setTemplateTitle(event.target.value)}
              placeholder="模板名称"
              aria-label="模板名称"
              className="min-w-0 flex-1 border-none bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-faint"
            />
          </div>
          <GlassSelect
            value={templateGroupId}
            onValueChange={setTemplateGroupId}
            options={state.groups.map((group) => ({
              value: group.id,
              label: group.name,
            }))}
            disabled={state.groups.length === 0}
            placeholder="选择分组"
          />
        </div>
        <div className="mt-3">
          <Segmented
            value={templateScope}
            onChange={(scope) => setTemplateScope(scope as PromptTemplateScope)}
            size="sm"
            ariaLabel="模板作用域"
            options={SCOPE_OPTIONS}
          />
        </div>
        <div className="mt-3">
          <Textarea
            value={templatePrompt}
            onChange={(event) => setTemplatePrompt(event.target.value)}
            minHeight={112}
            placeholder="写入要复用的提示词..."
          />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              取消
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={editingId ? "check" : "plus"}
            onClick={saveTemplate}
          >
            {editingId ? "保存模板" : "添加模板"}
          </Button>
        </div>
      </TemplateSection>

      <TemplateSection
        title={selectedGroup ? `模板 · ${selectedGroup.name}` : "模板"}
        description="默认模板和默认分组与普通数据一样，可编辑、复制或删除。"
      >
        {selectedGroup ? (
          groupTemplates.length === 0 ? (
            <Empty
              icon="filedot"
              title="这个分组还没有模板"
              subtitle="在上方新建模板并保存到当前分组。"
            />
          ) : (
            <div className="grid gap-2">
              {groupTemplates.map((template) => (
                <article
                  key={template.id}
                  className="rounded-lg border border-border-faint bg-[color:var(--w-03)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PromptTemplateMark
                      icon={template.icon}
                      color={template.color}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-foreground">
                        {template.title}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-faint">
                        {PROMPT_SCOPE_LABEL[template.scope]}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => editTemplate(template)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--w-06)] hover:text-foreground"
                      title="编辑"
                      aria-label="编辑模板"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateTemplate(template)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--w-06)] hover:text-foreground"
                      title="复制"
                      aria-label="复制模板"
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeTemplate(template)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--status-err-10)] hover:text-[color:var(--status-err)]"
                      title="删除"
                      aria-label="删除模板"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
                    {template.prompt}
                  </p>
                </article>
              ))}
            </div>
          )
        ) : (
          <Empty
            icon="filedot"
            title="还没有分组"
            subtitle="先添加分组，再创建提示词模板。"
          />
        )}
      </TemplateSection>
    </div>
  );
}
