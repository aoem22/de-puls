import { PromptEditor } from '@/components/Admin/PromptEditor';

export default function PromptsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Enrichment Prompts
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Manage versioned enrichment prompts. The active version is loaded by the pipeline enricher.
        </p>
      </div>
      <PromptEditor />
    </div>
  );
}
