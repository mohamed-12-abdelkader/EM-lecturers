import { registerParentsExamNotify } from './handler';
import { runParentsExamSweep } from './service';
import { logger } from '../../../../utils';

registerParentsExamNotify();

let sweeperTimer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

export function startParentsExamSweeper(): void {
  if (sweeperTimer) return;
  const tick = () => {
    if (sweeping) return;
    sweeping = true;
    void runParentsExamSweep()
      .catch((err) => {
        logger.error({ err }, 'Parents exam notify sweep failed');
      })
      .finally(() => {
        sweeping = false;
      });
  };
  sweeperTimer = setInterval(tick, 60_000);
  tick();
}

export function stopParentsExamSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

export { PARENTS_EXAM_NOTIFY_KEY } from './constants';
export { onParentsExamInbound } from './handler';
