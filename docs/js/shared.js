export { store, NOW, desktopOwns, isOnDesktop, timeLabel, reminderLabel } from './store.js';
import { todoStats } from './markdown.js';

export const todoStatsFor = n => todoStats(n.body);

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
// Hidden pages pause animation timelines, so skip animating rather than wait on them.
export const reduceMotion = () => motionQuery.matches || document.hidden;
export const onMotionChange = fn => motionQuery.addEventListener('change', fn);
