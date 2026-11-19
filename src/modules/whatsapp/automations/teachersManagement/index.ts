import { logger } from '../../../../utils';
import { registerTeachersManagement } from './handler';
import {
  TeachersManagementService,
  syncTeachersManagementLogStatuses,
} from './service';

registerTeachersManagement();

let sweeperTimer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

export function startTeachersManagementSweeper(): void {
  if (sweeperTimer) return;
  const tick = () => {
    if (sweeping) return;
    sweeping = true;
    void (async () => {
      await syncTeachersManagementLogStatuses();
      await TeachersManagementService.runDailySweep();
      await TeachersManagementService.runSubscriptionAlertSweep();
    })()
      .catch((err) => {
        logger.error({ err }, 'Teachers management sweep failed');
      })
      .finally(() => {
        sweeping = false;
      });
  };
  sweeperTimer = setInterval(tick, 30_000);
  tick();
}

export function stopTeachersManagementSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

export { TEACHERS_MANAGEMENT_KEY } from './constants';
export { TeachersManagementService } from './service';
