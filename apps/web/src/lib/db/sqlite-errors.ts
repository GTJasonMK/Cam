export function isSqliteMissingSchemaError(error: unknown, hints: string[] = []): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes('no such table') || message.includes('no such column')) {
    return true;
  }
  return hints.some((hint) => message.includes(hint.toLowerCase()));
}

export function isSqliteForeignKeyConstraintError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return true;
    }
  }

  return error instanceof Error && error.message.includes('FOREIGN KEY constraint failed');
}
