const News = ({ news, loading }) => {
  const normalizedNews = Array.isArray(news) ? news : []
  const [featuredArticle, ...otherArticles] = normalizedNews
  const latestDate = normalizedNews
    .map((item) => (item.published_on ? new Date(item.published_on * 1000) : null))
    .filter(Boolean)
    .sort((a, b) => b - a)[0]

  if (loading) {
    return (
      <section className="space-y-5">
        <div className="rounded-3xl border border-[#263655] bg-[#0d1629]/95 p-6 sm:p-8">
          <div className="h-5 w-32 rounded bg-[#1d2b44] animate-pulse" />
          <div className="mt-4 h-10 w-3/4 rounded bg-[#1a2840] animate-pulse" />
          <div className="mt-6 h-4 w-1/3 rounded bg-[#1a2840] animate-pulse" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="rounded-2xl border border-[#243552] bg-[#0f1a2e]/95 p-5">
              <div className="h-5 w-20 rounded bg-[#1c2b45] animate-pulse" />
              <div className="mt-4 h-8 w-11/12 rounded bg-[#1a2840] animate-pulse" />
              <div className="mt-3 h-4 w-3/4 rounded bg-[#1a2840] animate-pulse" />
              <div className="mt-5 h-8 w-1/2 rounded bg-[#1c2b45] animate-pulse" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (normalizedNews.length === 0) {
    return (
      <div className="text-center py-20 px-6 rounded-3xl border border-[#2a3a57] bg-[#0d1629]/90">
        <p className="text-[#d2dff5] text-lg font-semibold">No news available right now</p>
        <p className="text-[#8399be] text-sm mt-2">The feed is live. New headlines will appear shortly.</p>
      </div>
    )
  }

  return (
    <section className="space-y-5">
      <header className="relative overflow-hidden rounded-3xl border border-[#2b3d5f] bg-[linear-gradient(130deg,#0e172a_0%,#111f36_52%,#0a162a_100%)] px-5 py-6 sm:px-8 sm:py-7">
        <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-[#f0b90b]/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-10 -bottom-14 h-48 w-48 rounded-full bg-[#2ad8ff]/10 blur-3xl" />

        <div className="relative flex flex-wrap items-center gap-2 text-xs mb-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#5d4715] bg-[#2b2008] px-3 py-1 text-[#ffd678]">
            <span className="h-2 w-2 rounded-full bg-[#f0b90b] animate-pulse" />
            Live Feed
          </span>
          <span className="rounded-full border border-[#2f425f] bg-[#17243a] px-3 py-1 text-[#a9bfdf]">
            {normalizedNews.length} headlines tracked
          </span>
          {latestDate && (
            <span className="rounded-full border border-[#2f425f] bg-[#17243a] px-3 py-1 text-[#a9bfdf]">
              Updated {formatTimeAgo(latestDate)}
            </span>
          )}
        </div>

        <h2 className="text-[28px] leading-tight sm:text-[34px] font-extrabold tracking-tight text-white">
          Crypto News Terminal
        </h2>
        <p className="text-[#8fa8cb] text-sm sm:text-base mt-2 max-w-2xl">
          Curated market narratives, policy shifts, and momentum headlines built for fast decision-making.
        </p>
      </header>

      {featuredArticle && (
        <FeaturedNewsCard article={featuredArticle} />
      )}

      {otherArticles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {otherArticles.map((article, index) => (
            <NewsCard
              key={`${article.id || article.url || article.title || 'news'}-${index}`}
              article={article}
              index={index}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FeaturedNewsCard({ article }) {
  const publishedDate = article.published_on
    ? new Date(article.published_on * 1000)
    : null
  const timeAgo = publishedDate ? formatTimeAgo(publishedDate) : 'Unknown time'
  const isBreaking = getMinutesOld(publishedDate) <= 30
  const sourceLabel = formatSource(article.source)
  const previewImage = article.imageurl || ''
  const summary = article.body || 'Tap into the full coverage to track the market impact and context.'

  const CardWrap = article.url ? 'a' : 'div'

  return (
    <CardWrap
      href={article.url}
      target={article.url ? '_blank' : undefined}
      rel={article.url ? 'noopener noreferrer' : undefined}
      className="group block relative overflow-hidden rounded-3xl border border-[#344b72] bg-[#0d172b] min-h-[260px] sm:min-h-[300px] transition-all duration-300 hover:border-[#4f6992] hover:-translate-y-0.5 hover:shadow-[0_22px_40px_rgba(4,10,20,0.55)]"
    >
      {previewImage ? (
        <img
          src={previewImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-35 transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            e.target.style.display = 'none'
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(240,185,11,0.22),transparent_35%),radial-gradient(circle_at_85%_85%,rgba(42,216,255,0.2),transparent_34%),linear-gradient(125deg,#0e1930,#102541)]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,12,23,0.35),rgba(6,11,20,0.9)_62%,#060d1b_100%)]" />

      <div className="relative h-full p-6 sm:p-7 flex flex-col justify-end">
        <div className="flex flex-wrap gap-2 text-xs mb-3">
          {isBreaking && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#7d2732] bg-[#39141b] px-2.5 py-1 text-[#ff92a1] font-semibold">
              Breaking
            </span>
          )}
          <span className="rounded-full border border-[#324866] bg-[#15263f] px-2.5 py-1 text-[#b9cbe8]">
            {sourceLabel}
          </span>
          <span className="rounded-full border border-[#66511c] bg-[#32260c] px-2.5 py-1 text-[#ffd879]">
            {timeAgo}
          </span>
        </div>

        <h3 className="text-[24px] sm:text-[31px] leading-tight font-bold text-white max-w-4xl">
          {article.title || 'Untitled headline'}
        </h3>

        <p className="text-[#d2dff3]/90 text-sm sm:text-base mt-3 max-w-3xl line-clamp-2">
          {summary}
        </p>

        {article.url && (
          <span className="inline-flex items-center gap-2 mt-5 text-[#f0b90b] font-semibold text-sm">
            Read full story
            <span className="transition-transform duration-300 group-hover:translate-x-1">-&gt;</span>
          </span>
        )}
      </div>
    </CardWrap>
  )
}

function NewsCard({ article, index }) {
  const publishedDate = article.published_on
    ? new Date(article.published_on * 1000)
    : null
  const timeAgo = publishedDate ? formatTimeAgo(publishedDate) : 'Unknown time'
  const sourceLabel = formatSource(article.source)
  const isBreaking = getMinutesOld(publishedDate) <= 30
  const summary = article.body || 'Open article for full details and trading context.'

  return (
    <article
      className="group rounded-2xl border border-[#2a3c5d] bg-[linear-gradient(150deg,#0e182c_0%,#0f1d34_100%)] p-5 transition-all duration-300 hover:border-[#43618c] hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(5,10,20,0.46)]"
      style={{ animation: `slide-in-right 0.35s ease-out ${Math.min(index, 6) * 0.06}s both` }}
    >
      <div className="flex items-start gap-4">
        {article.imageurl && (
          <img
            src={article.imageurl}
            alt=""
            className="w-20 h-20 object-cover rounded-xl flex-shrink-0 border border-[#314665] hidden sm:block"
            onError={(e) => {
              e.target.style.display = 'none'
            }}
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
            {isBreaking && (
              <span className="rounded-full border border-[#7d2732] bg-[#39141b] px-2 py-1 text-[#ff92a1] font-semibold">
                Breaking
              </span>
            )}
            <span className="rounded-full border border-[#30435f] bg-[#15243b] px-2 py-1 text-[#b1c4e3]">
              {sourceLabel}
            </span>
            <span className="rounded-full border border-[#66511c] bg-[#33260d] px-2 py-1 text-[#ffd56a]">
              {timeAgo}
            </span>
          </div>

          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <h3 className="font-bold text-[20px] leading-snug text-white transition-colors group-hover:text-[#f0b90b]">
                {article.title || 'Untitled headline'}
              </h3>
            </a>
          ) : (
            <h3 className="font-bold text-[20px] leading-snug text-white">
              {article.title || 'Untitled headline'}
            </h3>
          )}

          <p className="text-[#9eb2d3] text-sm mt-2 line-clamp-2">
            {summary}
          </p>

          {article.url && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-[#f0b90b]"
            >
              Open coverage
              <span className="transition-transform duration-300 group-hover:translate-x-1">-&gt;</span>
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

function formatSource(source) {
  if (!source) return 'Unknown Source'
  return String(source)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getMinutesOld(date) {
  if (!date) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - date.getTime()) / 60000)
}

function formatTimeAgo(date) {
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString()
}

export default News

