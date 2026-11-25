import { createLucideIcon } from 'lucide-react';

export const AlarmIcon = createLucideIcon('alarm', [
  ['circle', { cx: '12', cy: '13', r: '8', key: '0' }],
  ['path', { d: 'M12 9v4l2 2M5 3 2 6M22 6l-3-3M6.38 18.7 4 21M17.64 18.67 20 21', key: '1' }],
]);

export const CalendarClockIcon = createLucideIcon('calc', [
  ['path', { d: 'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5', key: '0' }],
  ['path', { d: 'M17.5 17.5 16 16.3V14', key: '1' }],
  ['circle', { cx: '16', cy: '16', r: '6', key: '2' }],
]);

export const CalendarRemoveIcon = createLucideIcon('calx', [
  ['path', { d: 'M8 2v4M16 2v4', key: '0' }],
  ['rect', { width: '18', height: '18', x: '3', y: '4', rx: '2', key: '1' }],
  ['path', { d: 'M3 10h18M10 14l4 4M14 14l-4 4', key: '2' }],
]);

export const CalendarJobsIcon = createLucideIcon('cal', [
  ['path', { d: 'M8 2v4M16 2v4', key: '0' }],
  ['rect', { width: '18', height: '18', x: '3', y: '4', rx: '2', key: '1' }],
  ['path', { d: 'M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01', key: '2' }],
]);

export const PlanIcon = createLucideIcon('clipl', [
  ['rect', { width: '8', height: '4', x: '8', y: '2', rx: '1', key: '0' }],
  ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', key: '1' }],
  ['path', { d: 'M12 11h4M12 16h4M8 11h.01M8 16h.01', key: '2' }],
]);

export const ApprovedPlanIcon = createLucideIcon('clipok', [
  ['rect', { width: '8', height: '4', x: '8', y: '2', rx: '1', key: '0' }],
  ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', key: '1' }],
  ['path', { d: 'm9 14 2 2 4-4', key: '2' }],
]);
