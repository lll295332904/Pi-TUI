type RecoveryHandler = (command: string) => void | Promise<void>;

let handler: RecoveryHandler | null = null;

export function registerRecoveryHandler(next: RecoveryHandler | null) {
  handler = next;
}

export async function runRecoveryAction(command: string) {
  if (!handler) return;
  await handler(command);
}
