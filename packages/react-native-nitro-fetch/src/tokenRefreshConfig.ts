type TokenRefreshJsonMapping = {
  jsonPath: string;
  header: string;
  valueTemplate?: string;
};

type TokenRefreshCompositeHeader = {
  header: string;
  template: string;
  paths: Record<string, string>;
};

type TokenRefreshBodyMapping = {
  jsonPath: string;
  bodyPath: string;
  valueTemplate?: string;
};

type TokenRefreshFormDataMapping = {
  jsonPath: string;
  field: string;
  valueTemplate?: string;
};

export type TokenRefreshConfig = {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'json' | 'text';
  mappings?: TokenRefreshJsonMapping[];
  compositeHeaders?: TokenRefreshCompositeHeader[];
  textHeader?: string;
  textTemplate?: string;
  bodyMappings?: TokenRefreshBodyMapping[];
  formDataMappings?: TokenRefreshFormDataMapping[];
  bodyTextPath?: string;
  formDataTextField?: string;
  onFailure?: 'skip' | 'useStoredHeaders';
};

// — Helpers —

/**
 * Resolve a dot-notation path inside a parsed JSON object.
 */
export function getNestedField(
  obj: unknown,
  dotPath: string
): string | undefined {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current != null ? String(current) : undefined;
}

export function applyTemplate(template: string, value: string): string {
  return template.replace(/\{\{value\}\}/g, () => value);
}

export function applyCompositeTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (match: string, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match
  );
}
