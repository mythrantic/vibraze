import { writable } from "svelte/store"

// Whether the radio stream is currently playing
export const radioPlaying = writable(false)

// Current "now playing" track metadata from SSE
export const radioNowPlaying = writable(null)

// Whether we're connected to the SSE stream
export const radioConnected = writable(false)
