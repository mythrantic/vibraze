<script>
  import { onMount, onDestroy } from 'svelte'
  import { radioPlaying, radioNowPlaying, radioConnected } from '$lib/radioStore'
  import { radioBackendURL } from '$lib/info'

  let audioEl
  let stations = []
  let tags = []
  let searchQuery = ""
  let selectedCountry = "NO"
  let selectedTag = ""
  let currentStation = null
  let loading = false
  let loadingMore = false
  let view = "browse" // "browse" | "search" | "favorites"
  let favorites = []
  let countries = []
  let showAllCountries = false
  let offset = 0
  let hasMore = true
  let sentinel
  let observer

  const LIMIT = 50

  const streamUrl = () => currentStation?.url_resolved || currentStation?.url || ""

  // Play a station
  function playStation(station) {
    if (currentStation?.stationuuid === station.stationuuid && $radioPlaying) {
      stopRadio()
      return
    }
    currentStation = station
    $radioNowPlaying = { title: station.name, artist: station.tags || station.country }
    audioEl.src = station.url_resolved || station.url
    audioEl.load()
    audioEl.play()
    $radioPlaying = true
  }

  function stopRadio() {
    audioEl.pause()
    audioEl.src = ""
    $radioPlaying = false
  }

  // Build the current fetch URL based on active filter
  function buildURL(off) {
    if (selectedCountry) {
      return `${radioBackendURL}/api/radio/stations/search?countrycode=${selectedCountry}&order=votes&reverse=true&limit=${LIMIT}&offset=${off}`
    } else if (selectedTag) {
      return `${radioBackendURL}/api/radio/tag-stations/${encodeURIComponent(selectedTag)}?limit=${LIMIT}&offset=${off}`
    } else if (view === "search" && searchQuery.trim()) {
      return `${radioBackendURL}/api/radio/stations/search?name=${encodeURIComponent(searchQuery)}&limit=${LIMIT}&offset=${off}`
    } else {
      return `${radioBackendURL}/api/radio/stations/top?limit=${LIMIT}&offset=${off}`
    }
  }

  // Load stations (resets list)
  async function loadStations(url) {
    loading = true
    offset = 0
    hasMore = true
    try {
      const res = await fetch(url || buildURL(0))
      const data = await res.json()
      stations = data
      hasMore = data.length >= LIMIT
      offset = data.length
    } catch (e) { console.error(e) }
    loading = false
  }

  // Load more stations (appends to list)
  async function loadMore() {
    if (loadingMore || !hasMore) return
    loadingMore = true
    try {
      const res = await fetch(buildURL(offset))
      const data = await res.json()
      if (data.length > 0) {
        stations = [...stations, ...data]
        offset += data.length
        hasMore = data.length >= LIMIT
      } else {
        hasMore = false
      }
    } catch (e) { console.error(e) }
    loadingMore = false
  }

  // Load stations by country
  async function loadByCountry(code) {
    selectedCountry = code
    selectedTag = ""
    view = "browse"
    await loadStations(`${radioBackendURL}/api/radio/stations/search?countrycode=${code}&order=votes&reverse=true&limit=${LIMIT}&offset=0`)
  }

  // Load stations by tag
  async function loadByTag(tag) {
    selectedTag = tag
    selectedCountry = ""
    view = "browse"
    await loadStations(`${radioBackendURL}/api/radio/tag-stations/${encodeURIComponent(tag)}?limit=${LIMIT}&offset=0`)
  }

  // Search stations
  async function searchStations() {
    if (!searchQuery.trim()) return
    selectedCountry = ""
    selectedTag = ""
    view = "search"
    await loadStations(`${radioBackendURL}/api/radio/stations/search?name=${encodeURIComponent(searchQuery)}&limit=${LIMIT}&offset=0`)
  }

  // Load top stations
  async function loadTop() {
    selectedCountry = ""
    selectedTag = ""
    view = "browse"
    await loadStations(`${radioBackendURL}/api/radio/stations/top?limit=${LIMIT}&offset=0`)
  }

  // Load popular tags
  async function loadTags() {
    try {
      const res = await fetch(`${radioBackendURL}/api/radio/stations/tags?limit=30`)
      tags = await res.json()
    } catch (e) { console.error(e) }
  }

  // Favorites
  async function loadFavorites() {
    try {
      const res = await fetch(`${radioBackendURL}/api/radio/stations/favorites`)
      const data = await res.json()
      favorites = data.favorites || []
    } catch (e) { console.error(e) }
  }

  // Countries
  async function loadCountries() {
    if (countries.length > 0) { showAllCountries = !showAllCountries; return }
    try {
      const res = await fetch(`${radioBackendURL}/api/radio/stations/countries`)
      countries = await res.json()
      showAllCountries = true
    } catch (e) { console.error(e) }
  }

  async function toggleFavorite(station) {
    const isFav = favorites.some(f => f.station_uuid === station.stationuuid)
    if (isFav) {
      await fetch(`${radioBackendURL}/api/radio/stations/favorite?station_uuid=${station.stationuuid}`, { method: "DELETE" })
    } else {
      await fetch(`${radioBackendURL}/api/radio/stations/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          station_uuid: station.stationuuid,
          name: station.name,
          url: station.url_resolved || station.url,
          favicon: station.favicon || "",
          country: station.country || "",
          tags: station.tags || ""
        })
      })
    }
    await loadFavorites()
  }

  function isFav(station) {
    return favorites.some(f => f.station_uuid === station.stationuuid)
  }

  function handleKey(e) {
    if (e.key === "Enter") searchStations()
  }

  function setupObserver() {
    if (observer) observer.disconnect()
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && !loadingMore && hasMore && view !== "favorites") {
        loadMore()
      }
    }, { rootMargin: "200px" })
    if (sentinel) observer.observe(sentinel)
  }

  $: if (sentinel) setupObserver()

  onMount(() => {
    loadByCountry("NO")
    loadTags()
    loadFavorites()
  })

  onDestroy(() => {
    if (observer) observer.disconnect()
  })
</script>

<div class="flex flex-col gap-4 py-4 max-w-4xl">
  <!-- Header + Now Playing -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <div class="h-8 w-8 text-emerald-400">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4"/>
          <circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4"/>
          <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
        </svg>
      </div>
      <h1 class="text-xl font-bold">Radio</h1>
    </div>

    {#if currentStation && $radioPlaying}
      <div class="flex items-center gap-3 bg-zinc-800 rounded-lg px-3 py-2">
        {#if currentStation.favicon}
          <img src={currentStation.favicon} alt="" class="h-6 w-6 rounded" />
        {/if}
        <span class="text-sm font-medium truncate max-w-[200px]">{currentStation.name}</span>
        <button on:click={stopRadio} class="text-red-400 hover:text-red-300 text-xs font-bold">Stop</button>
      </div>
    {/if}
  </div>

  <audio bind:this={audioEl} preload="none"></audio>

  <!-- Search -->
  <div class="flex gap-2">
    <input
      type="text"
      bind:value={searchQuery}
      on:keydown={handleKey}
      placeholder="Search stations worldwide..."
      class="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-emerald-500"
    />
    <button on:click={searchStations} class="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded text-sm font-medium">Search</button>
  </div>

  <!-- Quick Filters -->
  <div class="flex gap-2 flex-wrap text-xs">
    <button on:click={() => { view = "browse"; loadByCountry("NO") }}
      class="px-3 py-1.5 rounded-full {selectedCountry === 'NO' ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      Norway
    </button>
    <button on:click={() => { view = "browse"; loadByCountry("US") }}
      class="px-3 py-1.5 rounded-full {selectedCountry === 'US' ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      USA
    </button>
    <button on:click={() => { view = "browse"; loadByCountry("GB") }}
      class="px-3 py-1.5 rounded-full {selectedCountry === 'GB' ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      UK
    </button>
    <button on:click={() => { view = "browse"; loadByCountry("KE") }}
      class="px-3 py-1.5 rounded-full {selectedCountry === 'KE' ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      Kenya
    </button>
    <button on:click={() => { view = "browse"; loadByCountry("JP") }}
      class="px-3 py-1.5 rounded-full {selectedCountry === 'JP' ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      Japan
    </button>
    <button on:click={() => { view = "browse"; loadTop() }}
      class="px-3 py-1.5 rounded-full {!selectedCountry && !selectedTag ? 'bg-emerald-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      Top Worldwide
    </button>
    <button on:click={loadCountries}
      class="px-3 py-1.5 rounded-full {showAllCountries ? 'bg-zinc-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      ...
    </button>
    <button on:click={() => { view = "favorites" }}
      class="px-3 py-1.5 rounded-full {view === 'favorites' ? 'bg-yellow-600' : 'bg-zinc-800 hover:bg-zinc-700'}">
      Favorites
    </button>
  </div>

  <!-- All Countries (toggled by "..." button) -->
  {#if showAllCountries && countries.length > 0}
    <div class="flex gap-1.5 flex-wrap text-xs max-h-40 overflow-y-auto bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      {#each countries as c}
        {#if c.stationcount > 0}
          <button on:click={() => { view = "browse"; showAllCountries = false; loadByCountry(c.iso_3166_1 || c.name) }}
            class="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 whitespace-nowrap">
            {c.name} <span class="text-zinc-500">({c.stationcount})</span>
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Tags -->
  {#if tags.length > 0}
    <div class="flex gap-1.5 flex-wrap text-xs">
      {#each tags.slice(0, 15) as tag}
        <button on:click={() => { view = "browse"; loadByTag(tag.name) }}
          class="px-2 py-1 rounded {selectedTag === tag.name ? 'bg-blue-600' : 'bg-zinc-800/50 hover:bg-zinc-700/50'}">
          {tag.name}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Station List -->
  {#if loading}
    <p class="text-zinc-500 text-center py-8">Loading stations...</p>
  {:else if view === "favorites"}
    {#if favorites.length === 0}
      <p class="text-zinc-500 text-center py-8">No favorites yet. Click the star on any station.</p>
    {:else}
      <div class="grid gap-2">
        {#each favorites as fav}
          <button
            on:click={() => playStation({ stationuuid: fav.station_uuid, name: fav.name, url_resolved: fav.url, favicon: fav.favicon, country: fav.country, tags: fav.tags })}
            class="flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition text-left"
          >
            {#if fav.favicon}
              <img src={fav.favicon} alt="" class="h-8 w-8 rounded object-cover" />
            {:else}
              <div class="h-8 w-8 rounded bg-zinc-700 flex items-center justify-center text-xs">FM</div>
            {/if}
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm truncate">{fav.name}</p>
              <p class="text-xs text-zinc-400 truncate">{fav.country}{fav.tags ? ' · ' + fav.tags : ''}</p>
            </div>
            {#if currentStation?.stationuuid === fav.station_uuid && $radioPlaying}
              <span class="text-emerald-400 text-xs font-bold animate-pulse">LIVE</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="grid gap-2">
      {#each stations as station}
        <div class="flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition">
          <button on:click={() => playStation(station)} class="flex items-center gap-3 flex-1 min-w-0 text-left">
            {#if station.favicon}
              <img src={station.favicon} alt="" class="h-8 w-8 rounded object-cover" />
            {:else}
              <div class="h-8 w-8 rounded bg-zinc-700 flex items-center justify-center text-xs">FM</div>
            {/if}
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm truncate">{station.name}</p>
              <p class="text-xs text-zinc-400 truncate">
                {station.country || ''}{station.tags ? ' · ' + station.tags : ''}{station.bitrate ? ' · ' + station.bitrate + 'kbps' : ''}
              </p>
            </div>
          </button>

          {#if currentStation?.stationuuid === station.stationuuid && $radioPlaying}
            <span class="text-emerald-400 text-xs font-bold animate-pulse">LIVE</span>
          {/if}

          <button
            on:click={() => toggleFavorite(station)}
            class="text-lg {isFav(station) ? 'text-yellow-400' : 'text-zinc-600 hover:text-yellow-400'} transition"
            title={isFav(station) ? "Remove from favorites" : "Add to favorites"}
          >
            {isFav(station) ? '★' : '☆'}
          </button>
        </div>
      {/each}

      {#if stations.length === 0}
        <p class="text-zinc-500 text-center py-8">No stations found.</p>
      {/if}
    </div>

    <!-- Infinite scroll sentinel -->
    {#if hasMore && stations.length > 0}
      <div bind:this={sentinel} class="flex justify-center py-4">
        {#if loadingMore}
          <p class="text-zinc-500 text-sm">Loading more...</p>
        {/if}
      </div>
    {:else if stations.length > 0}
      <p class="text-zinc-600 text-center text-xs py-4">All stations loaded</p>
    {/if}
  {/if}
</div>
