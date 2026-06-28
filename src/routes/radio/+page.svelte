<script>
  import { onMount, onDestroy } from 'svelte'
  import { radioPlaying } from '$lib/radioStore'
  import { radioBackendURL } from '$lib/info'

  let audioEl
  let canvasEl
  let stations = []
  let tags = []
  let favorites = []
  let countries = []
  let searchQuery = ""
  let selectedCountry = "NO"
  let selectedTag = ""
  let currentStation = null
  let loading = false
  let loadingMore = false
  let view = "browse"
  let showAllCountries = false
  let offset = 0
  let hasMore = true
  let sentinel
  let observer
  let audioContext
  let analyser
  let sourceNode
  let animationFrame

  const LIMIT = 50

  const quickCountries = [
    { code: 'NO', label: 'Norway' },
    { code: 'US', label: 'USA' },
    { code: 'GB', label: 'UK' },
    { code: 'KE', label: 'Kenya' },
    { code: 'JP', label: 'Japan' }
  ]

  function streamProxyURL(station) {
    const raw = station?.url_resolved || station?.url || ''
    return raw ? `${radioBackendURL}/api/radio/stations/stream?url=${encodeURIComponent(raw)}` : ''
  }

  function cleanMeta(station) {
    const meta = []
    if (station.country) meta.push(station.country)
    if (station.tags) meta.push(station.tags)
    if (station.bitrate) meta.push(`${station.bitrate}kbps`)
    return meta.join(' · ')
  }

  function buildURL(off) {
    if (selectedCountry) {
      return `${radioBackendURL}/api/radio/stations/search?countrycode=${selectedCountry}&order=votes&reverse=true&limit=${LIMIT}&offset=${off}`
    }
    if (selectedTag) {
      return `${radioBackendURL}/api/radio/tag-stations/${encodeURIComponent(selectedTag)}?limit=${LIMIT}&offset=${off}`
    }
    if (view === 'search' && searchQuery.trim()) {
      return `${radioBackendURL}/api/radio/stations/search?name=${encodeURIComponent(searchQuery)}&limit=${LIMIT}&offset=${off}`
    }
    return `${radioBackendURL}/api/radio/stations/top?limit=${LIMIT}&offset=${off}`
  }

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
    } catch (e) {
      console.error(e)
    }
    loading = false
  }

  async function loadMore() {
    if (loadingMore || !hasMore || view === 'favorites') return
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
    } catch (e) {
      console.error(e)
    }
    loadingMore = false
  }

  async function loadByCountry(code) {
    selectedCountry = code
    selectedTag = ''
    view = 'browse'
    showAllCountries = false
    await loadStations(`${radioBackendURL}/api/radio/stations/search?countrycode=${code}&order=votes&reverse=true&limit=${LIMIT}&offset=0`)
  }

  async function loadByTag(tag) {
    selectedTag = tag
    selectedCountry = ''
    view = 'browse'
    await loadStations(`${radioBackendURL}/api/radio/tag-stations/${encodeURIComponent(tag)}?limit=${LIMIT}&offset=0`)
  }

  async function searchStations() {
    if (!searchQuery.trim()) return
    selectedCountry = ''
    selectedTag = ''
    view = 'search'
    showAllCountries = false
    await loadStations(`${radioBackendURL}/api/radio/stations/search?name=${encodeURIComponent(searchQuery)}&limit=${LIMIT}&offset=0`)
  }

  async function loadTop() {
    selectedCountry = ''
    selectedTag = ''
    view = 'browse'
    showAllCountries = false
    await loadStations(`${radioBackendURL}/api/radio/stations/top?limit=${LIMIT}&offset=0`)
  }

  async function loadTags() {
    try {
      const res = await fetch(`${radioBackendURL}/api/radio/stations/tags?limit=18`)
      tags = await res.json()
    } catch (e) {
      console.error(e)
    }
  }

  async function loadFavorites() {
    try {
      const res = await fetch(`${radioBackendURL}/api/radio/stations/favorites`)
      const data = await res.json()
      favorites = data.favorites || []
    } catch (e) {
      console.error(e)
    }
  }

  async function loadCountries() {
    if (countries.length > 0) {
      showAllCountries = !showAllCountries
      return
    }
    try {
      const res = await fetch(`${radioBackendURL}/api/radio/stations/countries`)
      countries = await res.json()
      showAllCountries = true
    } catch (e) {
      console.error(e)
    }
  }

  async function toggleFavorite(station) {
    const favorite = favorites.some((f) => f.station_uuid === station.stationuuid)
    if (favorite) {
      await fetch(`${radioBackendURL}/api/radio/stations/favorite?station_uuid=${station.stationuuid}`, { method: 'DELETE' })
    } else {
      await fetch(`${radioBackendURL}/api/radio/stations/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          station_uuid: station.stationuuid,
          name: station.name,
          url: station.url_resolved || station.url,
          favicon: station.favicon || '',
          country: station.country || '',
          tags: station.tags || ''
        })
      })
    }
    await loadFavorites()
  }

  function isFav(station) {
    return favorites.some((f) => f.station_uuid === station.stationuuid)
  }

  function ensureAudioGraph() {
    if (!audioEl) return
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      audioContext = new AudioContextClass()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.82
      sourceNode = audioContext.createMediaElementSource(audioEl)
      sourceNode.connect(analyser)
      analyser.connect(audioContext.destination)
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {})
    }
  }

  function playStation(station) {
    if (currentStation?.stationuuid === station.stationuuid && $radioPlaying) {
      stopRadio()
      return
    }

    currentStation = station
    audioEl.src = streamProxyURL(station)
    audioEl.load()
    ensureAudioGraph()
    audioEl.play()
      .then(() => {
        $radioPlaying = true
      })
      .catch((error) => {
        console.error(error)
      })
  }

  function togglePlayback() {
    if (!currentStation) return
    if ($radioPlaying) {
      stopRadio()
      return
    }
    ensureAudioGraph()
    audioEl.play()
      .then(() => {
        $radioPlaying = true
      })
      .catch((error) => {
        console.error(error)
      })
  }

  function stopRadio() {
    audioEl.pause()
    $radioPlaying = false
  }

  function drawVisualizer() {
    if (!canvasEl) return
    const ctx = canvasEl.getContext('2d')
    const width = canvasEl.width = canvasEl.clientWidth * window.devicePixelRatio
    const height = canvasEl.height = canvasEl.clientHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const cssWidth = canvasEl.clientWidth
    const cssHeight = canvasEl.clientHeight
    const bars = 72
    const data = new Uint8Array(analyser ? analyser.frequencyBinCount : 256)

    const render = () => {
      animationFrame = requestAnimationFrame(render)

      ctx.clearRect(0, 0, cssWidth, cssHeight)
      ctx.fillStyle = 'rgba(8, 10, 18, 0.28)'
      ctx.fillRect(0, 0, cssWidth, cssHeight)

      const gradient = ctx.createLinearGradient(0, 0, cssWidth, cssHeight)
      gradient.addColorStop(0, 'rgba(120, 119, 255, 0.95)')
      gradient.addColorStop(0.45, 'rgba(64, 224, 208, 0.9)')
      gradient.addColorStop(1, 'rgba(255, 99, 132, 0.9)')

      const glow = ctx.createLinearGradient(0, cssHeight, cssWidth, 0)
      glow.addColorStop(0, 'rgba(82, 204, 255, 0.12)')
      glow.addColorStop(1, 'rgba(194, 101, 255, 0.12)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, cssWidth, cssHeight)

      if (analyser && $radioPlaying) {
        analyser.getByteFrequencyData(data)
      }

      const centerY = cssHeight / 2
      const barGap = 4
      const barWidth = (cssWidth - (bars - 1) * barGap) / bars

      ctx.shadowBlur = 24
      ctx.shadowColor = 'rgba(94, 234, 212, 0.55)'
      ctx.fillStyle = gradient

      for (let i = 0; i < bars; i++) {
        const sampleIndex = Math.floor((i / bars) * data.length)
        const sample = $radioPlaying ? data[sampleIndex] / 255 : 0.08 + ((i % 7) * 0.012)
        const eased = Math.max(10, sample * cssHeight * 0.42)
        const x = i * (barWidth + barGap)
        const h = eased
        const radius = Math.min(16, barWidth / 2)

        roundedBar(ctx, x, centerY - h / 2, barWidth, h, radius)
        ctx.fill()
      }

      ctx.shadowBlur = 0
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, centerY)
      ctx.lineTo(cssWidth, centerY)
      ctx.stroke()
    }

    render()
  }

  function roundedBar(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + width, y, x + width, y + height, r)
    ctx.arcTo(x + width, y + height, x, y + height, r)
    ctx.arcTo(x, y + height, x, y, r)
    ctx.arcTo(x, y, x + width, y, r)
    ctx.closePath()
  }

  function handleKey(event) {
    if (event.key === 'Enter') searchStations()
  }

  function setupObserver() {
    if (observer) observer.disconnect()
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && !loadingMore && hasMore && view !== 'favorites') {
        loadMore()
      }
    }, { rootMargin: '260px' })
    if (sentinel) observer.observe(sentinel)
  }

  $: if (sentinel) setupObserver()

  onMount(() => {
    loadByCountry('NO')
    loadTags()
    loadFavorites()
    drawVisualizer()
  })

  onDestroy(() => {
    if (observer) observer.disconnect()
    if (animationFrame) cancelAnimationFrame(animationFrame)
    if (audioContext) audioContext.close()
  })
</script>

<div class="radio-page min-h-full px-2 pb-8 pt-4 xl:px-4">
  <div class="mx-auto flex max-w-[1640px] flex-col gap-5">
    <section class="radio-hero overflow-hidden rounded-[2rem] border border-white/10 bg-[#090d16] shadow-[0_30px_100px_rgba(0,0,0,0.55)]">
      <div class="radio-hero-bg"></div>
      <div class="relative grid gap-6 p-4 md:p-6 xl:grid-cols-[1.2fr_0.8fr] xl:p-8">
        <div class="flex flex-col gap-5">
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-2">
              <div class="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300">
                <span class={$radioPlaying ? 'radio-dot live' : 'radio-dot'}></span>
                {$radioPlaying ? 'Broadcasting' : 'Ready'}
              </div>
              <h1 class="text-3xl font-black tracking-tight text-white md:text-5xl">Radio, rebuilt like a headline feature.</h1>
              <p class="max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
                Real stations, fast switching, live playback, dense discovery, and a visualizer that actually reacts to the sound.
              </p>
            </div>

            <div class="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right xl:flex">
              {#if currentStation?.favicon}
                <img src={currentStation.favicon} alt="" class="h-10 w-10 rounded-xl object-cover" />
              {:else}
                <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-zinc-300">FM</div>
              {/if}
              <div>
                <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Now Tuned</p>
                <p class="max-w-[180px] truncate text-sm font-semibold text-white">{currentStation?.name || 'Pick a station'}</p>
              </div>
            </div>
          </div>

          <div class="radio-player-card grid gap-5 rounded-[1.6rem] border border-white/10 bg-white/[0.035] p-4 backdrop-blur-xl md:grid-cols-[0.95fr_1.05fr] md:p-5">
            <div class="flex flex-col justify-between gap-5">
              <div class="flex items-center gap-4">
                <div class="station-cover">
                  {#if currentStation?.favicon}
                    <img src={currentStation.favicon} alt="" class="h-full w-full object-cover" />
                  {:else}
                    <div class="flex h-full w-full items-center justify-center text-lg font-black tracking-[0.35em] text-zinc-200">RADIO</div>
                  {/if}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[11px] font-bold uppercase tracking-[0.28em] text-zinc-400">Current Station</p>
                  <h2 class="truncate text-2xl font-black text-white md:text-3xl">{currentStation?.name || 'Select a station'}</h2>
                  <p class="mt-1 truncate text-sm text-zinc-400">{currentStation ? cleanMeta(currentStation) : 'Choose from Norway, worldwide charts, or any country.'}</p>
                </div>
              </div>

              <div class="grid gap-4">
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    on:click={togglePlayback}
                    class="radio-play-btn"
                    disabled={!currentStation}
                  >
                    {$radioPlaying ? 'Pause Station' : 'Play Station'}
                  </button>

                  <button
                    on:click={stopRadio}
                    class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!$radioPlaying}
                  >
                    Stop
                  </button>

                  {#if currentStation}
                    <button
                      on:click={() => toggleFavorite(currentStation)}
                      class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition hover:bg-white/10 {isFav(currentStation) ? 'text-yellow-300' : 'text-zinc-200'}"
                    >
                      {isFav(currentStation) ? '★ Favorited' : '☆ Favorite'}
                    </button>
                  {/if}
                </div>

                <div class="grid gap-3 md:grid-cols-3">
                  <div class="stat-card">
                    <span>Region</span>
                    <strong>{currentStation?.country || 'Worldwide'}</strong>
                  </div>
                  <div class="stat-card">
                    <span>Genre</span>
                    <strong>{currentStation?.tags ? currentStation.tags.split(',')[0] : 'Mixed'}</strong>
                  </div>
                  <div class="stat-card">
                    <span>Stream</span>
                    <strong>{currentStation?.bitrate ? `${currentStation.bitrate} kbps` : 'Live'}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-4">
              <div class="visual-shell">
                <div class="visual-header">
                  <div>
                    <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300/80">Reactive Visualizer</p>
                    <p class="text-sm text-zinc-400">Big, live, and driven by the actual stream audio.</p>
                  </div>
                  <div class="visual-pills">
                    <span>72 bars</span>
                    <span>{$radioPlaying ? 'Live audio' : 'Idle glow'}</span>
                  </div>
                </div>
                <canvas bind:this={canvasEl} class="visual-canvas"></canvas>
              </div>

              <div class="mini-search grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  bind:value={searchQuery}
                  on:keydown={handleKey}
                  placeholder="Search stations worldwide... NRK, BBC, jazz, Tokyo, Nairobi"
                  class="radio-input"
                />
                <button on:click={searchStations} class="radio-search-btn">Search</button>
              </div>
            </div>
          </div>
        </div>

        <div class="radio-side-stack flex flex-col gap-4">
          <div class="glass-panel p-4 md:p-5">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-400">Quick Tuning</p>
                <h3 class="text-lg font-bold text-white">Country lanes</h3>
              </div>
              <button on:click={loadCountries} class="more-btn">...</button>
            </div>

            <div class="flex flex-wrap gap-2">
              {#each quickCountries as country}
                <button
                  on:click={() => loadByCountry(country.code)}
                  class:selected-pill={selectedCountry === country.code}
                  class="country-pill"
                >
                  {country.label}
                </button>
              {/each}
              <button
                on:click={loadTop}
                class:selected-pill={!selectedCountry && !selectedTag && view !== 'favorites'}
                class="country-pill"
              >
                Top Worldwide
              </button>
              <button
                on:click={() => { view = 'favorites'; showAllCountries = false }}
                class:selected-pill={view === 'favorites'}
                class="country-pill favorites-pill"
              >
                Favorites
              </button>
            </div>

            {#if showAllCountries && countries.length > 0}
              <div class="country-cloud scrollable mt-4 max-h-52 rounded-2xl border border-white/10 bg-black/20 p-3">
                {#each countries as country}
                  {#if country.stationcount > 0}
                    <button
                      on:click={() => loadByCountry(country.iso_3166_1 || country.name)}
                      class="country-cloud-item"
                    >
                      {country.name}
                      <span>({country.stationcount})</span>
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>

          <div class="glass-panel p-4 md:p-5">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-400">Genres</p>
                <h3 class="text-lg font-bold text-white">Jump by mood</h3>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              {#each tags as tag}
                <button
                  on:click={() => loadByTag(tag.name)}
                  class:selected-tag={selectedTag === tag.name}
                  class="tag-pill"
                >
                  {tag.name}
                </button>
              {/each}
            </div>
          </div>

          <div class="glass-panel p-4 md:p-5">
            <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-400">Collection</p>
            <div class="mt-3 grid grid-cols-3 gap-3">
              <div class="stat-card compact">
                <span>Stations</span>
                <strong>{stations.length}</strong>
              </div>
              <div class="stat-card compact">
                <span>Saved</span>
                <strong>{favorites.length}</strong>
              </div>
              <div class="stat-card compact">
                <span>Mode</span>
                <strong>{view === 'favorites' ? 'Saved' : selectedCountry ? selectedCountry : selectedTag || 'Top'}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="glass-panel p-4 md:p-5 xl:p-6">
      <div class="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-zinc-400">Station Browser</p>
          <h2 class="text-2xl font-black text-white">{view === 'favorites' ? 'Saved stations' : view === 'search' ? `Search results for “${searchQuery}”` : selectedCountry ? `Top stations in ${quickCountries.find((c) => c.code === selectedCountry)?.label || selectedCountry}` : selectedTag ? `${selectedTag} stations` : 'Top stations worldwide'}</h2>
        </div>
        <p class="max-w-xl text-sm text-zinc-400">Click any station card to switch instantly. Scroll to keep loading more until the directory is exhausted.</p>
      </div>

      {#if loading}
        <div class="flex items-center justify-center py-20 text-zinc-500">Loading stations...</div>
      {:else if view === 'favorites'}
        {#if favorites.length === 0}
          <div class="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center text-zinc-400">
            No favorites yet. Star stations you want to return to fast.
          </div>
        {:else}
          <div class="station-grid">
            {#each favorites as favorite}
              <button
                on:click={() => playStation({ stationuuid: favorite.station_uuid, name: favorite.name, url_resolved: favorite.url, favicon: favorite.favicon, country: favorite.country, tags: favorite.tags })}
                class="station-card"
              >
                <div class="station-card-top">
                  {#if favorite.favicon}
                    <img src={favorite.favicon} alt="" class="station-logo" />
                  {:else}
                    <div class="station-logo fallback">FM</div>
                  {/if}
                  <div class="min-w-0 flex-1 text-left">
                    <p class="truncate text-base font-bold text-white">{favorite.name}</p>
                    <p class="truncate text-xs text-zinc-400">{favorite.country}{favorite.tags ? ` · ${favorite.tags}` : ''}</p>
                  </div>
                  {#if currentStation?.stationuuid === favorite.station_uuid && $radioPlaying}
                    <span class="live-chip">LIVE</span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="station-grid">
          {#each stations as station}
            <div class:active-station={currentStation?.stationuuid === station.stationuuid && $radioPlaying} class="station-card">
              <button on:click={() => playStation(station)} class="w-full text-left">
                <div class="station-card-top">
                  {#if station.favicon}
                    <img src={station.favicon} alt="" class="station-logo" />
                  {:else}
                    <div class="station-logo fallback">FM</div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <p class="truncate text-base font-bold text-white">{station.name}</p>
                      {#if currentStation?.stationuuid === station.stationuuid && $radioPlaying}
                        <span class="live-chip">LIVE</span>
                      {/if}
                    </div>
                    <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-400">{cleanMeta(station)}</p>
                  </div>
                </div>
              </button>

              <div class="mt-4 flex items-center justify-between gap-3">
                <button
                  on:click={() => playStation(station)}
                  class="mini-play-btn"
                >
                  {currentStation?.stationuuid === station.stationuuid && $radioPlaying ? 'Pause' : 'Play'}
                </button>

                <button
                  on:click={() => toggleFavorite(station)}
                  class="favorite-toggle"
                  title={isFav(station) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {isFav(station) ? '★' : '☆'}
                </button>
              </div>
            </div>
          {/each}
        </div>

        {#if stations.length === 0}
          <div class="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] px-6 py-16 text-center text-zinc-400">
            No stations found for this filter.
          </div>
        {/if}

        {#if hasMore && stations.length > 0}
          <div bind:this={sentinel} class="flex justify-center py-6">
            <div class="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
              {loadingMore ? 'Loading more...' : 'Scroll for more'}
            </div>
          </div>
        {:else if stations.length > 0}
          <p class="py-6 text-center text-xs uppercase tracking-[0.2em] text-zinc-600">All stations loaded</p>
        {/if}
      {/if}
    </section>

    <audio
      bind:this={audioEl}
      preload="none"
      crossorigin="anonymous"
      on:play={() => { $radioPlaying = true }}
      on:pause={() => { $radioPlaying = false }}
      on:ended={() => { $radioPlaying = false }}
    ></audio>
  </div>
</div>

<style>
  .radio-page {
    background:
      radial-gradient(circle at top left, rgba(102, 126, 234, 0.22), transparent 34%),
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 30%),
      linear-gradient(180deg, #06070d 0%, #0a0d16 100%);
  }

  .radio-hero {
    position: relative;
  }

  .radio-hero-bg {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 18% 20%, rgba(16, 185, 129, 0.18), transparent 25%),
      radial-gradient(circle at 78% 18%, rgba(99, 102, 241, 0.22), transparent 28%),
      radial-gradient(circle at 60% 72%, rgba(236, 72, 153, 0.12), transparent 26%);
    pointer-events: none;
  }

  .glass-panel {
    border-radius: 1.8rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
    backdrop-filter: blur(18px);
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
  }

  .radio-player-card {
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  }

  .station-cover {
    height: 6.5rem;
    width: 6.5rem;
    flex-shrink: 0;
    overflow: hidden;
    border-radius: 1.5rem;
    border: 1px solid rgba(255,255,255,0.14);
    background:
      radial-gradient(circle at top left, rgba(125, 211, 252, 0.28), transparent 40%),
      linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01));
    box-shadow: 0 14px 40px rgba(0,0,0,0.25);
  }

  .radio-play-btn {
    border-radius: 1.2rem;
    padding: 0.95rem 1.35rem;
    font-size: 0.95rem;
    font-weight: 800;
    color: white;
    background: linear-gradient(135deg, #7c3aed 0%, #22c55e 100%);
    box-shadow: 0 14px 40px rgba(34, 197, 94, 0.18), 0 10px 30px rgba(124, 58, 237, 0.28);
    transition: transform 0.2s ease, filter 0.2s ease, opacity 0.2s ease;
  }

  .radio-play-btn:hover:enabled {
    transform: translateY(-1px);
    filter: brightness(1.05);
  }

  .radio-play-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .stat-card {
    border-radius: 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.035);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .stat-card span {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: rgb(161 161 170);
    font-weight: 700;
  }

  .stat-card strong {
    font-size: 0.95rem;
    color: white;
    font-weight: 800;
  }

  .stat-card.compact {
    padding: 0.8rem 0.9rem;
  }

  .visual-shell {
    border-radius: 1.5rem;
    border: 1px solid rgba(255,255,255,0.09);
    background: linear-gradient(180deg, rgba(2,6,23,0.72), rgba(9,9,11,0.78));
    padding: 0.9rem;
    min-height: 19rem;
  }

  .visual-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.85rem;
  }

  .visual-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .visual-pills span {
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    padding: 0.35rem 0.6rem;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgb(212 212 216);
  }

  .visual-canvas {
    height: 15.5rem;
    width: 100%;
    border-radius: 1.1rem;
    background:
      radial-gradient(circle at center, rgba(34,197,94,0.1), transparent 35%),
      linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
  }

  .radio-input {
    width: 100%;
    border-radius: 1rem;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    padding: 0.95rem 1rem;
    color: white;
    outline: none;
    transition: border-color 0.2s ease, background 0.2s ease;
  }

  .radio-input:focus {
    border-color: rgba(94, 234, 212, 0.65);
    background: rgba(255,255,255,0.06);
  }

  .radio-search-btn {
    border-radius: 1rem;
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(16, 185, 129, 0.28);
    color: rgb(220 252 231);
    font-weight: 800;
    padding: 0.95rem 1.2rem;
    transition: background 0.2s ease, transform 0.2s ease;
  }

  .radio-search-btn:hover {
    transform: translateY(-1px);
    background: rgba(16, 185, 129, 0.24);
  }

  .country-pill,
  .tag-pill,
  .more-btn {
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    color: rgb(228 228 231);
    padding: 0.65rem 0.95rem;
    font-size: 0.78rem;
    font-weight: 700;
    transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
  }

  .country-pill:hover,
  .tag-pill:hover,
  .more-btn:hover,
  .country-cloud-item:hover {
    transform: translateY(-1px);
    background: rgba(255,255,255,0.08);
  }

  .selected-pill {
    background: linear-gradient(135deg, rgba(16,185,129,0.32), rgba(59,130,246,0.18));
    border-color: rgba(94, 234, 212, 0.35);
    color: white;
  }

  .selected-tag {
    background: rgba(59, 130, 246, 0.24);
    border-color: rgba(96, 165, 250, 0.35);
    color: white;
  }

  .favorites-pill {
    border-color: rgba(250, 204, 21, 0.16);
  }

  .more-btn {
    width: 3rem;
  }

  .country-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .country-cloud-item {
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.03);
    color: rgb(228 228 231);
    padding: 0.45rem 0.75rem;
    font-size: 0.75rem;
    transition: background 0.2s ease, transform 0.2s ease;
  }

  .country-cloud-item span {
    color: rgb(113 113 122);
  }

  .station-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  }

  .station-card {
    border-radius: 1.55rem;
    border: 1px solid rgba(255,255,255,0.08);
    background:
      linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02)),
      radial-gradient(circle at top right, rgba(56,189,248,0.07), transparent 30%);
    padding: 1rem;
    transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease, background 0.22s ease;
  }

  .station-card:hover,
  .active-station {
    transform: translateY(-2px);
    border-color: rgba(94,234,212,0.22);
    box-shadow: 0 18px 34px rgba(0,0,0,0.24);
    background:
      linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.028)),
      radial-gradient(circle at top right, rgba(56,189,248,0.1), transparent 34%);
  }

  .station-card-top {
    display: flex;
    align-items: center;
    gap: 0.9rem;
  }

  .station-logo {
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    border-radius: 1rem;
    object-fit: cover;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.05);
  }

  .station-logo.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 0.16em;
    color: rgb(212 212 216);
  }

  .live-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(16, 185, 129, 0.28);
    color: rgb(167 243 208);
    padding: 0.35rem 0.55rem;
    font-size: 0.62rem;
    font-weight: 900;
    letter-spacing: 0.18em;
  }

  .mini-play-btn {
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.09);
    background: rgba(255,255,255,0.05);
    color: white;
    padding: 0.55rem 0.95rem;
    font-size: 0.76rem;
    font-weight: 800;
    transition: background 0.2s ease, transform 0.2s ease;
  }

  .mini-play-btn:hover,
  .favorite-toggle:hover {
    transform: translateY(-1px);
    background: rgba(255,255,255,0.09);
  }

  .favorite-toggle {
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.09);
    background: rgba(255,255,255,0.05);
    min-width: 2.4rem;
    height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(250 204 21);
    font-size: 1rem;
    transition: background 0.2s ease, transform 0.2s ease;
  }

  .radio-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: rgba(255,255,255,0.35);
  }

  .radio-dot.live {
    background: rgb(16 185 129);
    box-shadow: 0 0 0 0 rgba(16,185,129,0.55);
    animation: pulseDot 1.8s infinite;
  }

  @keyframes pulseDot {
    0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); }
    70% { box-shadow: 0 0 0 0.55rem rgba(16,185,129,0); }
    100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
  }

  @media (max-width: 767px) {
    .station-cover {
      width: 5.25rem;
      height: 5.25rem;
    }

    .visual-shell {
      min-height: 14rem;
    }

    .visual-canvas {
      height: 12rem;
    }
  }
</style>
