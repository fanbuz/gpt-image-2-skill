import { useCallback, useEffect, useState } from "react";
import {
  loadPromptTemplates,
  PROMPT_TEMPLATES_EVENT,
  savePromptTemplates,
  type PromptTemplate,
  type PromptTemplateGroup,
  type PromptTemplateState,
} from "@/lib/prompt-templates";

type Updater =
  | PromptTemplateState
  | ((state: PromptTemplateState) => PromptTemplateState);

export function usePromptTemplates() {
  const [state, setState] = useState<PromptTemplateState>(loadPromptTemplates);

  useEffect(() => {
    const refresh = () => setState(loadPromptTemplates());
    window.addEventListener(PROMPT_TEMPLATES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PROMPT_TEMPLATES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const update = useCallback((updater: Updater) => {
    setState((current) => {
      const next =
        typeof updater === "function"
          ? (updater as (state: PromptTemplateState) => PromptTemplateState)(
              current,
            )
          : updater;
      return savePromptTemplates(next);
    });
  }, []);

  const touchTemplate = useCallback(
    (templateId: string) => {
      update((current) => ({
        ...current,
        templates: current.templates.map((template) =>
          template.id === templateId
            ? { ...template, usedAt: Date.now(), updatedAt: Date.now() }
            : template,
        ),
      }));
    },
    [update],
  );

  const upsertGroup = useCallback(
    (group: PromptTemplateGroup) => {
      update((current) => {
        const exists = current.groups.some((item) => item.id === group.id);
        return {
          ...current,
          groups: exists
            ? current.groups.map((item) =>
                item.id === group.id ? group : item,
              )
            : [...current.groups, group],
        };
      });
    },
    [update],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      update((current) => ({
        ...current,
        groups: current.groups.filter((group) => group.id !== groupId),
        templates: current.templates.filter(
          (template) => template.groupId !== groupId,
        ),
      }));
    },
    [update],
  );

  const upsertTemplate = useCallback(
    (template: PromptTemplate) => {
      update((current) => {
        const exists = current.templates.some(
          (item) => item.id === template.id,
        );
        return {
          ...current,
          templates: exists
            ? current.templates.map((item) =>
                item.id === template.id ? template : item,
              )
            : [...current.templates, template],
        };
      });
    },
    [update],
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      update((current) => ({
        ...current,
        templates: current.templates.filter(
          (template) => template.id !== templateId,
        ),
      }));
    },
    [update],
  );

  return {
    state,
    update,
    touchTemplate,
    upsertGroup,
    deleteGroup,
    upsertTemplate,
    deleteTemplate,
  };
}
