'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import { DoubanCard } from './video-card';

const PAGE_SIZE = 12;
const CATEGORIES = [
  { id: 'movie', title: '电影周榜', source: '豆瓣电影周榜', list: 'douban_movie_weekly' },
  { id: 'chinese', title: '国产剧周榜', source: '豆瓣国产剧周榜', list: 'douban_tv_chinese' },
  { id: 'global', title: '海外剧周榜', source: '豆瓣海外剧周榜', list: 'douban_tv_global' },
  { id: 'shows', title: '国内综艺', source: '豆瓣国内综艺周榜', list: 'douban_show_chinese' },
  { id: 'global-shows', title: '海外综艺', source: '豆瓣海外综艺周榜', list: 'douban_show_global' },
  { id: 'baidu', title: '百度热播剧', source: '百度热播剧榜', list: 'baidu_teleplay' },
  { id: 'anime', title: '动漫', source: '豆瓣动画电影 · 日本动画推荐' },
  { id: 'documentary', title: '纪录片', source: '豆瓣纪录片推荐', type: 'tv', tag: '纪录片' },
  { id: 'movie-latest', title: '最新电影', source: '豆瓣最新电影推荐', type: 'movie', tag: '最新' },
  { id: 'movie-top', title: '高分电影', source: '豆瓣高分电影推荐', type: 'movie', tag: '豆瓣高分' },
  { id: 'movie-classic', title: '经典电影', source: '豆瓣经典电影推荐', type: 'movie', tag: '经典' },
  { id: 'movie-hidden', title: '冷门佳片', source: '豆瓣冷门佳片推荐', type: 'movie', tag: '冷门佳片' },
  { id: 'tv-chinese', title: '国产剧', source: '豆瓣国产剧推荐', type: 'tv', tag: '国产剧' },
  { id: 'tv-american', title: '美剧', source: '豆瓣美剧推荐', type: 'tv', tag: '美剧' },
  { id: 'tv-british', title: '英剧', source: '豆瓣英剧推荐', type: 'tv', tag: '英剧' },
  { id: 'tv-korean', title: '韩剧', source: '豆瓣韩剧推荐', type: 'tv', tag: '韩剧' },
  { id: 'tv-japanese', title: '日剧', source: '豆瓣日剧推荐', type: 'tv', tag: '日剧' },
  { id: 'tv-hongkong', title: '港剧', source: '豆瓣港剧推荐', type: 'tv', tag: '港剧' },
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

/** 沿用首页分类切换布局，仅请求并展示当前选中的榜单。 */
export function HomeRankings({ onPick }: { onPick: (title: string) => void }) {
  const [selectedId, setSelectedId] = useState<Category['id']>('movie');
  const selected = CATEGORIES.find(category => category.id === selectedId)!;
  return (
    <div aria-label="影视榜单推荐">
      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="选择榜单">
        {CATEGORIES.map(category => (
          <button
            key={category.id}
            className={cn('px-2.5 py-1 rounded-full text-xs transition-colors',
              selectedId === category.id ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover')}
            aria-pressed={selectedId === category.id}
            onClick={() => setSelectedId(category.id)}
          >
            {category.title}
          </button>
        ))}
      </div>
      <RankingCategory key={selected.id} category={selected} onPick={onPick} />
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
      {query.isPending ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5" aria-label="加载中">
          {Array.from({ length: PAGE_SIZE }, (_, i) => <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />)}
        </div>
      ) : query.isError && !items.length ? (
        <div className="rounded-lg bg-chip p-5 text-center text-sm text-muted">
          <p>该分类加载失败，可重试或切换其他分类</p>
          <button className="btn-ghost btn-sm mt-2" onClick={() => void query.refetch()}>重新加载</button>
        </div>
      ) : !items.length ? (
        <p className="py-5 text-sm text-faint">该分类暂无推荐内容</p>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
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
