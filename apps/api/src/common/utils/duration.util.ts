import ms, { StringValue } from 'ms';

/** Converts a duration string (e.g. "15m", "7d") to whole seconds. */
export function durationToSeconds(duration: string): number {
  return Math.floor(ms(duration as StringValue) / 1000);
}

/** Converts a duration string (e.g. "15m", "7d") to milliseconds. */
export function durationToMs(duration: string): number {
  return ms(duration as StringValue);
}
