import React from "react";

const PATHS = {
  "arrow-left": <><path d="m14 6-6 6 6 6" /><path d="M8 12h12" /></>,
  "arrow-right": <><path d="m10 6 6 6-6 6" /><path d="M4 12h12" /></>,
  advisor: <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 3v6l4 2" /><path d="M21 3v6h-6" /></>,
  chat: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.5-.7L4 20l1.5-3.5A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.8" /></>,
  command: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 9 2 2-2 2M12.5 14H16" /></>,
  close: <><path d="m7 7 10 10M17 7 7 17" /></>,
  forces: <><path d="M12 4 5 7v5c0 4.2 2.7 6.8 7 8 4.3-1.2 7-3.8 7-8V7l-7-3Z" /><path d="M12 8v7M9.5 10.5h5" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></>,
  home: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>,
  markers: <><path d="M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  message: <><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M7 10h.01M12 10h.01M17 10h.01" strokeWidth="2.8" /></>,
  reserves: <><path d="M5 8h14v11H5zM8 8V5h8v3M3 12h18" /><path d="M10 15h4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.7-3L3 11" /><path d="M3 5v6h6M4 13a8 8 0 0 0 14.7 3L21 13" /><path d="M21 19v-6h-6" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.4" /><path d="m16 16 4.2 4.2" /></>,
  settings: <><path d="M12 3.5v2M12 18.5v2M5.99 5.99l1.42 1.42M16.59 16.59l1.42 1.42M3.5 12h2M18.5 12h2M5.99 18.01l1.42-1.42M16.59 7.41l1.42-1.42" /><circle cx="12" cy="12" r="3.2" /></>,
  spark: <><path d="m12 2 1.6 7.4L21 11l-7.4 1.6L12 20l-1.6-7.4L3 11l7.4-1.6L12 2Z" /><path d="m19 17 .6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6L19 17Z" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  power: <><path d="M12 3v9" /><path d="M6.3 6.3a8 8 0 1 0 11.4 0" /></>,
};

export const GameIcon = ({ name = "command", size = 18, strokeWidth = 1.8, className = "", title }) => (
  <svg
    aria-hidden={title ? undefined : "true"}
    aria-label={title}
    className={className}
    fill="none"
    height={size}
    role={title ? "img" : undefined}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={strokeWidth}
    viewBox="0 0 24 24"
    width={size}
  >
    {PATHS[name] ?? PATHS.command}
  </svg>
);

export default GameIcon;
