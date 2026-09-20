// A separate daily trigger advances one durable stage; Hobby plans allow each
// cron entry once per day, so stages are spaced beyond cron's hour of jitter.
export { default } from './sync.js';
