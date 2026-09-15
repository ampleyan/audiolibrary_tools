declare namespace YT {
  const PlayerState: { ENDED: number };
  interface OnStateChangeEvent { data: number; }
  interface PlayerOptions {
    videoId: string;
    playerVars?: Record<string, unknown>;
    events?: { onStateChange?: (e: OnStateChangeEvent) => void };
  }
  class Player {
    constructor(el: HTMLElement, opts: PlayerOptions);
    destroy(): void;
  }
}
