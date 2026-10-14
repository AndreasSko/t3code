/** Electron preload installs desktopBridge before web code, so detection is reliable at module load. */
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;
