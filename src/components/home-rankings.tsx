'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { DoubanCard } from './video-card';

const PAGE_SIZE = 12;
const CATEGORIES = [
  { id: 'movie', title: '热门电影', source: '豆瓣电影周榜', list: 'douban_movie_weekly' },
  { id: 'chinese', title: '国产剧', source: '豆瓣国产剧周榜', list: 'douban_tv_chinese' },
  { id: 'global', title: '海外剧', source: '豆瓣海外剧周榜', list: 'douban_tv_global' },
  { id: 'anime', title: '动漫', source: '豆瓣动画电影 · 日本动画推荐' },
  { id: 'shows', title: '综艺', source: '豆瓣国内综艺周榜', list: 'douban_show_chinese' },
  { id: 'documentary', title: '纪录片', source: '豆瓣纪录片推荐', type: 'tv', tag: '纪录片' },
] as const;

type Category = (typeof CATEGORIES)[number];

async function fetchCategory(category: Category, signal: AbortSignal) {
  if ('list' in category) return api.hotList(category.list, signal);
  if (category.id === 'anime') {
    // 两种动画推荐独立容错；合并后按豆瓣 ID 去重，避免同片重复占位。
    const results = await Promise.allSettled([
      api.douban('movie', '动画', 0, 50, signal),
      api.douban('tv', '日本动画', 0, 50, signal),
    ]);
    const items = results.flatMap(r => r.status === 'fulfilled' ? r.value.items : []);
    if (!items.length) throw new Error('动漫推荐加载失败');
    return { items: [...new Map(items.map(item => [item.id, item])).values()] };
  }
  return api.douban(category.type, category.tag, 0, 50, signal);
}

/** 首页分区独立请求；单区失败不遮挡其他榜单。 */
export function HomeRankings({ onPick }: { onPick: (title: string) => void }) {
  return (
    <div className="space-y-9" aria-label="影视分类推荐">
      {CATEGORIES.map(category => <RankingCategory key={category.id} category={category} onPick={onPick} />)}
    </div>
  );
}

function RankingCategory({ category, onPick }: { category: Category; onPick: (title: string) => void }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const query = useQuery({
    queryKey: ['home-category', category.id],
    queryFn: ({ signal }) => fetchCategory(category, signal),
    staleTime: 10 * 60 * 1000,
  });
  const items = query.data?.items ?? [];

  return (
    <section data-home-category={category.id} aria-label={category.title}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-content">{category.title}</h2>
          <p className="text-xs text-faint mt-1">{category.source}</p>
        </div>
        {items.length > 0 && <span className="shrink-0 text-xs text-faint">{items.length} 部</span>}
      </div>
      {query.isPending ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-6 gap-2.5" aria-label="加载中">
          {Array.from({ length: PAGE_SIZE }, (_, i) => <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />)}
        </div>
      ) : query.isError && !items.length ? (
        <div className="rounded-lg bg-chip p-5 text-center text-sm text-muted">
          <p>该分类加载失败，其他分类仍可浏览</p>
          <button className="btn-ghost btn-sm mt-2" onClick={() => void query.refetch()}>重新加载</button>
        </div>
      ) : !items.length ? (
        <p className="py-5 text-sm text-faint">该分类暂无推荐内容</p>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-6 gap-2.5">
            {items.slice(0, visibleCount).map(item => <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />)}
          </div>
          {items.length > visibleCount && (
            <div className="flex justify-center mt-4">
              <button className="btn-ghost btn-sm" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
                查看更多（还有 {items.length - visibleCount} 部）
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
