export class CommandLaneClearedError extends Error {
  constructor(lane?: string) {
    super(lane ? `Command lane "${lane}" cleared` : "Command lane cleared");
    this.name = "CommandLaneClearedError";
  }
}

export class GatewayDrainingError extends Error {
  constructor() {
    super("Gateway is draining; new tasks are not accepted");
    this.name = "GatewayDrainingError";
  }
}

type QueueEntry = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
};

type LaneState = {
  queue: QueueEntry[];
  running: number;
  maxConcurrent: number;
  draining: boolean;
};

let gatewayDraining = false;
const lanes = new Map<string, LaneState>();

function getLane(name: string): LaneState {
  let state = lanes.get(name);
  if (!state) {
    state = { queue: [], running: 0, maxConcurrent: 1, draining: false };
    lanes.set(name, state);
  }
  return state;
}

function pump(name: string): void {
  const state = getLane(name);
  if (state.draining) return;
  state.draining = true;

  try {
    while (state.running < state.maxConcurrent && state.queue.length > 0) {
      const entry = state.queue.shift()!;
      state.running++;
      void (async () => {
        try {
          const result = await entry.task();
          state.running--;
          pump(name);
          entry.resolve(result);
        } catch (err) {
          state.running--;
          pump(name);
          entry.reject(err);
        }
      })();
    }
  } finally {
    state.draining = false;
  }
}

export function setLaneConcurrency(lane: string, max: number): void {
  const state = getLane(lane);
  state.maxConcurrent = Math.max(1, Math.floor(max));
  pump(lane);
}

export function enqueueInLane<T>(
  lane: string,
  task: () => Promise<T>,
): Promise<T> {
  if (gatewayDraining) {
    return Promise.reject(new GatewayDrainingError());
  }
  const state = getLane(lane);
  return new Promise<T>((resolve, reject) => {
    state.queue.push({
      task: () => task(),
      resolve: (v) => resolve(v as T),
      reject,
      enqueuedAt: Date.now(),
    });
    pump(lane);
  });
}

export function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueueInLane("main", task);
}

export function getQueueDepth(lane = "main"): number {
  const state = lanes.get(lane);
  if (!state) return 0;
  return state.queue.length + state.running;
}

export function clearLane(lane = "main"): number {
  const state = lanes.get(lane);
  if (!state) return 0;
  const removed = state.queue.length;
  const pending = state.queue.splice(0);
  for (const entry of pending) {
    entry.reject(new CommandLaneClearedError(lane));
  }
  return removed;
}

export function markDraining(): void {
  gatewayDraining = true;
}

export function resetAll(): void {
  gatewayDraining = false;
  for (const [name, state] of lanes) {
    const pending = state.queue.splice(0);
    for (const entry of pending) {
      entry.reject(new CommandLaneClearedError(name));
    }
  }
  lanes.clear();
}
