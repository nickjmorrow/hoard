// What the UI calls the machine Hoard and Jellyfin run on: "On the server", "Can’t reach the server".
// Set VITE_SERVER_NAME (e.g. in the gitignored .env) to use the machine's own name instead.

export const SERVER_NAME = import.meta.env.VITE_SERVER_NAME?.trim() || 'the server'

/** The label for titles Jellyfin has: "On the server", or "On <name>". */
export const ON_SERVER = `On ${SERVER_NAME}`
