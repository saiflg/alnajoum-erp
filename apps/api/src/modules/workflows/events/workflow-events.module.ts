import { Global, Module } from '@nestjs/common';
import { WorkflowEventBus } from './workflow-event-bus.service';

/**
 * Global so any domain module can publish an event with one injected dependency and
 * no import changes. It depends only on Prisma and the event emitter, so it cannot
 * create an import cycle with the modules that publish through it.
 */
@Global()
@Module({
  providers: [WorkflowEventBus],
  exports: [WorkflowEventBus],
})
export class WorkflowEventsModule {}
