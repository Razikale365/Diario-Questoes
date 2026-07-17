export interface CalendarRequest {
  epoch: number;
  signal: AbortSignal;
}

export const createCalendarAutoOrganizeIntentGate = () => {
  let consumedToken = 0;
  return {
    consume: (token: number) => {
      if (!Number.isInteger(token) || token <= consumedToken) return false;
      consumedToken = token;
      return true;
    },
  };
};

export const createCalendarRequestGate = () => {
  let epoch = 0;
  let activeController: AbortController | null = null;

  const invalidate = () => {
    epoch += 1;
    activeController?.abort();
    activeController = null;
  };

  const begin = (parentSignal?: AbortSignal): CalendarRequest => {
    invalidate();
    const controller = new AbortController();
    activeController = controller;
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return { epoch, signal: controller.signal };
  };

  const isCurrent = (request: CalendarRequest) => request.epoch === epoch && !request.signal.aborted;

  return {
    begin,
    invalidate,
    isCurrent,
    applyIfCurrent: (request: CalendarRequest, apply: () => void) => {
      if (!isCurrent(request)) return false;
      apply();
      return true;
    },
    dispose: invalidate,
  };
};
