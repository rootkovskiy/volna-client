// Shared thresholds for touch, mouse and native responders (velocity is px/ms).
export function isToastSwipeUp(dx: number, dy: number) {
  return dy < -6 && -dy > Math.abs(dx) * 1.15;
}

export function shouldDismissToast(dx: number, dy: number, velocityY: number) {
  return isToastSwipeUp(dx, dy) && (-dy >= 36 || (-dy >= 12 && velocityY <= -0.55));
}

type Timer = ReturnType<typeof setTimeout>;

// One lifetime per toast identity. Pausing a gesture retains its remaining time;
// disposed/duplicate animation callbacks cannot close a replacement toast.
export function createToastLifetime(onExit: (swiped: boolean) => void, onClose: () => void) {
  let disposed = false;
  let closing = false;
  let finished = false;
  let timer: Timer | undefined;
  let remaining = 4000;
  let deadline = 0;

  const pause = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, deadline - Date.now());
  };
  const dismiss = (swiped = false) => {
    if (disposed || closing) return;
    closing = true;
    pause();
    onExit(swiped);
  };
  const resume = () => {
    if (disposed || closing || timer !== undefined) return;
    deadline = Date.now() + remaining;
    timer = setTimeout(() => { timer = undefined; dismiss(); }, remaining);
  };
  return {
    pause, resume, dismiss,
    finish: () => {
      if (disposed || !closing || finished) return;
      finished = true;
      onClose();
    },
    dispose: () => { pause(); disposed = true; },
    isClosing: () => closing || disposed,
  };
}
