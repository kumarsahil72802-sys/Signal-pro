import React from 'react';

const News = ({ news, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (news.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 text-lg">No news available</p>
        <p className="text-gray-400 text-sm mt-2">Check back later for updates</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Crypto News</h2>
        <p className="text-gray-500 text-sm mt-1">Latest cryptocurrency and blockchain updates</p>
      </div>

      <div className="space-y-4">
        {news.map((article, index) => {
          const publishedDate = article.published_on 
            ? new Date(article.published_on * 1000)
            : null;
          
          const timeAgo = publishedDate 
            ? formatTimeAgo(publishedDate)
            : 'Unknown time';

          return (
            <article 
              key={index}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow duration-200"
            >
              <div className="flex gap-4">
                {article.imageurl && (
                  <img 
                    src={article.imageurl}
                    alt=""
                    className="w-24 h-24 object-cover rounded-lg flex-shrink-0"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                )}
                
                <div className="flex-1 min-w-0">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <h3 className="font-semibold text-lg text-gray-900 hover:text-blue-600 transition-colors line-clamp-2">
                      {article.title}
                    </h3>
                  </a>
                  
                  {article.body && (
                    <p className="text-gray-600 text-sm mt-2 line-clamp-2">
                      {article.body}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-3 mt-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <span className="text-gray-400">🏢</span>
                      {article.source || 'Unknown Source'}
                    </span>
                    <span className="text-gray-300">•</span>
                    <span className="flex items-center gap-1">
                      <span className="text-gray-400">🕐</span>
                      {timeAgo}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString();
}

export default News;
