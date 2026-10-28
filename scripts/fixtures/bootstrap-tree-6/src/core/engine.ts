export interface EngineOptions {
  depth: number;
}

export const MAX_DEPTH = 8;

export function runEngine(options: EngineOptions): string[] {
  const frames: string[] = [];
  for (let i = 0; i < Math.min(options.depth, MAX_DEPTH); i++) {
    frames.push(`frame-${i}`);
  }
  return frames;
}

export function resetEngine(): void {
  // No cached state survives a reset.
}
