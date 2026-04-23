import type { NotificationTemplate } from "../../domain/models";
import { Panel } from "../../shared/ui/Panel";
import { channelLabel } from "../../shared/utils/format";

type TemplatePreviewProps = {
  template: NotificationTemplate;
};

export function TemplatePreview({ template }: TemplatePreviewProps) {
  return (
    <Panel title={template.title}>
      <div className="space-y-3 text-sm text-slate-600">
        <p>類別：{template.category}</p>
        <p>管道：{channelLabel(template.channel)}</p>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="font-semibold text-brand-ink">{template.subject_template}</p>
          <p className="mt-2 whitespace-pre-wrap">{template.body_template}</p>
        </div>
        <p>可用變數：{template.variables.join("、")}</p>
      </div>
    </Panel>
  );
}
