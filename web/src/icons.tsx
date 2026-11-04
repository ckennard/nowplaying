const P = (d: string) => (props: { size?: number }) => (
  <svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d={d} /></svg>
);
export const IconPlay = P('M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z');
export const IconPause = P('M7 4h3.5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm6.5 0H17a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z');
export const IconNext = P('M5 5.5v13a1 1 0 0 0 1.53.85L16 13.2V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.8L6.53 4.65A1 1 0 0 0 5 5.5Z');
export const IconPrev = P('M19 5.5v13a1 1 0 0 1-1.53.85L8 13.2V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.8l9.47-6.15A1 1 0 0 1 19 5.5Z');
export const IconQueue = P('M3 6h13v2H3V6Zm0 5h13v2H3v-2Zm0 5h9v2H3v-2Zm15-2.5V8l4 3-4 3Z');
export const IconInfo = P('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z');
export const IconLyrics = P('M4 5h16v2H4V5Zm0 4h10v2H4V9Zm0 4h16v2H4v-2Zm0 4h10v2H4v-2Zm14-1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z');
export const IconWave = P('M3 12h2v3H3v-3Zm4-4h2v11H7V8Zm4-5h2v18h-2V3Zm4 7h2v7h-2v-7Zm4-2h2v11h-2V8Z');
export const IconMic = P('M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z');
export const IconFull = P('M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z');
export const IconGear = P('M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1l-.4-2.7h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z');
export const IconVolume = P('M4 9v6h4l5 5V4L8 9H4Zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-9v2.06a7 7 0 0 1 0 13.88V21a9 9 0 0 0 0-18Z');
export const IconClose = P('M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z');
export const IconPinned = P('M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4 1-3Z');
