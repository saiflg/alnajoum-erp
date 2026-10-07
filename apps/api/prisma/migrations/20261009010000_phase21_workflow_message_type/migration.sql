-- Phase 21 - a notification type for messages sent by the workflow engine. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKFLOW_MESSAGE';
